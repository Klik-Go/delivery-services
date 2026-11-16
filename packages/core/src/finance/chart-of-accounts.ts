import type { LedgerAccount } from "@klikgo/types";

/** Where each ledger account lands in the bookkeeper's chart of accounts (docs/BUSINESS.md §6.5). */
export interface ChartAccount {
  readonly code: string;
  readonly name: string;
  readonly group: "Asset" | "Liability" | "Income" | "Cost of revenue";
}

/**
 * The simplified chart of accounts from docs/BUSINESS.md §6.5 with the balance-sheet accounts the
 * ledger needs. "Platform revenue" is commission plus delivery and service fees after rider pay
 * (the ledger books them together per order); the export lists both so the CPA can split them.
 */
export const CHART_OF_ACCOUNTS: Readonly<Record<LedgerAccount, ChartAccount>> = {
  platform_cash: { code: "1000", name: "Cash in bank and e-wallets", group: "Asset" },
  gateway_clearing: { code: "1100", name: "Payment gateway clearing (PayMongo)", group: "Asset" },
  rider_cash_on_hand: { code: "1200", name: "Cash on delivery held by riders", group: "Asset" },
  customer_deposits: {
    code: "2100",
    name: "Customer deposits (paid, not yet delivered)",
    group: "Liability",
  },
  merchant_payable: { code: "2200", name: "Payable to merchants", group: "Liability" },
  rider_payable: { code: "2300", name: "Payable to riders", group: "Liability" },
  payouts_due: { code: "2400", name: "Payouts approved, not yet sent", group: "Liability" },
  platform_revenue: {
    code: "4000",
    name: "Commission and delivery fee revenue (net of rider pay)",
    group: "Income",
  },
  gateway_fees: { code: "5100", name: "Payment gateway fees", group: "Cost of revenue" },
  promo_expense: { code: "5200", name: "Promo credits issued", group: "Cost of revenue" },
  customer_refunds: {
    code: "5300",
    name: "Customer refunds after delivery",
    group: "Cost of revenue",
  },
};
