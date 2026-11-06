import type { SessionUser } from "../auth/session-user";
import { UnauthorizedError, type AppError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";
import type { IPushSubscriptionStore, PushSubscriptionRecord } from "./ports";

/**
 * Lets a signed-in person turn on (or off) notifications on this device. The public key the
 * browser needs is not secret; the private key stays on the server (VAPID).
 */
export class PushSubscriptionService {
  constructor(private readonly deps: { store: IPushSubscriptionStore; publicKey: string | null }) {}

  /** The VAPID public key for the browser, or null while Web Push is not configured. */
  get publicKey(): string | null {
    return this.deps.publicKey;
  }

  async subscribe(
    user: SessionUser | null,
    subscription: PushSubscriptionRecord,
    userAgent: string | null,
  ): Promise<Result<void, AppError>> {
    if (!user) return err(new UnauthorizedError());
    await this.deps.store.save(user.id, subscription, userAgent?.slice(0, 300) ?? null);
    return ok(undefined);
  }

  async unsubscribe(user: SessionUser | null, endpoint: string): Promise<Result<void, AppError>> {
    if (!user) return err(new UnauthorizedError());
    await this.deps.store.remove(endpoint, user.id);
    return ok(undefined);
  }
}
