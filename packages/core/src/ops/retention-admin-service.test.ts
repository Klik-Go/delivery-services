import { describe, expect, it } from "vitest";
import { AuthorizationService } from "../auth/authorization-service";
import { MemoryAuditLog, OpsState } from "../testing/ops-fakes";
import { InMemoryPromoAdmin, InMemoryTickets } from "../testing/retention-fakes";
import { sessionUser } from "../testing/session-users";
import { ConsoleAccess } from "./console-access";
import { RetentionAdminService, type SupportTicket } from "./retention-admin-service";

const ticket = (id: string, zoneId: string): SupportTicket => ({
  id,
  kind: "low_rating",
  status: "open",
  orderId: `order-${id}`,
  orderCode: "KG-ABC123",
  zoneId,
  summary: "Store rated 2/5 on KG-ABC123 (cold food)",
  comment: "Lukewarm",
  createdAt: new Date("2026-11-15T04:00:00Z"),
  resolvedAt: null,
  resolution: null,
});

function setup() {
  const state = new OpsState(() => new Date("2026-11-15T04:00:00Z"));
  const tickets = new InMemoryTickets();
  tickets.store.push(ticket("t1", "makati"), ticket("t2", "pampanga"));
  const promos = new InMemoryPromoAdmin();
  const service = new RetentionAdminService({
    access: new ConsoleAccess(new AuthorizationService(), new MemoryAuditLog(state)),
    tickets,
    promos,
  });
  return {
    state,
    tickets,
    promos,
    service,
    admin: sessionUser("admin-1", [{ role: "admin" }]),
    coordinator: sessionUser("coord", [{ role: "coordinator", zoneId: "makati" }]),
    customer: sessionUser("carmen", [{ role: "customer" }], "aal1"),
  };
}

const CAMPAIGN = {
  code: "PASKO50",
  type: "fixed_off" as const,
  discountCentavos: 5000,
  minSubtotalCentavos: 30000,
  startsAt: "2026-12-01T00:00:00+08:00",
  endsAt: "2026-12-26T00:00:00+08:00",
  perUserLimit: 1,
  budgetCentavos: 500000,
};

describe("RetentionAdminService: low-rating tickets", () => {
  it("shows coordinators their zone's tickets only and lets them resolve them, audited", async () => {
    const { service, coordinator, admin, state } = setup();
    const mine = await service.tickets(coordinator, "open");
    expect(mine.ok && mine.value.map((t) => t.id)).toEqual(["t1"]);
    const all = await service.tickets(admin, "open");
    expect(all.ok && all.value).toHaveLength(2);

    const resolved = await service.resolveTicket(coordinator, "t1", "Called the store; refunded");
    expect(resolved.ok && resolved.value).toMatchObject({
      status: "resolved",
      resolution: "Called the store; refunded",
    });
    expect(state.audit.at(-1)).toMatchObject({ action: "ticket.resolve", entityId: "t1" });
    const again = await service.resolveTicket(coordinator, "t1", "Again");
    expect(!again.ok && again.error.code).toBe("CONFLICT");
  });

  it("treats another zone's ticket as missing and keeps customers out", async () => {
    const { service, coordinator, customer } = setup();
    const other = await service.resolveTicket(coordinator, "t2", "Not mine");
    expect(!other.ok && other.error.code).toBe("NOT_FOUND");
    expect((await service.resolveTicket(coordinator, "nope", "x")).ok).toBe(false);
    const blocked = await service.tickets(customer, "open");
    expect(!blocked.ok && blocked.error.code).toBe("FORBIDDEN");
  });
});

describe("RetentionAdminService: promo campaigns", () => {
  it("lets admins create campaigns with a budget, list them and switch them off, audited", async () => {
    const { service, admin, state } = setup();
    const created = await service.createPromo(admin, CAMPAIGN);
    expect(created.ok).toBe(true);
    expect(state.audit.at(-1)).toMatchObject({
      action: "promo.create",
      meta: { code: "PASKO50", type: "fixed_off", budgetCentavos: 500000 },
    });
    const duplicate = await service.createPromo(admin, CAMPAIGN);
    expect(!duplicate.ok && duplicate.error.code).toBe("CONFLICT");

    const id = created.ok ? created.value.id : "";
    expect((await service.setPromoActive(admin, id, false)).ok).toBe(true);
    expect(state.audit.at(-1)).toMatchObject({ action: "promo.deactivate", entityId: id });
    const list = await service.promos(admin);
    expect(list.ok && list.value).toMatchObject([{ code: "PASKO50", isActive: false }]);
    expect((await service.setPromoActive(admin, "nope", true)).ok).toBe(false);
  });

  it("keeps campaigns for admins only", async () => {
    const { service, coordinator } = setup();
    for (const result of [
      await service.promos(coordinator),
      await service.createPromo(coordinator, CAMPAIGN),
      await service.setPromoActive(coordinator, "x", false),
    ]) {
      expect(!result.ok && result.error.code).toBe("FORBIDDEN");
    }
  });
});
