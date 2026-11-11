import { describe, expect, it } from "vitest";
import { opsWorld, sessionUser } from "../testing";
import { ForbiddenError } from "../shared/errors";
import { slaOf } from "./sla";

const MINUTE = 60_000;

function world() {
  const w = opsWorld();
  w.state.addOrder({ id: "o1" });
  w.state.addOrder({ id: "o2", zoneId: "pampanga", merchantName: "Bringhe House" });
  w.state.addRider({ id: "rosa" });
  w.state.addRider({ id: "rico" });
  w.state.addRider({ id: "rey", status: "pending_kyc" });
  w.state.addRider({ id: "pia", zoneId: "pampanga" });
  return w;
}

describe("AdminOrderService", () => {
  it("shows a coordinator only their zone's live orders, with SLA colours", async () => {
    const w = world();
    const board = await w.orders.board(w.coordinator);
    expect(board.ok && board.value.map((o) => [o.id, o.sla?.state])).toEqual([["o1", "on_time"]]);
    const all = await w.orders.board(w.admin);
    expect(all.ok && all.value.map((o) => o.id)).toEqual(["o1", "o2"]);
    const filtered = await w.orders.board(w.admin, { zoneId: "pampanga" });
    expect(filtered.ok && filtered.value.map((o) => o.id)).toEqual(["o2"]);
    const outside = await w.orders.board(w.coordinator, { zoneId: "pampanga" });
    expect(outside).toEqual({ ok: true, value: [] });
  });

  it("refuses people who are not console staff or have not verified with TOTP", async () => {
    const w = world();
    expect((await w.orders.board(null)).ok).toBe(false);
    const customer = await w.orders.board(w.customer);
    expect(!customer.ok && customer.error).toBeInstanceOf(ForbiddenError);
    const noTotp = await w.orders.board({ ...w.coordinator, aal: "aal1" });
    expect(!noTotp.ok && noTotp.error.message).toMatch(/authenticator/);
  });

  it("hides another zone's order", async () => {
    const w = world();
    const detail = await w.orders.detail(w.otherCoordinator, "o1");
    expect(!detail.ok && detail.error.code).toBe("NOT_FOUND");
    const missing = await w.orders.detail(w.admin, "nope");
    expect(!missing.ok && missing.error.code).toBe("NOT_FOUND");
    const mine = await w.orders.detail(w.coordinator, "o1");
    expect(mine.ok && mine.value.sla?.state).toBe("on_time");
  });

  it("assigns a free, approved rider of the zone and audits it with the reason", async () => {
    const w = world();
    const result = await w.orders.assignRider(w.coordinator, "o1", {
      riderId: "rico",
      reason: "At the store",
    });
    expect(result).toEqual({ ok: true, value: { orderId: "o1", riderId: "rico" } });
    expect(w.state.audit.at(-1)).toMatchObject({
      actorId: "coord-makati",
      actorRole: "coordinator",
      action: "order.assign_rider",
      entityId: "o1",
      meta: { reason: "At the store", riderId: "rico", previousRiderId: null },
    });
    expect(w.messages.sent.at(-1)).toMatchObject({
      userId: "user-rico",
      template: "rider_job_assigned",
    });
  });

  it("reassigns from one rider to another and frees the first", async () => {
    const w = world();
    await w.orders.assignRider(w.coordinator, "o1", { riderId: "rosa", reason: "Nearest" });
    const moved = await w.orders.assignRider(w.coordinator, "o1", {
      riderId: "rico",
      reason: "Rosa's bike broke",
    });
    expect(moved.ok).toBe(true);
    expect(w.state.riders.find((r) => r.id === "rosa")?.activeOrderId).toBeNull();
    expect(w.state.audit.at(-1)).toMatchObject({
      action: "order.reassign_rider",
      meta: { previousRiderId: "rosa" },
    });
    const again = await w.orders.assignRider(w.coordinator, "o1", {
      riderId: "rico",
      reason: "Again",
    });
    expect(!again.ok && again.error.code).toBe("CONFLICT");
  });

  it("only gives orders to approved, free riders of the same zone, before pickup", async () => {
    const w = world();
    for (const riderId of ["rey", "pia", "nobody"]) {
      const refused = await w.orders.assignRider(w.coordinator, "o1", { riderId, reason: "Try" });
      expect(!refused.ok && refused.error.code, riderId).toBe("CONFLICT");
    }
    w.state.addOrder({ id: "o3" });
    await w.orders.assignRider(w.coordinator, "o3", { riderId: "rosa", reason: "First" });
    const busy = await w.orders.assignRider(w.coordinator, "o1", {
      riderId: "rosa",
      reason: "Second",
    });
    expect(!busy.ok && busy.error.code).toBe("CONFLICT");
    w.state.addOrder({ id: "o4", status: "picked_up" });
    const late = await w.orders.assignRider(w.coordinator, "o4", {
      riderId: "rico",
      reason: "Too late",
    });
    expect(!late.ok && late.error.message).toMatch(/before pickup|pickup/);
  });

  it("reports a race when someone else changed the rider first", async () => {
    const w = world();
    w.state.raceOnAssign = true;
    const result = await w.orders.assignRider(w.coordinator, "o1", {
      riderId: "rico",
      reason: "Race",
    });
    expect(!result.ok && result.error.code).toBe("CONFLICT");
    expect(w.state.audit).toEqual([]);
  });

  it("cancels and refunds through the order services, auditing each", async () => {
    const w = world();
    const cancelled = await w.orders.cancel(w.coordinator, "o1", {
      reason: "Customer unreachable",
    });
    expect(cancelled.ok).toBe(true);
    expect(w.actions.cancelled).toEqual([{ orderId: "o1", reason: "Customer unreachable" }]);
    expect(w.state.audit.at(-1)).toMatchObject({
      action: "order.cancel",
      meta: { reason: "Customer unreachable" },
    });

    const refunded = await w.orders.refund(w.admin, "o2", {
      reason: "Missing item",
      amountCentavos: 5000,
    });
    expect(refunded.ok).toBe(true);
    expect(w.state.audit.at(-1)).toMatchObject({
      action: "order.refund",
      actorRole: "admin",
      meta: { amountCentavos: 5000 },
    });
    const full = await w.orders.refund(w.admin, "o2", { reason: "Store closed" });
    expect(full.ok && full.value.amountCentavos).toBe(17_900);
  });

  it("writes no audit row when the order service refuses", async () => {
    const w = world();
    w.actions.refuse = new ForbiddenError();
    const before = w.state.audit.length;
    expect((await w.orders.cancel(w.coordinator, "o1", { reason: "x" })).ok).toBe(false);
    expect((await w.orders.refund(w.coordinator, "o1", { reason: "x" })).ok).toBe(false);
    expect((await w.orders.cancel(w.otherCoordinator, "o1", { reason: "x" })).ok).toBe(false);
    expect(w.state.audit.length).toBe(before);
  });

  it("keeps support notes on the order and audits them", async () => {
    const w = world();
    const note = await w.orders.addNote(w.coordinator, "o1", { body: "Call on arrival" });
    expect(note.ok).toBe(true);
    const detail = await w.orders.detail(w.coordinator, "o1");
    expect(detail.ok && detail.value.notes.map((n) => [n.body, n.authorRole])).toEqual([
      ["Call on arrival", "coordinator"],
    ]);
    await w.orders.addNote(w.admin, "o1", { body: "Refund approved" });
    expect(w.state.audit.at(-1)).toMatchObject({ action: "order.note", actorRole: "admin" });
    const hidden = await w.orders.addNote(w.otherCoordinator, "o1", { body: "Nope" });
    expect(!hidden.ok && hidden.error.code).toBe("NOT_FOUND");
  });

  it("puts riders and live orders of the zone on the map", async () => {
    const w = world();
    const map = await w.orders.liveMap(w.coordinator);
    expect(map.ok && map.value.riders.map((r) => r.id)).toEqual(["rosa", "rico", "rey"]);
    expect(map.ok && map.value.orders.map((o) => o.id)).toEqual(["o1"]);
    expect((await w.orders.liveMap(w.customer)).ok).toBe(false);
  });

  it("uses the admin's own grant when they also coordinate", async () => {
    const w = world();
    const both = sessionUser(
      "both",
      [{ role: "admin" }, { role: "coordinator", zoneId: "makati" }],
      "aal2",
    );
    await w.orders.addNote(both, "o2", { body: "Checked" });
    expect(w.state.audit.at(-1)?.actorRole).toBe("admin");
  });
});

describe("SLA timers", () => {
  const base = opsWorld().state.addOrder({ id: "x" });
  const now = new Date("2026-11-14T04:00:00Z");
  const at = (ms: number): Date => new Date(now.getTime() - ms);

  it("gives the store 3 minutes to confirm: amber at 80%, red at 100%", () => {
    expect(slaOf({ ...base, status: "placed", placedAt: at(60_000) }, now)?.state).toBe("on_time");
    expect(slaOf({ ...base, status: "placed", placedAt: at(150_000) }, now)?.state).toBe("at_risk");
    expect(slaOf({ ...base, status: "placed", placedAt: at(181_000) }, now)?.state).toBe("late");
  });

  it("times cooking by the store's prep time, pickup by 10 minutes and the ride by 30", () => {
    expect(slaOf({ ...base, status: "preparing", acceptedAt: at(13 * MINUTE) }, now)?.state).toBe(
      "at_risk",
    );
    expect(
      slaOf({ ...base, status: "preparing", acceptedAt: at(16 * MINUTE), prepMinutes: null }, now)
        ?.state,
    ).toBe("late");
    expect(slaOf({ ...base, status: "ready", readyAt: at(5 * MINUTE) }, now)?.state).toBe(
      "on_time",
    );
    expect(slaOf({ ...base, status: "picked_up", pickedUpAt: at(31 * MINUTE) }, now)?.state).toBe(
      "late",
    );
  });

  it("has no timer for finished orders or missing times", () => {
    expect(slaOf({ ...base, status: "delivered" }, now)).toBeNull();
    expect(slaOf({ ...base, status: "ready", readyAt: null }, now)).toBeNull();
    expect(slaOf({ ...base, status: "placed", placedAt: null }, now)).toBeNull();
    expect(slaOf({ ...base, status: "preparing", acceptedAt: null }, now)).toBeNull();
    expect(slaOf({ ...base, status: "picked_up", pickedUpAt: null }, now)).toBeNull();
  });
});
