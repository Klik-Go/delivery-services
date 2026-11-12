import { describe, expect, it } from "vitest";
import { opsWorld } from "../testing";
import { REQUIRED_KYC_DOCUMENTS } from "./ports";

const PHOTO = { bytes: new Uint8Array([1, 2, 3]), contentType: "image/jpeg" };

/** Ella applies in Makati and uploads all five documents. */
async function applied() {
  const w = opsWorld();
  const ella = { ...w.customer, id: "ella" };
  const applied = await w.onboarding.apply(ella, {
    zoneId: "makati",
    vehicleType: "motorcycle",
    plateNo: "NAB 1234",
    fullName: "Ella Rider",
    payoutAccountName: "Ella Rider",
  });
  if (!applied.ok) throw applied.error;
  for (const type of REQUIRED_KYC_DOCUMENTS) await w.onboarding.upload(ella, type, PHOTO);
  return { w, ella, riderId: applied.value.riderId };
}

describe("RiderOnboardingService", () => {
  it("creates a pending rider once and stores documents in the rider's private folder", async () => {
    const { w, ella, riderId } = await applied();
    expect([...w.state.files.keys()].every((path) => path.startsWith(`${riderId}/`))).toBe(true);
    expect([...w.state.files.keys()][0]).toMatch(/^rider-\d+\/government_id-id\d+\.jpg$/);
    const again = await w.onboarding.apply(ella, {
      zoneId: "makati",
      vehicleType: "bicycle",
      fullName: "Ella",
      payoutAccountName: "Ella",
    });
    expect(!again.ok && again.error.code).toBe("CONFLICT");
    const status = await w.onboarding.status(ella);
    expect(status.ok && status.value?.checklist.map((item) => item.state)).toEqual(
      Array(5).fill("pending"),
    );
  });

  it("refuses unknown zones, strangers and duplicate uploads", async () => {
    const { w, ella } = await applied();
    const zone = await w.onboarding.apply(
      { ...w.customer, id: "ken" },
      {
        zoneId: "atlantis",
        vehicleType: "bicycle",
        fullName: "Ken",
        payoutAccountName: "Ken",
      },
    );
    expect(!zone.ok && zone.error.code).toBe("VALIDATION_FAILED");
    expect(
      (
        await w.onboarding.apply(null, {
          zoneId: "makati",
          vehicleType: "bicycle",
          fullName: "X",
          payoutAccountName: "X",
        })
      ).ok,
    ).toBe(false);
    expect((await w.onboarding.status(null)).ok).toBe(false);
    expect(await w.onboarding.status(w.customer)).toEqual({ ok: true, value: null });
    const stranger = await w.onboarding.upload(w.customer, "selfie_with_id", PHOTO);
    expect(!stranger.ok && stranger.error.code).toBe("FORBIDDEN");
    expect((await w.onboarding.upload(null, "selfie_with_id", PHOTO)).ok).toBe(false);
    const duplicate = await w.onboarding.upload(ella, "selfie_with_id", PHOTO);
    expect(!duplicate.ok && duplicate.error.code).toBe("CONFLICT");
  });

  it("keeps the rider waiting when storage is down", async () => {
    const w = opsWorld();
    const ella = { ...w.customer, id: "ella" };
    await w.onboarding.apply(ella, {
      zoneId: "makati",
      vehicleType: "motorcycle",
      fullName: "Ella",
      payoutAccountName: "Ella",
    });
    w.kyc.down = true;
    const failed = await w.onboarding.upload(ella, "government_id", {
      bytes: new Uint8Array([1]),
      contentType: "application/pdf",
    });
    expect(!failed.ok && failed.error.code).toBe("UNAVAILABLE");
    expect(w.state.documents).toEqual([]);
  });
});

describe("RiderAdminService", () => {
  it("queues the application in its zone with the checklist", async () => {
    const { w } = await applied();
    const queue = await w.riders.list(w.coordinator, "pending");
    expect(queue.ok && queue.value.map((r) => [r.name, r.checklist.length])).toEqual([
      ["Ella Rider", 5],
    ]);
    const other = await w.riders.list(w.otherCoordinator, "pending");
    expect(other).toEqual({ ok: true, value: [] });
    expect((await w.riders.list(w.customer, "pending")).ok).toBe(false);
  });

  it("opens a document through a 60-second link and audits the view", async () => {
    const { w } = await applied();
    const doc = w.state.documents[0];
    const link = await w.riders.viewDocument(w.coordinator, doc?.id ?? "");
    expect(link.ok && link.value.url).toMatch(/expires=60$/);
    expect(link.ok && link.value.expiresAt).toEqual(new Date(w.clock.now().getTime() + 60_000));
    expect(w.state.audit.at(-1)).toMatchObject({ action: "kyc.view", entityId: doc?.id });
    const outsider = await w.riders.viewDocument(w.otherCoordinator, doc?.id ?? "");
    expect(!outsider.ok && outsider.error.code).toBe("NOT_FOUND");
    expect((await w.riders.viewDocument(w.coordinator, "missing")).ok).toBe(false);
    expect((await w.riders.viewDocument(null, "missing")).ok).toBe(false);
    w.kyc.down = true;
    expect((await w.riders.viewDocument(w.coordinator, doc?.id ?? "")).ok).toBe(false);
  });

  it("approves a rider only when every document is accepted, then tells them", async () => {
    const { w, riderId } = await applied();
    const early = await w.riders.setStatus(w.coordinator, riderId, { status: "active" });
    expect(!early.ok && early.error.message).toMatch(/government id/);
    for (const doc of [...w.state.documents]) {
      expect(
        (await w.riders.reviewDocument(w.coordinator, doc.id, { decision: "approve" })).ok,
      ).toBe(true);
    }
    const approved = await w.riders.setStatus(w.coordinator, riderId, { status: "active" });
    expect(approved.ok && approved.value.status).toBe("active");
    expect(w.state.audit.at(-1)).toMatchObject({
      action: "rider.approve",
      actorRole: "coordinator",
    });
    expect(w.messages.sent.at(-1)).toMatchObject({ userId: "ella", template: "rider_approved" });
    const again = await w.riders.setStatus(w.coordinator, riderId, { status: "active" });
    expect(!again.ok && again.error.code).toBe("CONFLICT");
  });

  it("rejects a document with a reason, which the rider sees, and lets them upload again", async () => {
    const { w, ella } = await applied();
    const selfie = w.state.documents.find((d) => d.type === "selfie_with_id");
    const rejected = await w.riders.reviewDocument(w.coordinator, selfie?.id ?? "", {
      decision: "reject",
      reason: "Face is not visible",
    });
    expect(rejected.ok).toBe(true);
    expect(w.state.audit.at(-1)).toMatchObject({
      action: "kyc.reject",
      meta: { reason: "Face is not visible" },
    });
    const twice = await w.riders.reviewDocument(w.coordinator, selfie?.id ?? "", {
      decision: "approve",
    });
    expect(!twice.ok && twice.error.code).toBe("CONFLICT");
    const status = await w.onboarding.status(ella);
    const item = status.ok
      ? status.value?.checklist.find((c) => c.type === "selfie_with_id")
      : undefined;
    expect(item).toMatchObject({
      state: "rejected",
      document: { rejectionReason: "Face is not visible" },
    });
    expect((await w.onboarding.upload(ella, "selfie_with_id", PHOTO)).ok).toBe(true);
    expect(
      (await w.riders.reviewDocument(w.otherCoordinator, selfie?.id ?? "", { decision: "approve" }))
        .ok,
    ).toBe(false);
    expect(
      (await w.riders.reviewDocument(w.coordinator, "missing", { decision: "approve" })).ok,
    ).toBe(false);
    expect((await w.riders.reviewDocument(null, "missing", { decision: "approve" })).ok).toBe(
      false,
    );
  });

  it("suspends a rider (offline at once) and reactivates them, with reasons", async () => {
    const w = opsWorld();
    w.state.addRider({ id: "rosa", isOnline: true });
    const suspended = await w.riders.setStatus(w.coordinator, "rosa", {
      status: "suspended",
      reason: "No-shows",
    });
    expect(suspended.ok && suspended.value).toMatchObject({
      status: "suspended",
      statusReason: "No-shows",
    });
    expect(w.state.riders[0]?.isOnline).toBe(false);
    expect(w.state.audit.at(-1)).toMatchObject({
      action: "rider.suspend",
      meta: { reason: "No-shows" },
    });
    await w.riders.setStatus(w.coordinator, "rosa", { status: "active", reason: "Coached" });
    expect(w.state.audit.at(-1)?.action).toBe("rider.reactivate");
    expect((await w.riders.rider(w.otherCoordinator, "rosa")).ok).toBe(false);
    expect((await w.riders.rider(w.coordinator, "ghost")).ok).toBe(false);
    expect((await w.riders.rider(null, "rosa")).ok).toBe(false);
  });

  it("lists low-rated riders for coaching", async () => {
    const w = opsWorld();
    w.state.addRider({ id: "rey", ratingAvg: 3.2, ratingCount: 12 });
    w.state.addRider({ id: "new", ratingAvg: 2, ratingCount: 2 });
    w.state.addRider({ id: "rosa", ratingAvg: 4.9, ratingCount: 50 });
    const coaching = await w.riders.list(w.coordinator, "coaching");
    expect(coaching.ok && coaching.value.map((r) => r.id)).toEqual(["rey"]);
    const active = await w.riders.list(w.admin, "active");
    expect(active.ok && active.value.length).toBe(3);
    expect((await w.riders.list(w.admin, "suspended")).ok).toBe(true);
  });
});
