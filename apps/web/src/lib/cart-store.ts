"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/** One line in the cart: ids for the server, names for display. Prices are never stored here. */
export interface CartLine {
  /** itemId + sorted option ids, so the same dish with the same choices merges. */
  readonly key: string;
  readonly itemId: string;
  readonly name: string;
  readonly optionIds: readonly string[];
  readonly optionNames: readonly string[];
  readonly quantity: number;
}

/** The store the cart belongs to (one store per cart). */
export interface CartStore {
  readonly merchantId: string;
  readonly name: string;
  readonly slug: string;
}

interface CartState {
  store: CartStore | null;
  lines: CartLine[];
  /** Adds a line; returns "replace" without changing anything when the cart has another store. */
  add: (store: CartStore, line: Omit<CartLine, "key">) => "added" | "replace";
  /** Empties the cart and adds the line for the new store. */
  replace: (store: CartStore, line: Omit<CartLine, "key">) => void;
  setQuantity: (key: string, quantity: number) => void;
  clear: () => void;
}

export function lineKey(itemId: string, optionIds: readonly string[]): string {
  return [itemId, ...[...optionIds].sort()].join(":");
}

function merge(lines: CartLine[], line: Omit<CartLine, "key">): CartLine[] {
  const key = lineKey(line.itemId, line.optionIds);
  const existing = lines.find((l) => l.key === key);
  if (existing)
    return lines.map((l) =>
      l.key === key ? { ...l, quantity: Math.min(50, l.quantity + line.quantity) } : l,
    );
  return [...lines, { ...line, key }];
}

/**
 * The cart, kept on this device (localStorage) so it survives reloads and offline moments. It
 * holds one store at a time; the server prices it on every view (/api/cart/quote).
 */
export const useCart = create<CartState>()(
  persist(
    (set, get) => ({
      store: null,
      lines: [],
      add: (store, line) => {
        const current = get();
        if (
          current.store &&
          current.store.merchantId !== store.merchantId &&
          current.lines.length > 0
        )
          return "replace";
        set({ store, lines: merge(current.lines, line) });
        return "added";
      },
      replace: (store, line) => set({ store, lines: merge([], line) }),
      setQuantity: (key, quantity) =>
        set((state) => {
          const lines =
            quantity <= 0
              ? state.lines.filter((l) => l.key !== key)
              : state.lines.map((l) =>
                  l.key === key ? { ...l, quantity: Math.min(50, quantity) } : l,
                );
          return { lines, store: lines.length > 0 ? state.store : null };
        }),
      clear: () => set({ store: null, lines: [] }),
    }),
    { name: "klikgo-cart", version: 1, storage: createJSONStorage(() => localStorage) },
  ),
);

/** Total number of items (for the cart bar). */
export function itemCount(lines: readonly CartLine[]): number {
  return lines.reduce((sum, line) => sum + line.quantity, 0);
}
