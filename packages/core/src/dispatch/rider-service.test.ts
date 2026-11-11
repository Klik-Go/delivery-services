import { describe, expect, it } from "vitest";
import { dispatchWorld, ROSA_AT, sessionUser } from "../testing";
import { maskPhone } from "./rider-service";

const PHOTO = { bytes: new Uint8Array([1, 2, 3]), contentType: "image/jpeg" };

/** Rosa holds order o1 (cash on delivery, ₱239.00 with a ₱20.00 tip in it). */
async function onJob(
  overrides: Parameters<ReturnType<typeof dispatchWorld>["db"]["addOrder"]>[0] = { id: "o1" },
) {
  const w = dispatchWorld();
  w.db.addRider({ id: "rosa", location: ROSA_AT });
  w.db.addOrder({ tipCentavos: 2000, ...overrides });
  await w.dispatch.dispatch(overrides.id);
  const offer = await w.riders.currentOffer(w.riderUser("rosa"));
  if (!offer.ok || !offer.value) throw new Error("no offer");
  await w.riders.answerOffer(w.riderUser("rosa"), offer.value.offerId, "accepted");
  return { w, rosa: w.riderUser("rosa") };
}

describe("RiderService", () => {
  it("refuses people who are not riders", async () => {
    const w = dispatchWorld();
    expect((await w.riders.status(null)).ok).toBe(false);
    const customer = await w.riders.status(w.customer);
    expect(!customer.ok && customer.error.code).toBe("FORBIDDEN");
    const unregistered = await w.riders.status(sessionUser("x", [{ role: "rider" }], "aal1"));
    expect(!unregistered.ok && unregistered.error.code).toBe("FORBIDDEN");
    w.db.addRider({ id: "sus", status: "suspended" });
    const suspended = await w.riders.status(w.riderUser("sus"));
    expect(!suspended.ok && suspended.error.message).toMatch(/on hold/);
  });

  it("lets an approved rider go online and offline", async () => {
    const w = dispatchWorld();
    w.db.addRider({ id: "rosa", isOnline: false });
    expect(await w.riders.setOnline(w.riderUser("rosa"), true)).toEqual({
      ok: true,
      value: { online: true },
    });
    expect(w.db.rider("rosa").isOnline).toBe(true);
    expect((await w.riders.setOnline(w.riderUser("rosa"), false)).ok).toBe(true);
    expect(w.db.rider("rosa").isOnline).toBe(false);
  });

  it("keeps riders awaiting approval offline", async () => {
    const w = dispatchWorld();
    w.db.addRider({ id: "rey", status: "pending_kyc", isOnline: false });
    const result = await w.riders.setOnline(w.riderUser("rey"), true);
    expect(!result.ok && result.error.code).toBe("FORBIDDEN");
  });

  it("keeps a rider online until their delivery is done", async () => {
    const { w, rosa } = await onJob();
    const result = await w.riders.setOnline(rosa, false);
    expect(!result.ok && result.error.code).toBe("CONFLICT");
    const status = await w.riders.status(rosa);
    expect(status.ok && status.value.activeOrderId).toBe("o1");
  });

  it("stores positions at most every 4 seconds and leaves breadcrumbs on a job", async () => {
    const { w, rosa } = await onJob();
    w.clock.advanceBy(5000);
    expect(await w.riders.updateLocation(rosa, { lat: 14.5585, lng: 121.019 })).toEqual({
      ok: true,
      value: { saved: true },
    });
    w.clock.advanceBy(1000);
    expect(await w.riders.updateLocation(rosa, { lat: 14.5586, lng: 121.019 })).toEqual({
      ok: true,
      value: { saved: false },
    });
    expect(w.db.breadcrumbs).toHaveLength(1);
  });

  it("refuses positions from an offline rider", async () => {
    const w = dispatchWorld();
    w.db.addRider({ id: "rosa", isOnline: false });
    const result = await w.riders.updateLocation(w.riderUser("rosa"), ROSA_AT);
    expect(!result.ok && result.error.code).toBe("CONFLICT");
  });

  it("refuses to take a job while offline", async () => {
    const w = dispatchWorld();
    w.db.addRider({ id: "rosa", location: ROSA_AT });
    w.db.addOrder({ id: "o1" });
    await w.dispatch.dispatch("o1");
    w.db.rider("rosa").isOnline = false;
    const result = await w.riders.answerOffer(w.riderUser("rosa"), "offer-1", "accepted");
    expect(!result.ok && result.error.code).toBe("CONFLICT");
  });

  it("shows the offer with the pay, the cash to collect and only the drop-off area", async () => {
    const w = dispatchWorld();
    w.db.addRider({ id: "rosa", location: ROSA_AT });
    w.db.addOrder({ id: "o1" });
    await w.dispatch.dispatch("o1");
    const offer = await w.riders.currentOffer(w.riderUser("rosa"));
    expect(offer.ok && offer.value).toMatchObject({
      storeName: "Kape't Tinapay",
      earningsCentavos: 3500,
      cashToCollectCentavos: 23_900,
      dropoffArea: "Bel-Air",
    });
    expect(offer.ok && offer.value && "landmark" in offer.value).toBe(false);
  });

  it("shows the job with the landmark, a masked number and the cash to collect", async () => {
    const { w, rosa } = await onJob();
    const job = await w.riders.activeJob(rosa);
    expect(job.ok && job.value).toMatchObject({
      contactPhone: "+63 ••• ••• 4567",
      cashToCollectCentavos: 23_900,
      dropoff: expect.objectContaining({ landmark: "Lobby of the blue tower" }) as unknown,
      pinRequired: false,
    });
    w.db.addRider({ id: "rico" });
    expect(await w.riders.activeJob(w.riderUser("rico"))).toEqual({ ok: true, value: null });
  });

  it("walks the job through store arrival, pickup and delivery with a photo", async () => {
    const { w, rosa } = await onJob();
    const arrived = await w.riders.arrivedAtStore(rosa, "o1");
    expect(arrived.ok && arrived.value.arrivedStoreAt).toEqual(w.clock.now());
    expect((await w.riders.arrivedAtStore(rosa, "o1")).ok).toBe(true);

    const early = await w.riders.pickedUp(rosa, "o1");
    expect(!early.ok && early.error.message).toMatch(/hasn't marked this order ready/);

    w.db.order("o1").status = "ready";
    const picked = await w.riders.pickedUp(rosa, "o1");
    expect(picked.ok && picked.value.status).toBe("picked_up");

    const noPhoto = await w.riders.delivered(rosa, "o1", {});
    expect(!noPhoto.ok && noPhoto.error.code).toBe("VALIDATION_FAILED");

    const done = await w.riders.delivered(rosa, "o1", { photo: PHOTO });
    expect(done).toEqual({ ok: true, value: { orderId: "o1", status: "delivered" } });
    expect(w.db.order("o1").proofPath).toBe("o1/proof-1.jpg");
    expect(w.notifier.changes.map((c) => c.to)).toEqual(["picked_up", "delivered"]);

    const [txn] = w.db.ledger;
    const debits = txn?.lines.reduce((s, l) => s + l.debitCentavos, 0);
    const credits = txn?.lines.reduce((s, l) => s + l.creditCentavos, 0);
    expect(debits).toBe(credits);
    expect(txn?.lines.find((l) => l.account === "rider_payable")?.creditCentavos).toBe(5500);
    expect(txn?.lines.find((l) => l.account === "merchant_payable")?.creditCentavos).toBe(
      19_000 - 2850,
    );

    const earnings = await w.riders.earnings(rosa);
    expect(earnings.ok && earnings.value).toMatchObject({
      today: { jobs: 1, payCentavos: 3500, tipCentavos: 2000 },
      week: { jobs: 1 },
      cashHeldCentavos: 23_900,
      cashLimitCentavos: 300_000,
    });
    expect((await w.riders.setOnline(rosa, false)).ok).toBe(true);
  });

  it("charges founding stores no commission", async () => {
    const { w, rosa } = await onJob({
      id: "o1",
      commissionFreeUntil: new Date("2027-05-01T00:00:00Z"),
    });
    w.db.order("o1").status = "picked_up";
    await w.riders.delivered(rosa, "o1", { photo: PHOTO });
    expect(
      w.db.ledger[0]?.lines.find((l) => l.account === "merchant_payable")?.creditCentavos,
    ).toBe(19_000);
  });

  it("needs the customer's PIN for big orders and limits wrong guesses", async () => {
    const { w, rosa } = await onJob({ id: "o1", pin: "4821", totalCentavos: 60_000 });
    w.db.order("o1").status = "picked_up";
    const photoOnly = await w.riders.delivered(rosa, "o1", { photo: PHOTO });
    expect(!photoOnly.ok && photoOnly.error.message).toMatch(/PIN/);
    const wrong = await w.riders.delivered(rosa, "o1", { pin: "0000" });
    expect(!wrong.ok && wrong.error.code).toBe("VALIDATION_FAILED");
    expect((await w.riders.delivered(rosa, "o1", { pin: "4821" })).ok).toBe(true);
  });

  it("stops PIN guessing after five tries", async () => {
    const { w, rosa } = await onJob({ id: "o1", pin: "4821" });
    w.db.order("o1").status = "picked_up";
    for (let i = 0; i < 5; i += 1) await w.riders.delivered(rosa, "o1", { pin: "0000" });
    const blocked = await w.riders.delivered(rosa, "o1", { pin: "4821" });
    expect(!blocked.ok && blocked.error.code).toBe("RATE_LIMITED");
  });

  it("refuses delivery before pickup and steps on someone else's job", async () => {
    const { w, rosa } = await onJob();
    const early = await w.riders.delivered(rosa, "o1", { photo: PHOTO });
    expect(!early.ok && early.error.code).toBe("CONFLICT");
    w.db.addRider({ id: "rico" });
    const other = await w.riders.arrivedAtStore(w.riderUser("rico"), "o1");
    expect(!other.ok && other.error.code).toBe("NOT_FOUND");
  });

  it("reports a change that raced the rider as a conflict", async () => {
    const { w, rosa } = await onJob();
    w.db.order("o1").status = "ready";
    w.db.pickUp = () => Promise.resolve(false);
    expect((await w.riders.pickedUp(rosa, "o1")).ok).toBe(false);
    w.db.markArrivedAtStore = () => Promise.resolve(false);
    expect((await w.riders.arrivedAtStore(rosa, "o1")).ok).toBe(false);
    w.db.order("o1").status = "picked_up";
    w.db.deliver = () => Promise.resolve(false);
    const raced = await w.riders.delivered(rosa, "o1", { photo: PHOTO });
    expect(!raced.ok && raced.error.code).toBe("CONFLICT");
  });

  it("keeps the order with the rider when the photo cannot be stored", async () => {
    const { w, rosa } = await onJob();
    w.db.order("o1").status = "picked_up";
    w.db.storageDown = true;
    const failed = await w.riders.delivered(rosa, "o1", { photo: PHOTO });
    expect(!failed.ok && failed.error.code).toBe("UNAVAILABLE");
    expect(w.db.order("o1").status).toBe("picked_up");
  });

  it("does not place calls until the relay exists", () => {
    const w = dispatchWorld();
    const call = w.riders.callCustomer();
    expect(!call.ok && call.error.code).toBe("UNAVAILABLE");
  });

  it("masks phone numbers down to the last four digits", () => {
    expect(maskPhone("+639171234567")).toBe("+63 ••• ••• 4567");
    expect(maskPhone(null)).toBeNull();
    expect(maskPhone("12")).toBeNull();
  });
});

describe("TrackingService", () => {
  it("hides the rider before one is assigned", async () => {
    const w = dispatchWorld();
    w.db.addOrder({ id: "o1" });
    const view = await w.tracking.view("o1", w.customer);
    expect(view.ok && view.value).toMatchObject({ rider: null, etaMinutes: null });
  });

  it("shows the assigned rider moving with an arrival estimate", async () => {
    const { w } = await onJob();
    const before = await w.tracking.view("o1", w.customer);
    expect(before.ok && before.value.rider).toMatchObject({ firstName: "rosa", location: ROSA_AT });
    expect(before.ok && before.value.etaMinutes).toBeGreaterThan(0);

    w.db.order("o1").status = "picked_up";
    w.db.rider("rosa").location = { lat: 14.5548, lng: 121.0243 };
    const near = await w.tracking.view("o1", w.customer);
    expect(near.ok && near.value.etaMinutes).toBe(1);
  });

  it("waits for the food when the store needs longer than the ride", async () => {
    const { w } = await onJob({ id: "o1", readyBy: new Date("2026-11-13T04:20:00Z") });
    const view = await w.tracking.view("o1", w.customer);
    expect(view.ok && view.value.etaMinutes).toBeGreaterThanOrEqual(20);
  });

  it("hides the rider again once the order is delivered", async () => {
    const { w } = await onJob();
    w.db.order("o1").status = "delivered";
    const view = await w.tracking.view("o1", w.customer);
    expect(view.ok && view.value.rider).toBeNull();
  });

  it("treats other people's orders as missing", async () => {
    const { w } = await onJob();
    expect((await w.tracking.view("o1", null)).ok).toBe(false);
    const stranger = await w.tracking.view(
      "o1",
      sessionUser("stranger", [{ role: "customer" }], "aal1"),
    );
    expect(!stranger.ok && stranger.error.code).toBe("NOT_FOUND");
  });
});
