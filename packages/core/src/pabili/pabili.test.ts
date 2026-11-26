import type { PlacePabiliRequest } from "@klikgo/types";
import { describe, expect, it } from "vitest";
import { customerMayCancel } from "../ordering/order-lifecycle-service";
import { OrderStateMachine } from "../ordering/order-state-machine";
import { BEL_AIR, pabiliWorld, ROSA_AT, RICO_AT, SARI_SARI_AT, sessionUser } from "../testing";

const RECEIPT = {
  bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16]),
  contentType: "image/jpeg",
};

const LIST: PlacePabiliRequest = {
  storeName: "Aling Nena Sari-sari",
  storeNotes: "Beside the chapel",
  pickup: SARI_SARI_AT,
  dropoff: BEL_AIR,
  budgetCentavos: 50_000,
  items: [
    { description: "Eggs (medium)", quantity: 12 },
    { description: "Pandesal", quantity: 10, note: "Fresh if possible" },
  ],
  address: { label: "Home", landmark: "Blue gate", contactPhone: "+639171234567" },
};

function setup() {
  const w = pabiliWorld();
  // Rosa is nearest but carries no float; Rico has enough for the budget.
  w.db.addRider({ id: "rosa", location: ROSA_AT });
  w.db.addRider({ id: "rico", location: RICO_AT, pabiliFloatCentavos: 100_000 });
  return w;
}

async function placed(w: ReturnType<typeof setup>, key = "pabili-key-0000001") {
  const result = await w.pabili.place(LIST, { idempotencyKey: key, actor: w.customer });
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

/** Places the order and has Rico accept it. */
async function taken(w: ReturnType<typeof setup>) {
  const order = await placed(w);
  const offer = w.db.offers.find((f) => f.orderId === order.orderId);
  if (!offer) throw new Error("no offer");
  const answered = await w.riders.answerOffer(w.riderUser("rico"), offer.id, "accepted");
  if (!answered.ok) throw new Error(answered.error.message);
  return order;
}

const allBought = [
  { position: 1, status: "bought" as const },
  { position: 2, status: "bought" as const },
];

describe("PabiliService: pricing and placing", () => {
  it("prices the list: the zone's delivery fee for the shop → drop-off trip plus the Pabili fee", async () => {
    const w = setup();
    const quote = await w.pabili.quote(LIST, w.customer);
    expect(quote.ok && quote.value).toMatchObject({
      zoneId: "makati",
      budgetCentavos: 50_000,
      deliveryFeeCentavos: 3_900,
      serviceFeeCentavos: 4_900,
      feesCentavos: 8_800,
      maxToPayCentavos: 58_800,
      inviteRequired: false,
    });
  });

  it("refuses while switched off, over the item cap, with too many lines, or a shop too far or outside the zone", async () => {
    const w = setup();
    const reasons = async (input: PlacePabiliRequest) => {
      const r = await w.pabili.quote(input, w.customer);
      return r.ok ? "ok" : r.error.message;
    };
    expect(await reasons({ ...LIST, budgetCentavos: 150_001 })).toMatch(/most a rider can spend/);
    w.settings.value = { ...w.settings.value, maxItems: 1 };
    expect(await reasons(LIST)).toMatch(/up to 1 items/);
    w.settings.value = { ...w.settings.value, maxItems: 20, maxTripM: 100 };
    expect(await reasons(LIST)).toMatch(/too far/);
    w.settings.value = { ...w.settings.value, maxTripM: 5000 };
    expect(await reasons({ ...LIST, pickup: { lat: 14.7, lng: 121.0 } })).toMatch(/delivery area/);
    expect(await reasons({ ...LIST, dropoff: { lat: 14.7, lng: 121.0 } })).toMatch(/don't deliver/);
    w.settings.value = { ...w.settings.value, enabled: false };
    expect(await reasons(LIST)).toMatch(/isn't available/);
  });

  it("places a cash order with no store that Klik Go takes at once, and offers it only to a rider whose float covers the budget", async () => {
    const w = setup();
    const order = await placed(w);
    expect(order.totalCentavos).toBe(8_800);
    const row = w.db.order(order.orderId);
    expect(row).toMatchObject({
      kind: "pabili",
      merchantId: null,
      status: "accepted",
      paymentMethod: "cod",
    });
    expect(row.events).toEqual([
      ["placed", "customer"],
      ["accepted", "system"],
    ]);
    // Rosa is nearer but has no float, so Rico gets the offer.
    expect(w.db.offers.map((f) => f.riderId)).toEqual(["rico"]);
    expect(row.pabili?.list.map((l) => l.status)).toEqual(["pending", "pending"]);
  });

  it("tells the coordinator when no rider has enough float", async () => {
    const w = pabiliWorld();
    w.db.addRider({ id: "rosa", location: ROSA_AT, pabiliFloatCentavos: 10_000 });
    const order = await placed(w);
    expect(w.db.offers).toEqual([]);
    expect(w.db.order(order.orderId).flaggedAt).not.toBeNull();
  });

  it("answers a retry with the same key with the same order, and refuses the key for a different list", async () => {
    const w = setup();
    const first = await placed(w);
    const again = await w.pabili.place(LIST, {
      idempotencyKey: "pabili-key-0000001",
      actor: w.customer,
    });
    expect(again.ok && again.value.orderId).toBe(first.orderId);
    expect(w.db.orders.filter((o) => o.kind === "pabili")).toHaveLength(1);
    const other = await w.pabili.place(
      { ...LIST, budgetCentavos: 40_000 },
      { idempotencyKey: "pabili-key-0000001", actor: w.customer },
    );
    expect(!other.ok && other.error.code).toBe("CONFLICT");
  });

  it("keeps the invite-only gate: customers without a code can't place a Pabili order", async () => {
    const w = setup();
    w.allowOnly = [];
    const quote = await w.pabili.quote(LIST, w.customer);
    expect(quote.ok && quote.value.inviteRequired).toBe(true);
    const r = await w.pabili.place(LIST, {
      idempotencyKey: "pabili-key-0000002",
      actor: w.customer,
    });
    expect(!r.ok && r.error.code).toBe("FORBIDDEN");
  });
});

describe("PabiliService: the rider shops, records the receipt and delivers", () => {
  it("goes accepted → shopping → bought → picked up → delivered; the rider collects the receipt total plus fees", async () => {
    const w = setup();
    const order = await taken(w);
    const rico = w.riderUser("rico");

    const shopping = await w.pabili.startShopping(rico, order.orderId);
    expect(shopping.ok && shopping.value.status).toBe("preparing");

    const tooEarly = await w.riders.pickedUp(rico, order.orderId);
    expect(!tooEarly.ok && tooEarly.error.message).toMatch(/Record what you bought/);

    const bought = await w.pabili.recordPurchase(
      rico,
      order.orderId,
      { itemCostCentavos: 31_250, items: [allBought[0]!, { position: 2, status: "unavailable" }] },
      RECEIPT,
    );
    expect(bought.ok && bought.value).toMatchObject({
      status: "ready",
      itemCostCentavos: 31_250,
      toPayCentavos: 40_050,
    });
    expect(w.db.order(order.orderId).pabili?.list.map((l) => l.status)).toEqual([
      "bought",
      "unavailable",
    ]);

    const job = await w.riders.activeJob(rico);
    expect(job.ok && job.value?.cashToCollectCentavos).toBe(40_050);

    expect((await w.riders.pickedUp(rico, order.orderId)).ok).toBe(true);
    const done = await w.riders.delivered(rico, order.orderId, { photo: RECEIPT });
    expect(done.ok).toBe(true);
    expect(w.db.order(order.orderId).events.map(([to]) => to)).toEqual([
      "placed",
      "accepted",
      "preparing",
      "ready",
      "picked_up",
      "delivered",
    ]);

    // The ledger holds the fees only: the item cost passed from customer to rider directly.
    const lines = w.db.ledger[0]?.lines ?? [];
    expect(lines.some((l) => l.account === "merchant_payable")).toBe(false);
    expect(lines.find((l) => l.account === "rider_cash_on_hand")?.debitCentavos).toBe(8_800);
  });

  it("refuses a purchase over the budget, without a receipt photo, or with a file that isn't a photo", async () => {
    const w = setup();
    const order = await taken(w);
    const rico = w.riderUser("rico");
    await w.pabili.startShopping(rico, order.orderId);
    const attempt = (cost: number, photo: typeof RECEIPT | null) =>
      w.pabili.recordPurchase(
        rico,
        order.orderId,
        { itemCostCentavos: cost, items: allBought },
        photo,
      );

    const over = await attempt(50_001, RECEIPT);
    expect(!over.ok && over.error.message).toMatch(/over the customer's budget/);
    const noPhoto = await attempt(30_000, null);
    expect(!noPhoto.ok && noPhoto.error.message).toMatch(/photo of the receipt/);
    const fake = await attempt(30_000, {
      bytes: new Uint8Array([1, 2, 3, 4]),
      contentType: "image/jpeg",
    });
    expect(!fake.ok && fake.error.message).toMatch(/not a photo/);
    expect(w.store.receipts).toEqual([]);
    expect(w.db.order(order.orderId).status).toBe("preparing");
  });

  it("needs every line answered once and a cost that matches what was bought", async () => {
    const w = setup();
    const order = await taken(w);
    const rico = w.riderUser("rico");
    await w.pabili.startShopping(rico, order.orderId);
    const attempt = async (
      cost: number,
      items: { position: number; status: "bought" | "unavailable" }[],
    ) => {
      const r = await w.pabili.recordPurchase(
        rico,
        order.orderId,
        { itemCostCentavos: cost, items },
        RECEIPT,
      );
      return r.ok ? "ok" : r.error.message;
    };
    expect(await attempt(1000, [allBought[0]!])).toMatch(/every item/);
    expect(await attempt(1000, [allBought[0]!, allBought[0]!])).toMatch(/once/);
    expect(await attempt(1000, [allBought[0]!, { position: 9, status: "bought" }])).toMatch(/once/);
    const none = [
      { position: 1, status: "unavailable" as const },
      { position: 2, status: "unavailable" as const },
    ];
    expect(await attempt(1000, none)).toMatch(/must be ₱0/);
    expect(await attempt(0, allBought)).toMatch(/total on the receipt/);
    expect(await attempt(0, none)).toBe("ok");
  });

  it("only lets the assigned rider shop, in order: start shopping before recording, never twice", async () => {
    const w = setup();
    const order = await taken(w);
    const rosa = w.riderUser("rosa");
    const notTheirs = await w.pabili.startShopping(rosa, order.orderId);
    expect(!notTheirs.ok && notTheirs.error.code).toBe("NOT_FOUND");

    const rico = w.riderUser("rico");
    const early = await w.pabili.recordPurchase(
      rico,
      order.orderId,
      { itemCostCentavos: 1000, items: allBought },
      RECEIPT,
    );
    expect(!early.ok && early.error.message).toMatch(/Start shopping first/);
    await w.pabili.startShopping(rico, order.orderId);
    const again = await w.pabili.startShopping(rico, order.orderId);
    expect(again.ok && again.value.status).toBe("preparing");
    await w.pabili.recordPurchase(
      rico,
      order.orderId,
      { itemCostCentavos: 1000, items: allBought },
      RECEIPT,
    );
    const twice = await w.pabili.recordPurchase(
      rico,
      order.orderId,
      { itemCostCentavos: 1000, items: allBought },
      RECEIPT,
    );
    expect(!twice.ok && twice.error.message).toMatch(/already recorded/);
  });

  it("refuses the purchase when the receipt can't be stored", async () => {
    const w = setup();
    const order = await taken(w);
    const rico = w.riderUser("rico");
    await w.pabili.startShopping(rico, order.orderId);
    w.store.storageDown = true;
    const r = await w.pabili.recordPurchase(
      rico,
      order.orderId,
      { itemCostCentavos: 1000, items: allBought },
      RECEIPT,
    );
    expect(!r.ok && r.error.code).toBe("UNAVAILABLE");
    expect(w.db.order(order.orderId).status).toBe("preparing");
  });
});

describe("PabiliService: who sees the list and receipt", () => {
  it("shows the customer, the rider on it, the zone's coordinator and admins; a five-minute receipt link once bought", async () => {
    const w = setup();
    const order = await taken(w);
    const rico = w.riderUser("rico");
    const before = await w.pabili.view(w.customer, order.orderId);
    expect(before.ok && before.value).toMatchObject({
      receiptUrl: null,
      toPayCentavos: null,
      feesCentavos: 8_800,
    });

    await w.pabili.startShopping(rico, order.orderId);
    await w.pabili.recordPurchase(
      rico,
      order.orderId,
      { itemCostCentavos: 20_000, items: allBought },
      RECEIPT,
    );
    const after = await w.pabili.view(w.customer, order.orderId);
    expect(after.ok && after.value.receiptUrl).toMatch(/receipt-1\.jpg\?expires=300$/);
    expect(w.logger.lines.some((e) => e.message === "pabili.receipt_viewed")).toBe(true);

    for (const viewer of [
      rico,
      sessionUser("coord", [{ role: "coordinator", zoneId: "makati" }]),
      sessionUser("ada", [{ role: "admin" }]),
    ]) {
      expect((await w.pabili.view(viewer, order.orderId)).ok, viewer.id).toBe(true);
    }
    for (const viewer of [
      sessionUser("customer-2", [{ role: "customer" }], "aal1"),
      w.riderUser("rosa"),
      sessionUser("coord-b", [{ role: "coordinator", zoneId: "cebu" }]),
      sessionUser("owner", [{ role: "merchant_owner", merchantId: "kape" }]),
    ]) {
      const r = await w.pabili.view(viewer, order.orderId);
      expect(!r.ok && r.error.code, viewer.id).toBe("NOT_FOUND");
    }
    expect((await w.pabili.view(null, order.orderId)).ok).toBe(false);
  });
});

describe("PabiliService: rider float", () => {
  it("lets a rider set a float up to their cash limit; others can't", async () => {
    const w = setup();
    const set = await w.pabili.setFloat(w.riderUser("rosa"), 80_000);
    expect(set.ok && set.value.floatCentavos).toBe(80_000);
    expect(w.db.rider("rosa").pabiliFloatCentavos).toBe(80_000);
    const over = await w.pabili.setFloat(w.riderUser("rosa"), 300_001);
    expect(!over.ok && over.error.message).toMatch(/cash limit/);
    expect((await w.pabili.setFloat(w.customer, 1000)).ok).toBe(false);
    expect((await w.pabili.options()).enabled).toBe(true);
  });
});

describe("Pabili lifecycle rules", () => {
  const states = new OrderStateMachine();

  it("lets Klik Go take, the rider shop and record, and nobody reject a Pabili order", () => {
    expect(states.check("placed", "accepted", "system", "pabili").ok).toBe(true);
    expect(states.check("placed", "accepted", "merchant_owner", "pabili").ok).toBe(false);
    expect(states.check("placed", "rejected", "merchant_owner", "pabili").ok).toBe(false);
    expect(states.check("accepted", "preparing", "rider", "pabili").ok).toBe(true);
    expect(states.check("preparing", "ready", "rider", "pabili").ok).toBe(true);
    expect(states.check("preparing", "ready", "merchant_staff", "pabili").ok).toBe(false);
    // Store orders keep their rules.
    expect(states.check("accepted", "preparing", "rider").ok).toBe(false);
    expect(states.nextFor("accepted", "customer", "pabili")).toEqual(["cancelled"]);
    expect(states.nextFor("accepted", "customer")).toEqual([]);
  });

  it("lets the customer cancel a Pabili order until a rider takes it", () => {
    const pabili = { kind: "pabili" as const, riderId: null };
    expect(customerMayCancel({ ...pabili, status: "accepted" })).toBe(true);
    expect(customerMayCancel({ ...pabili, status: "accepted", riderId: "rico" })).toBe(false);
    expect(customerMayCancel({ ...pabili, status: "preparing" })).toBe(false);
    expect(customerMayCancel({ kind: "store", riderId: null, status: "accepted" })).toBe(false);
    expect(customerMayCancel({ kind: "store", riderId: null, status: "placed" })).toBe(true);
  });
});
