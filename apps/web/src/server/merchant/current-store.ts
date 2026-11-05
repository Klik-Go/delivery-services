import "server-only";
import type { SessionUser } from "@klikgo/core";
import { getContainer } from "../container";

/**
 * The store a merchant page works on: the `?store=` one when the person belongs to it, otherwise
 * their first store. Null when they belong to none (e.g. an admin without a store role).
 */
export function currentStoreId(user: SessionUser, requested?: string | string[]): string | null {
  const stores = getContainer().authz.merchantIdsOf(user);
  const wanted = typeof requested === "string" ? requested : undefined;
  if (wanted && stores.includes(wanted)) return wanted;
  return stores[0] ?? null;
}
