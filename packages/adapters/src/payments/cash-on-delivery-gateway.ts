import {
  ConflictError,
  err,
  ok,
  type AppError,
  type CheckoutStart,
  type CheckoutStartRequest,
  type GatewayPaymentStatus,
  type IPaymentGateway,
  type Result,
} from "@klikgo/core";
import type { PaymentMethod } from "@klikgo/types";

/**
 * Cash on delivery: nothing to set up up front. The order goes straight to the store and the
 * rider collects the cash (settled into the ledger on delivery). Refunds are made by hand.
 */
export class CashOnDeliveryGateway implements IPaymentGateway {
  readonly name = "cod";
  readonly methods: readonly PaymentMethod[] = ["cod"];
  readonly paysUpfront = false;

  startCheckout(request: CheckoutStartRequest): Promise<Result<CheckoutStart, AppError>> {
    return Promise.resolve(ok({ intentId: `cod_${request.orderId}`, checkoutUrl: null }));
  }

  status(): Promise<Result<GatewayPaymentStatus, AppError>> {
    return Promise.resolve(ok("pending"));
  }

  refund(): Promise<Result<{ ref: string; status: "pending" | "succeeded" }, AppError>> {
    return Promise.resolve(err(new ConflictError("Cash payments are refunded by hand.")));
  }
}
