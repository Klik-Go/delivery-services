import { randomUUID } from "node:crypto";
import { beforeEach, expect, it } from "vitest";
import { describeDb, failureOf, useRollbackTransaction } from "./support";

const CENTRE = { lat: 14.5547, lng: 121.0244 };

/** Phase 10: payouts are frozen once paid, add up, and hand-ins are append-only. */
describeDb("finance: payouts, hand-ins, settlement runs, ledger accounts", () => {
  const { db, fx } = useRollbackTransaction();
  let zone: string;
  let rider: string;

  beforeEach(async () => {
    zone = await fx().zone({ name: "Finance Zone", centre: CENTRE });
    rider = await fx().rider({ userId: await fx().user("Fina Rider"), zoneId: zone });
  });

  async function payout(): Promise<string> {
    const { rows } = await db().query<{ id: string }>(
      `insert into public.payouts (party_type, party_id, period_start, period_end, amount_centavos,
                                   earnings_centavos, cash_netted_centavos)
       values ('rider', $1, '2026-11-02', '2026-11-08', 3000, 5000, 2000) returning id`,
      [rider],
    );
    return rows[0]?.id ?? "";
  }

  it("keeps a payout's amount equal to its earnings less the cash netted", async () => {
    const error = await failureOf(db(), () =>
      db().query(
        `insert into public.payouts (party_type, party_id, period_start, period_end, amount_centavos, earnings_centavos)
         values ('rider', $1, '2026-11-02', '2026-11-08', 9999, 5000)`,
        [rider],
      ),
    );
    expect(error).toMatch(/payouts_amount_is_net/);
  });

  it("needs a reference to be paid, and never changes once paid", async () => {
    const id = await payout();
    expect(
      await failureOf(db(), () =>
        db().query(`update public.payouts set status = 'paid', paid_at = now() where id = $1`, [
          id,
        ]),
      ),
    ).toMatch(/payouts_paid_reference/);
    await db().query(
      `update public.payouts set status = 'paid', paid_at = now(), reference = 'GC-123' where id = $1`,
      [id],
    );
    for (const change of [
      `update public.payouts set reference = 'GC-999' where id = $1`,
      `update public.payouts set status = 'failed', failure_reason = 'oops' where id = $1`,
      `delete from public.payouts where id = $1`,
    ]) {
      expect(await failureOf(db(), () => db().query(change, [id]))).toMatch(/payout_already_paid/);
    }
  });

  it("needs a reason to mark a payout failed", async () => {
    const id = await payout();
    expect(
      await failureOf(db(), () =>
        db().query(`update public.payouts set status = 'failed' where id = $1`, [id]),
      ),
    ).toMatch(/payouts_failed_reason/);
  });

  it("keeps cash hand-ins append-only", async () => {
    const { rows } = await db().query<{ id: string }>(
      `insert into public.cod_remittances (rider_id, zone_id, amount_centavos, reference, ledger_txn_id)
       values ($1, $2, 5000, 'Hub hand-in', $3) returning id`,
      [rider, zone, randomUUID()],
    );
    expect(
      await failureOf(db(), () =>
        db().query(`update public.cod_remittances set amount_centavos = 1 where id = $1`, [
          rows[0]?.id,
        ]),
      ),
    ).toMatch(/append-only/);
  });

  it("runs settlement for whole Monday-to-Sunday weeks only", async () => {
    expect(
      await failureOf(db(), () =>
        db().query(
          `insert into public.settlement_runs (period_start, period_end) values ('2026-11-03', '2026-11-09')`,
        ),
      ),
    ).toMatch(/settlement_runs_week/);
    await db().query(
      `insert into public.settlement_runs (period_start, period_end) values ('2026-11-02', '2026-11-08')`,
    );
  });

  it("books payouts and hand-ins in balanced ledger transactions", async () => {
    const txn = randomUUID();
    await db().query(
      `insert into public.ledger_entries (txn_id, account, party_type, party_id, debit_centavos, credit_centavos)
       values ($1, 'platform_cash', 'platform', null, 5000, 0), ($1, 'rider_cash_on_hand', 'rider', $2, 0, 5000)`,
      [txn, rider],
    );
    const unbalanced = await failureOf(db(), async () => {
      await db().query(
        `insert into public.ledger_entries (txn_id, account, party_type, party_id, debit_centavos, credit_centavos)
         values ($1, 'payouts_due', 'rider', $2, 100, 0)`,
        [randomUUID(), rider],
      );
      await db().query("set constraints all immediate");
    });
    expect(unbalanced).toMatch(/unbalanced/);
  });
});
