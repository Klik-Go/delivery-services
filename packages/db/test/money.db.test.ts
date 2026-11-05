import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { describeDb, failureOf, useRollbackTransaction } from "./support";

describeDb("money: double-entry ledger and payouts", () => {
  const { db } = useRollbackTransaction();

  async function post(lines: [debit: number, credit: number][]): Promise<string> {
    const txn = randomUUID();
    for (const [debit, credit] of lines) {
      await db().query(
        `insert into public.ledger_entries (txn_id, account, party_type, debit_centavos, credit_centavos)
         values ($1, 'gateway_clearing', 'platform', $2, $3)`,
        [txn, debit, credit],
      );
    }
    return txn;
  }

  it("accepts a balanced transaction", async () => {
    await post([
      [23900, 0],
      [0, 20000],
      [0, 3900],
    ]);
    await db().query("set constraints all immediate");
  });

  it("refuses a transaction whose debits and credits differ", async () => {
    const err = await failureOf(db(), async () => {
      await post([
        [10000, 0],
        [0, 9000],
      ]);
      await db().query("set constraints all immediate");
    });
    expect(err).toMatch(/ledger transaction .* is unbalanced/);
  });

  it("refuses a line that is both a debit and a credit, or neither", async () => {
    for (const line of [
      [100, 100],
      [0, 0],
    ] as [number, number][]) {
      expect(await failureOf(db(), () => post([line]))).toMatch(/ledger_entries_one_side/);
    }
  });

  it("keeps the ledger append-only (corrections are new reversing entries)", async () => {
    const txn = await post([
      [500, 0],
      [0, 500],
    ]);
    expect(
      await failureOf(db(), () =>
        db().query(`update public.ledger_entries set debit_centavos = 1 where txn_id = $1`, [txn]),
      ),
    ).toMatch(/append-only/);
    expect(
      await failureOf(db(), () =>
        db().query(`delete from public.ledger_entries where txn_id = $1`, [txn]),
      ),
    ).toMatch(/append-only/);
  });

  it("rejects a payout period that ends before it starts", async () => {
    const err = await failureOf(db(), () =>
      db().query(
        `insert into public.payouts (party_type, party_id, period_start, period_end, amount_centavos) values ('merchant', gen_random_uuid(), current_date, current_date - 1, 100)`,
      ),
    );
    expect(err).toMatch(/payouts_period_order/);
  });

  it("keeps the audit log append-only", async () => {
    await db().query(
      `insert into public.audit_logs (action, entity_type) values ('test.event', 'test')`,
    );
    expect(
      await failureOf(db(), () =>
        db().query(`delete from public.audit_logs where action = 'test.event'`),
      ),
    ).toMatch(/append-only/);
  });
});
