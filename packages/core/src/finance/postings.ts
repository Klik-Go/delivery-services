import type { LedgerLine } from "../ordering/ports";
import type { Centavos } from "../shared/money";
import type { FinanceTxn } from "./ports";

/** One ledger line: a positive amount is a debit, a negative one a credit. */
export const line = (
  account: LedgerLine["account"],
  partyType: LedgerLine["partyType"],
  partyId: string | null,
  amount: Centavos,
  memo: string,
): LedgerLine => ({
  account,
  partyType,
  partyId,
  debitCentavos: amount > 0 ? amount : 0,
  creditCentavos: amount < 0 ? -amount : 0,
  memo,
});

/** A balanced transaction; the database checks again (ledger_entries_balanced). */
export function txn(lines: readonly LedgerLine[]): FinanceTxn {
  const kept = lines.filter((l) => l.debitCentavos + l.creditCentavos > 0);
  const net = kept.reduce((sum, l) => sum + l.debitCentavos - l.creditCentavos, 0);
  if (net !== 0) throw new Error(`Unbalanced finance transaction: ${String(net)}`);
  return { lines: kept };
}
