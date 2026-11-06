import type { Centavos } from "../shared/money";
import type { LedgerLine, LedgerTxn } from "./ports";

/** A signed amount on one account: positive is a debit, negative a credit. */
interface Posting {
  readonly account: LedgerLine["account"];
  readonly partyType: LedgerLine["partyType"];
  readonly partyId: string | null;
  readonly amount: Centavos;
  readonly memo: string;
}

function toTxn(orderId: string, postings: readonly Posting[]): LedgerTxn {
  const lines = postings
    .filter((p) => p.amount !== 0)
    .map((p): LedgerLine => ({
      account: p.account,
      partyType: p.partyType,
      partyId: p.partyId,
      debitCentavos: p.amount > 0 ? p.amount : 0,
      creditCentavos: p.amount < 0 ? -p.amount : 0,
      memo: p.memo,
    }));
  const net = lines.reduce((sum, l) => sum + l.debitCentavos - l.creditCentavos, 0);
  // The database refuses unbalanced transactions too; failing here names the bug sooner.
  if (net !== 0) throw new Error(`Unbalanced ledger transaction for order ${orderId}: ${net}`);
  return { orderId, lines };
}

/** What delivery settles: who earns what from one order (docs/BUSINESS.md §5.2 steps 6–7). */
export interface SettlementInput {
  readonly orderId: string;
  readonly customerId: string;
  readonly merchantId: string;
  readonly riderId: string;
  /** Online orders settle from the customer's deposit; cash orders from the rider's cash. */
  readonly paidOnline: boolean;
  readonly subtotalCentavos: Centavos;
  readonly deliveryFeeCentavos: Centavos;
  readonly serviceFeeCentavos: Centavos;
  readonly smallOrderFeeCentavos: Centavos;
  readonly tipCentavos: Centavos;
  readonly discountCentavos: Centavos;
  readonly discountFundedBy: "platform" | "merchant";
  readonly commissionCentavos: Centavos;
  readonly riderPayCentavos: Centavos;
}

/**
 * Builds balanced double-entry transactions (debits = credits) for an order's money. Debits are
 * what Klik Go holds or spends (clearing, cash with riders, fees, promos); credits are what it
 * owes (deposits, merchant and rider payables) or earns (platform revenue).
 */
export class LedgerService {
  /**
   * An online payment captured by the gateway: the net reaches gateway clearing, the gateway fee
   * is an expense, and the full amount is held for the customer until delivery or refund.
   */
  capture(input: {
    readonly orderId: string;
    readonly customerId: string;
    readonly amountCentavos: Centavos;
    readonly feeCentavos: Centavos;
  }): LedgerTxn {
    return toTxn(input.orderId, [
      {
        account: "gateway_clearing",
        partyType: "platform",
        partyId: null,
        amount: input.amountCentavos - input.feeCentavos,
        memo: "Online payment received (net of gateway fee)",
      },
      {
        account: "gateway_fees",
        partyType: "platform",
        partyId: null,
        amount: input.feeCentavos,
        memo: "Gateway fee",
      },
      {
        account: "customer_deposits",
        partyType: "customer",
        partyId: input.customerId,
        amount: -input.amountCentavos,
        memo: "Held for the customer until delivery",
      },
    ]);
  }

  /**
   * Money returned to the customer through the gateway. While the order's deposit still holds it,
   * the refund comes out of the deposit; after settlement it is a refund expense.
   */
  refund(input: {
    readonly orderId: string;
    readonly customerId: string;
    readonly amountCentavos: Centavos;
    readonly fromDeposit: boolean;
  }): LedgerTxn {
    return toTxn(input.orderId, [
      input.fromDeposit
        ? {
            account: "customer_deposits",
            partyType: "customer",
            partyId: input.customerId,
            amount: input.amountCentavos,
            memo: "Refund from the customer's deposit",
          }
        : {
            account: "customer_refunds",
            partyType: "platform",
            partyId: null,
            amount: input.amountCentavos,
            memo: "Refund after settlement",
          },
      {
        account: "gateway_clearing",
        partyType: "platform",
        partyId: null,
        amount: -input.amountCentavos,
        memo: "Refund sent through the gateway",
      },
    ]);
  }

  /**
   * Delivery settles the order: the merchant is owed the subtotal less commission (and less a
   * promo it funded), the rider their pay plus the tip, and Klik Go keeps commission and fees.
   * Platform-funded promos are an expense. Used from Phase 7 (delivery confirmation).
   */
  settlement(input: SettlementInput): LedgerTxn {
    const total =
      input.subtotalCentavos +
      input.deliveryFeeCentavos +
      input.serviceFeeCentavos +
      input.smallOrderFeeCentavos +
      input.tipCentavos -
      input.discountCentavos;
    const platformPromo = input.discountFundedBy === "platform" ? input.discountCentavos : 0;
    const merchantPromo = input.discountFundedBy === "merchant" ? input.discountCentavos : 0;
    const platformRevenue =
      input.commissionCentavos +
      input.deliveryFeeCentavos +
      input.serviceFeeCentavos +
      input.smallOrderFeeCentavos -
      input.riderPayCentavos;
    return toTxn(input.orderId, [
      input.paidOnline
        ? {
            account: "customer_deposits",
            partyType: "customer",
            partyId: input.customerId,
            amount: total,
            memo: "Deposit released on delivery",
          }
        : {
            account: "rider_cash_on_hand",
            partyType: "rider",
            partyId: input.riderId,
            amount: total,
            memo: "Cash collected on delivery",
          },
      {
        account: "promo_expense",
        partyType: "platform",
        partyId: null,
        amount: platformPromo,
        memo: "Promo funded by Klik Go",
      },
      {
        account: "merchant_payable",
        partyType: "merchant",
        partyId: input.merchantId,
        amount: -(input.subtotalCentavos - input.commissionCentavos - merchantPromo),
        memo: "Owed to the store (subtotal less commission)",
      },
      {
        account: "rider_payable",
        partyType: "rider",
        partyId: input.riderId,
        amount: -(input.riderPayCentavos + input.tipCentavos),
        memo: "Owed to the rider (pay and tip)",
      },
      {
        account: "platform_revenue",
        partyType: "platform",
        partyId: null,
        amount: -platformRevenue,
        memo: "Commission and fees kept by Klik Go",
      },
    ]);
  }
}
