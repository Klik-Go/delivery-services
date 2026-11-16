import { describe, expect, it } from "vitest";
import { AuthorizationService } from "../auth/authorization-service";
import { ConsoleAccess } from "../ops/console-access";
import { csvPesos, toCsv } from "../shared/csv";
import { FakeClock } from "../testing/fake-clock";
import { InMemoryFinance } from "../testing/finance-fakes";
import { MemoryLogger } from "../testing/memory-logger";
import { MemoryAuditLog, OpsState } from "../testing/ops-fakes";
import { sessionUser } from "../testing/session-users";
import { ManualDisbursement, PayoutService } from "./payout-service";
import { RemittanceService } from "./remittance-service";
import { ReportService } from "./report-service";
import { MIN_PAYOUT_CENTAVOS, SettlementService } from "./settlement-service";
import { previousWeek, weekOf, weekStarting } from "./week";

/** Tuesday 2026-11-10 10:00 Manila: the week of Mon 9 – Sun 15 November. */
const TUESDAY = new Date("2026-11-10T02:00:00Z");
/** Monday 2026-11-16 09:00 Manila: settlement day for the week of 9–15 November. */
const NEXT_MONDAY = new Date("2026-11-16T01:00:00Z");

function world(now = NEXT_MONDAY) {
  const clock = new FakeClock(now);
  const finance = new InMemoryFinance(() => clock.now());
  const state = new OpsState(() => clock.now());
  const authz = new AuthorizationService();
  const access = new ConsoleAccess(authz, new MemoryAuditLog(state));
  const logger = new MemoryLogger();
  finance.names.set("nena", "Aling Nena's").set("rico", "Rico Rider").set("rosa", "Rosa Rider");
  finance.riders.set("rico", { zoneId: "makati", userId: "rico-user", cashLimitCentavos: 300_000 });
  finance.riders.set("rosa", {
    zoneId: "pampanga",
    userId: "rosa-user",
    cashLimitCentavos: 300_000,
  });
  finance.accounts.set("merchant:nena", {
    method: "gcash",
    accountName: "Nena Santos",
    accountNumber: "09170000011",
    bankName: null,
  });
  return {
    clock,
    finance,
    state,
    settlement: new SettlementService({ settlements: finance, access, clock, logger }),
    payouts: new PayoutService({
      payouts: finance,
      access,
      authz,
      disbursement: new ManualDisbursement(),
      logger,
    }),
    remittances: new RemittanceService({ remittances: finance, access, logger }),
    reports: new ReportService({ reports: finance, access }),
    admin: sessionUser("admin-1", [{ role: "admin" }]),
    coordinator: sessionUser("coord", [{ role: "coordinator", zoneId: "makati" }]),
    owner: sessionUser("nena-owner", [{ role: "merchant_owner", merchantId: "nena" }]),
    staff: sessionUser("nena-staff", [{ role: "merchant_staff", merchantId: "nena" }]),
    rico: sessionUser("rico-user", [{ role: "rider" }], "aal1"),
  };
}

/** Two cash orders and one paid online in the week of 9–15 November, Rico riding all three. */
function week9to15(w: ReturnType<typeof world>): void {
  const at = (day: number) => new Date(Date.UTC(2026, 10, day, 4));
  w.finance.delivered({
    orderCode: "KG-AAAAAA",
    merchantId: "nena",
    riderId: "rico",
    merchantCentavos: 16_000,
    riderCentavos: 5_500,
    platformCentavos: 8_000,
    cash: true,
    at: at(10),
  });
  w.finance.delivered({
    orderCode: "KG-BBBBBB",
    merchantId: "nena",
    riderId: "rico",
    merchantCentavos: 24_000,
    riderCentavos: 4_500,
    platformCentavos: 9_900,
    cash: false,
    at: at(12),
  });
  w.finance.delivered({
    orderCode: "KG-CCCCCC",
    merchantId: "nena",
    riderId: "rico",
    merchantCentavos: 8_000,
    riderCentavos: 3_500,
    platformCentavos: 5_000,
    cash: true,
    at: at(14),
  });
}

describe("weeks (Monday to Sunday, Asia/Manila)", () => {
  it("finds the week of an instant and the week before", () => {
    expect(weekOf(TUESDAY)).toMatchObject({ start: "2026-11-09", end: "2026-11-15" });
    expect(weekOf(TUESDAY).startsAt.toISOString()).toBe("2026-11-08T16:00:00.000Z");
    expect(weekOf(TUESDAY).endsAt.toISOString()).toBe("2026-11-15T16:00:00.000Z");
    // Sunday 23:30 Manila still belongs to that week; Monday 00:30 to the next.
    expect(weekOf(new Date("2026-11-15T15:30:00Z")).start).toBe("2026-11-09");
    expect(weekOf(new Date("2026-11-15T16:30:00Z")).start).toBe("2026-11-16");
    expect(previousWeek(NEXT_MONDAY).start).toBe("2026-11-09");
  });

  it("accepts only Mondays as week starts", () => {
    expect(weekStarting("2026-11-09")?.end).toBe("2026-11-15");
    for (const bad of ["2026-11-10", "2026-02-30", "09-11-2026"])
      expect(weekStarting(bad)).toBeNull();
  });
});

describe("CSV for Google Sheets", () => {
  it("adds a byte-order mark, quotes text, keeps amounts numeric and defuses formulas", () => {
    const csv = toCsv(
      ["Name", "Amount"],
      [
        ['Kape\'t "Tinapay"', { centavos: 123_450 }],
        ["=HYPERLINK(1)", { centavos: -1005 }],
        [null, 7],
      ],
    );
    expect(csv).toBe(
      '﻿"Name","Amount"\r\n"Kape\'t ""Tinapay""",1234.50\r\n"\'=HYPERLINK(1)",-10.05\r\n,7\r\n',
    );
    expect(csvPesos(5)).toBe("0.05");
  });
});

describe("SettlementService", () => {
  it("pays the store its subtotal less commission and nets the rider's cash against earnings", async () => {
    const w = world();
    week9to15(w);
    const run = await w.settlement.settleDueWeek();
    expect(run).toMatchObject({ week: { start: "2026-11-09" }, payouts: 2 });

    const [store, rider] = await w.finance.payouts({ weekStart: "2026-11-09" });
    expect(store).toMatchObject({ partyId: "nena", amountCentavos: 48_000, status: "draft" });
    // Rico earned ₱135 and still holds ₱421 cash from two cash orders: all earnings are netted.
    expect(rider).toMatchObject({
      partyId: "rico",
      earningsCentavos: 13_500,
      cashNettedCentavos: 13_500,
      amountCentavos: 0,
      status: "paid",
      reference: "NETTED",
    });
    // Settlements equal the ledger: payables are cleared, the cash left is what he still owes.
    expect(w.finance.balance("merchant_payable", "nena")).toBe(0);
    expect(w.finance.balance("rider_payable", "rico")).toBe(0);
    expect(w.finance.balance("payouts_due", "nena")).toBe(-48_000);
    expect(w.finance.balance("rider_cash_on_hand", "rico")).toBe(29_500 + 16_500 - 13_500);
    expect(
      (await w.finance.lines(store?.id ?? "")).map((l) => [l.orderCode, l.amountCentavos]),
    ).toEqual([
      ["KG-AAAAAA", 16_000],
      ["KG-BBBBBB", 24_000],
      ["KG-CCCCCC", 8_000],
    ]);
  });

  it("pays a rider the difference when earnings exceed the cash held", async () => {
    const w = world();
    const at = new Date(Date.UTC(2026, 10, 11, 4));
    w.finance.delivered({
      orderCode: "KG-ONLINE",
      merchantId: "nena",
      riderId: "rosa",
      merchantCentavos: 20_000,
      riderCentavos: 15_000,
      platformCentavos: 5_000,
      cash: false,
      at,
    });
    w.finance.post(
      [
        { account: "rider_cash_on_hand", partyType: "rider", partyId: "rosa", debit: 2_000 },
        { account: "platform_revenue", partyType: "platform", partyId: null, credit: 2_000 },
      ],
      { at },
    );
    await w.settlement.settleDueWeek();
    const rosa = (await w.finance.payouts({ partyId: "rosa" }))[0];
    expect(rosa).toMatchObject({
      earningsCentavos: 15_000,
      cashNettedCentavos: 2_000,
      amountCentavos: 13_000,
      status: "draft",
    });
    const lines = await w.finance.lines(rosa?.id ?? "");
    expect(lines.map((l) => [l.kind, l.amountCentavos])).toEqual([
      ["order", 15_000],
      ["cash_netted", -2_000],
    ]);
    expect(w.finance.balance("rider_cash_on_hand", "rosa")).toBe(0);
  });

  it("carries small balances to the next week and settles each week once", async () => {
    const w = world();
    w.finance.delivered({
      orderCode: "KG-SMALL1",
      merchantId: "nena",
      riderId: "rosa",
      merchantCentavos: MIN_PAYOUT_CENTAVOS - 1,
      riderCentavos: 3_000,
      platformCentavos: 1_000,
      cash: false,
      at: new Date(Date.UTC(2026, 10, 3, 4)),
    });
    w.clock.set(new Date("2026-11-09T01:00:00Z"));
    await w.settlement.settleDueWeek();
    expect(w.finance.payoutsStore).toEqual([]);
    expect(await w.settlement.settleDueWeek()).toBeNull();

    w.finance.delivered({
      orderCode: "KG-SMALL2",
      merchantId: "nena",
      riderId: "rosa",
      merchantCentavos: 5_000,
      riderCentavos: 3_000,
      platformCentavos: 1_000,
      cash: false,
      at: new Date(Date.UTC(2026, 10, 10, 4)),
    });
    w.clock.set(NEXT_MONDAY);
    await w.settlement.settleDueWeek();
    const nena = (await w.finance.payouts({ partyId: "nena" }))[0];
    expect(nena?.amountCentavos).toBe(MIN_PAYOUT_CENTAVOS - 1 + 5_000);
    expect((await w.finance.lines(nena?.id ?? "")).map((l) => [l.kind, l.amountCentavos])).toEqual([
      ["carried_over", MIN_PAYOUT_CENTAVOS - 1],
      ["order", 5_000],
    ]);
  });

  it("lets admins settle a finished week by hand, once, audited", async () => {
    const w = world(TUESDAY);
    week9to15(w);
    const early = await w.settlement.settleWeek(w.admin, "2026-11-09");
    expect(!early.ok && early.error.message).toBe("This week isn't over yet.");
    w.clock.set(NEXT_MONDAY);
    expect((await w.settlement.settleWeek(w.admin, "2026-11-10")).ok).toBe(false);
    expect((await w.settlement.settleWeek(w.coordinator, "2026-11-09")).ok).toBe(false);
    const done = await w.settlement.settleWeek(w.admin, "2026-11-09");
    expect(done.ok && done.value.payouts).toBe(2);
    expect(w.state.audit.at(-1)).toMatchObject({ action: "settlement.run" });
    const again = await w.settlement.settleWeek(w.admin, "2026-11-09");
    expect(!again.ok && again.error.message).toBe("This week was already settled.");
  });
});

describe("PayoutService", () => {
  async function settled() {
    const w = world();
    week9to15(w);
    await w.settlement.settleDueWeek();
    const store = (await w.finance.payouts({ partyId: "nena" }))[0];
    return { w, storeId: store?.id ?? "" };
  }

  it("exports the transfer list and marks a payout paid once, with its reference", async () => {
    const { w, storeId } = await settled();
    const csv = await w.payouts.transferCsv(w.admin, "2026-11-09");
    expect(csv.ok && csv.value.body).toContain(
      '"Store","Aling Nena\'s","GCash","Nena Santos","09170000011","",480.00,""',
    );
    const paid = await w.payouts.markPaid(w.admin, storeId, "GC-20261120-001");
    expect(paid.ok && paid.value).toMatchObject({ status: "paid", reference: "GC-20261120-001" });
    expect(w.finance.balance("payouts_due", "nena")).toBe(0);
    expect(w.finance.balance("platform_cash", null)).toBe(-48_000);
    const twice = await w.payouts.markPaid(w.admin, storeId, "GC-AGAIN");
    expect(!twice.ok && twice.error.message).toBe("This payout was already marked paid.");
    expect(w.state.audit.map((a) => a.action)).toEqual(["payout.export", "payout.paid"]);
    const week = await w.payouts.week(w.admin, "2026-11-09");
    expect(week.ok && week.value.automatic).toBe(false);
  });

  it("returns a failed payout's money to the store, so the next week pays it", async () => {
    const { w, storeId } = await settled();
    const failed = await w.payouts.markFailed(w.admin, storeId, "Wrong GCash number");
    expect(failed.ok && failed.value.status).toBe("failed");
    expect(w.finance.balance("merchant_payable", "nena")).toBe(-48_000);
    expect((await w.payouts.markPaid(w.admin, storeId, "X1")).ok).toBe(false);
    expect((await w.payouts.markFailed(w.admin, storeId, "Again")).ok).toBe(false);
  });

  it("refuses to mark paid without a payout account, and keeps payouts for admins", async () => {
    const { w } = await settled();
    w.finance.delivered({
      orderCode: "KG-ROSA01",
      merchantId: "kape",
      riderId: "rosa",
      merchantCentavos: 30_000,
      riderCentavos: 15_000,
      platformCentavos: 5_000,
      cash: false,
      at: new Date(Date.UTC(2026, 10, 17, 4)),
    });
    w.clock.set(new Date("2026-11-23T01:00:00Z"));
    await w.settlement.settleDueWeek();
    const kape = (await w.finance.payouts({ partyId: "kape" }))[0];
    const noAccount = await w.payouts.markPaid(w.admin, kape?.id ?? "", "REF-1");
    expect(!noAccount.ok && noAccount.error.message).toBe(
      "Add where this payout goes before marking it paid.",
    );
    expect((await w.payouts.markPaid(w.admin, "nope", "REF")).ok).toBe(false);
    for (const result of [
      await w.payouts.week(w.coordinator, "2026-11-09"),
      await w.payouts.transferCsv(w.owner, "2026-11-09"),
      await w.payouts.markPaid(w.coordinator, kape?.id ?? "", "REF"),
    ]) {
      expect(!result.ok && result.error.code).toBe("FORBIDDEN");
    }
  });

  it("shows owners and riders their statements and lets them set where they are paid", async () => {
    const { w, storeId } = await settled();
    const page = await w.payouts.page(w.owner, { kind: "merchant", merchantId: "nena" });
    expect(page.ok && page.value).toMatchObject({
      openCentavos: 0,
      minimumCentavos: MIN_PAYOUT_CENTAVOS,
      account: { method: "gcash" },
    });
    const statement = await w.payouts.statementCsv(
      w.owner,
      { kind: "merchant", merchantId: "nena" },
      storeId,
    );
    expect(statement.ok && statement.value.body).toContain(
      '"KG-BBBBBB","Order (subtotal less commission) KG-BBBBBB",240.00',
    );
    expect(statement.ok && statement.value.body).toContain('"","","Total paid",480.00');
    // Staff don't see money; another store's payout reads as missing.
    expect((await w.payouts.page(w.staff, { kind: "merchant", merchantId: "nena" })).ok).toBe(
      false,
    );
    const other = sessionUser("kape-owner", [{ role: "merchant_owner", merchantId: "kape" }]);
    const theirs = await w.payouts.statement(
      other,
      { kind: "merchant", merchantId: "kape" },
      storeId,
    );
    expect(!theirs.ok && theirs.error.code).toBe("NOT_FOUND");

    const rider = await w.payouts.page(w.rico, { kind: "rider" });
    expect(rider.ok && rider.value).toMatchObject({
      cashHeldCentavos: 32_500,
      payouts: [{ amountCentavos: 0 }],
    });
    const saved = await w.payouts.saveAccount(
      w.rico,
      { kind: "rider" },
      {
        method: "bank",
        accountName: "Rico Rider",
        accountNumber: "0012 3456 7890",
        bankName: "BPI",
      },
    );
    expect(saved.ok && saved.value.bankName).toBe("BPI");
    const customer = sessionUser("carmen", [{ role: "customer" }], "aal1");
    expect((await w.payouts.page(customer, { kind: "rider" })).ok).toBe(false);
    expect((await w.payouts.page(null, { kind: "rider" })).ok).toBe(false);
  });
});

describe("RemittanceService (cash riders hand in)", () => {
  it("records cash handed in, never more than the rider holds, and frees the cash limit", async () => {
    const w = world(TUESDAY);
    week9to15(w);
    const holders = await w.remittances.holders(w.coordinator);
    expect(holders.ok && holders.value.map((h) => [h.riderId, h.cashHeldCentavos])).toEqual([
      ["rico", 46_000],
    ]);
    const tooMuch = await w.remittances.record(w.coordinator, {
      riderId: "rico",
      amountCentavos: 50_000,
      reference: "Hub",
    });
    expect(!tooMuch.ok && tooMuch.error.message).toBe("The rider holds ₱460.00. Check the amount.");
    const done = await w.remittances.record(w.coordinator, {
      riderId: "rico",
      amountCentavos: 40_000,
      reference: "Hub OR-0001",
    });
    expect(done.ok && done.value.cashHeldCentavos).toBe(6_000);
    expect(w.finance.balance("platform_cash", null)).toBe(40_000);
    expect(w.state.audit.at(-1)).toMatchObject({
      action: "cash.received",
      meta: { amountCentavos: 40_000 },
    });
  });

  it("keeps coordinators to their zone's riders", async () => {
    const w = world(TUESDAY);
    w.finance.post([
      { account: "rider_cash_on_hand", partyType: "rider", partyId: "rosa", debit: 5_000 },
      { account: "platform_revenue", partyType: "platform", partyId: null, credit: 5_000 },
    ]);
    const other = await w.remittances.record(w.coordinator, {
      riderId: "rosa",
      amountCentavos: 1_000,
      reference: "x1",
    });
    expect(!other.ok && other.error.code).toBe("NOT_FOUND");
    const none = await w.remittances.record(w.coordinator, {
      riderId: "rico",
      amountCentavos: 1_000,
      reference: "x1",
    });
    expect(!none.ok && none.error.message).toBe("This rider holds no cash right now.");
    expect(
      (
        await w.remittances.record(w.admin, {
          riderId: "ghost",
          amountCentavos: 1,
          reference: "x1",
        })
      ).ok,
    ).toBe(false);
    const blocked = await w.remittances.holders(w.owner);
    expect(blocked.ok).toBe(false);
  });
});

describe("ReportService", () => {
  it("works out take rate, contribution per order and COD share by zone and in total", async () => {
    const w = world();
    w.finance.figures.push(
      {
        zoneId: "makati",
        zoneName: "Makati City",
        deliveredOrders: 4,
        codOrders: 3,
        gmvCentavos: 100_000,
        tipsCentavos: 2_000,
        platformRevenueCentavos: 20_000,
        promoCostCentavos: 5_000,
        gatewayFeesCentavos: 1_000,
        refundsCentavos: 2_000,
      },
      {
        zoneId: "pampanga",
        zoneName: "San Fernando",
        deliveredOrders: 0,
        codOrders: 0,
        gmvCentavos: 0,
        tipsCentavos: 0,
        platformRevenueCentavos: 0,
        promoCostCentavos: 0,
        gatewayFeesCentavos: 0,
        refundsCentavos: 0,
      },
    );
    const report = await w.reports.week(w.admin, "2026-11-09");
    expect(report.ok && report.value.zones[0]).toMatchObject({
      takeRateBps: 2_000,
      contributionCentavos: 12_000,
      contributionPerOrderCentavos: 3_000,
      codShareBps: 7_500,
    });
    expect(report.ok && report.value.zones[1]).toMatchObject({
      takeRateBps: 0,
      contributionPerOrderCentavos: 0,
      codShareBps: 0,
    });
    expect(report.ok && report.value.total.deliveredOrders).toBe(4);
    const csv = await w.reports.weekCsv(w.admin, "2026-11-09");
    expect(csv.ok && csv.value.body).toContain(
      '"Makati City",4,1000.00,200.00,"20.00%",50.00,10.00,20.00,120.00,30.00,"75.00%",20.00',
    );
    expect((await w.reports.week(w.admin, "2026-11-10")).ok).toBe(false);
    expect((await w.reports.week(w.coordinator, "2026-11-09")).ok).toBe(false);
  });

  it("exports the week's ledger with the chart of accounts, audited", async () => {
    const w = world();
    week9to15(w);
    const csv = await w.reports.ledgerCsv(w.admin, "2026-11-09");
    expect(csv.ok && csv.value.body).toContain(
      '"2200","Payable to merchants","Liability","merchant_payable","merchant","KG-AAAAAA",0.00,160.00',
    );
    expect(csv.ok && csv.value.body.split("\r\n").length).toBe(1 + 12 + 1);
    expect(w.state.audit.at(-1)).toMatchObject({ action: "ledger.export" });
    expect((await w.reports.ledgerCsv(w.admin, "nope")).ok).toBe(false);
    expect((await w.reports.ledgerCsv(w.coordinator, "2026-11-09")).ok).toBe(false);
  });
});
