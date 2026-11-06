import type { PaymentMethod } from "@klikgo/types";
import type { IPaymentGateway } from "./ports";

/**
 * The payment gateways the composition root configured, looked up by method or name. Adding a
 * gateway means registering another IPaymentGateway; services never branch on method names.
 */
export class PaymentGatewayRegistry {
  constructor(private readonly gateways: readonly IPaymentGateway[]) {}

  forMethod(method: PaymentMethod): IPaymentGateway | null {
    return this.gateways.find((g) => g.methods.includes(method)) ?? null;
  }

  byName(name: string): IPaymentGateway | null {
    return this.gateways.find((g) => g.name === name) ?? null;
  }

  /** Every method a customer can choose right now, in the gateways' order. */
  availableMethods(): PaymentMethod[] {
    return [...new Set(this.gateways.flatMap((g) => g.methods))];
  }
}
