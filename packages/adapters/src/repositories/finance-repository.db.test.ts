import { randomUUID } from "node:crypto";
import { SettlementService, weekOf, type Week } from "@klikgo/core";
import { getPrismaClient } from "@klikgo/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaFinanceRepository } from "./prisma-finance-repository";

if (process.env.CI && !process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set in CI for repository tests.");
}
const describeDb = describe.skipIf(!process.env.DATABASE_URL);

const NENA = "5eed0000-0000-4000-8000-000000000101";
const RICO = "5eed0000-0000-4000-8000-000000000201";
const RICO_USER = "5eed0000-0000-4000-8000-0000000000d1";
const ADMIN = "5eed0000-0000-4000-8000-0000000000a1";

describeDb("finance repository (local Supabase, seed data)", () => {
  const prisma = getPrismaClient();
  const repo = new PrismaFinanceRepository(prisma);
  const service = new SettlementService({
    settlements: repo,
    access: undefined as never,
    clock: { now: () => new Date() },
    logger: {
      debug() {},
      info() {},
      warn() {},
      error() {},
      child() {
        return this;
      },
    },
  });
  let week: Week;

  /** One delivered order's money, booked inside the test week. */
  async function delivered(cash: boolean): Promise<void> {
    const txn = randomUUID();
    const at = new Date(week.startsAt.getTime() + 36 * 3_600_000);
    await prisma.$executeRaw`
      insert into public.ledger_entries (txn_id, account, party_type, party_id, debit_centavos, credit_centavos, memo, created_at)
      values (${txn}::uuid, ${cash ? "rider_cash_on_hand" : "customer_deposits"}::public.ledger_account,
              ${cash ? "rider" : "customer"}::public.ledger_party, ${cash ? RICO : RICO_USER}::uuid, 25000, 0, 'test', ${at}),
             (${txn}::uuid, 'merchant_payable', 'merchant', ${NENA}::uuid, 0, 15000, 'test', ${at}),
             (${txn}::uuid, 'rider_payable', 'rider', ${RICO}::uuid, 0, 5000, 'test', ${at}),
             (${txn}::uuid, 'platform_revenue', 'platform', null, 0, 5000, 'test', ${at})`;
  }

  beforeAll(async () => {
    // A week before every ledger row (earlier runs included), so it holds only this test's rows.
    const [first] = await prisma.$queryRaw<{ at: Date | null }[]>`
      select min(created_at) as at from public.ledger_entries`;
    week = weekOf(new Date((first?.at ?? new Date()).getTime() - 14 * 86_400_000));
    await delivered(true);
    await delivered(false);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("reads balances from the ledger and records a week's settlement once", async () => {
    const balances = await repo.balances(week);
    expect(
      balances.map((b) => [b.partyType, b.partyId, b.payableCentavos, b.cashHeldCentavos]),
    ).toEqual([
      ["merchant", NENA, 30_000, 0],
      ["rider", RICO, 10_000, 25_000],
    ]);
    expect(balances[0]?.entries).toHaveLength(2);

    const plan = service.plan(week, balances, ADMIN);
    expect(await repo.hasRun(week.start)).toBe(false);
    expect(await repo.record(plan)).toEqual({ payouts: 2, totalCentavos: 30_000 });
    expect(await repo.hasRun(week.start)).toBe(true);
    expect(await repo.record(plan)).toBeNull();

    const payouts = await repo.payouts({ weekStart: week.start });
    expect(payouts.map((p) => [p.partyType, p.partyName, p.amountCentavos, p.status])).toEqual([
      ["merchant", "Aling Nena's Karinderya", 30_000, "draft"],
      ["rider", "Rico Rider", 0, "paid"],
    ]);
    const nena = payouts[0];
    expect((await repo.lines(nena?.id ?? "")).map((l) => l.amountCentavos)).toEqual([
      15_000, 15_000,
    ]);
    // The settlement moved the payable into payouts_due (today, so later weeks start from it).
    const [moved] = await prisma.$queryRaw<{ debit_centavos: number }[]>`
      select debit_centavos from public.ledger_entries
       where account = 'merchant_payable' and party_id = ${NENA}::uuid and memo = 'Weekly payout approved'
       order by id desc limit 1`;
    expect(moved?.debit_centavos).toBe(30_000);
  });

  it("marks a payout paid once and keeps it frozen", async () => {
    const [nena] = await repo.payouts({ weekStart: week.start, partyType: "merchant" });
    const ledger = {
      lines: [
        {
          account: "payouts_due" as const,
          partyType: "merchant" as const,
          partyId: NENA,
          debitCentavos: 30_000,
          creditCentavos: 0,
          memo: "paid",
        },
        {
          account: "platform_cash" as const,
          partyType: "platform" as const,
          partyId: null,
          debitCentavos: 0,
          creditCentavos: 30_000,
          memo: "paid",
        },
      ],
    };
    expect(
      await repo.markPaid({ id: nena?.id ?? "", reference: "GC-TEST-1", by: ADMIN, ledger }),
    ).toBe(true);
    expect(
      await repo.markPaid({ id: nena?.id ?? "", reference: "GC-TEST-2", by: ADMIN, ledger }),
    ).toBe(false);
    expect(await repo.markFailed({ id: nena?.id ?? "", reason: "late", ledger })).toBe(false);
    expect(await repo.payout(nena?.id ?? "")).toMatchObject({
      status: "paid",
      reference: "GC-TEST-1",
    });
    expect(await repo.payout(randomUUID())).toBeNull();
  });

  it("saves payout accounts and reads open balances, riders and cash holders", async () => {
    await repo.saveAccount(
      "rider",
      RICO,
      { method: "bank", accountName: "Rico Rider", accountNumber: "0012-3456-78", bankName: "BPI" },
      ADMIN,
    );
    expect(await repo.account("rider", RICO)).toEqual({
      method: "bank",
      accountName: "Rico Rider",
      accountNumber: "0012-3456-78",
      bankName: "BPI",
    });
    expect(await repo.account("merchant", randomUUID())).toBeNull();
    expect(await repo.riderOf(RICO_USER)).toMatchObject({ id: RICO });
    expect(await repo.riderOf(randomUUID())).toBeNull();
    const open = await repo.openBalance("rider", RICO);
    expect(typeof open.cashHeldCentavos).toBe("number");

    const before = await repo.holder(RICO);
    expect(before && before.cashHeldCentavos).toBeGreaterThan(0);
    const handIn = {
      lines: [
        {
          account: "platform_cash" as const,
          partyType: "platform" as const,
          partyId: null,
          debitCentavos: 100,
          creditCentavos: 0,
          memo: "in",
        },
        {
          account: "rider_cash_on_hand" as const,
          partyType: "rider" as const,
          partyId: RICO,
          debitCentavos: 0,
          creditCentavos: 100,
          memo: "in",
        },
      ],
    };
    await repo.recordHandIn({
      riderId: RICO,
      zoneId: before?.zoneId ?? "",
      amountCentavos: 100,
      reference: "Test hand-in",
      receivedBy: ADMIN,
      ledger: handIn,
    });
    const after = await repo.holder(RICO);
    expect(after?.cashHeldCentavos).toBe((before?.cashHeldCentavos ?? 0) - 100);
    expect(after?.lastHandInAt).not.toBeNull();
    expect((await repo.holders("all")).some((h) => h.riderId === RICO)).toBe(
      after ? after.cashHeldCentavos > 0 : false,
    );
    expect(await repo.holder(randomUUID())).toBeNull();
  });

  it("reports zone weeks and exports the week's ledger rows", async () => {
    const zones = await repo.zoneWeeks(week);
    expect(zones.length).toBeGreaterThan(0);
    expect(zones.every((z) => z.deliveredOrders === 0)).toBe(true);
    const rows = await repo.ledger(week);
    expect(rows.filter((r) => r.memo === "test")).toHaveLength(8);
    expect(rows.every((r) => r.createdAt >= week.startsAt && r.createdAt < week.endsAt)).toBe(true);
  });
});
