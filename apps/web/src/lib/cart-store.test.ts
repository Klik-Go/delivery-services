import { beforeEach, describe, expect, it, vi } from "vitest";

const memory = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => memory.set(k, v),
  removeItem: (k: string) => memory.delete(k),
});

const { itemCount, lineKey, useCart } = await import("./cart-store");

const kape = { merchantId: "m-kape", name: "Kape't Tinapay", slug: "kapet-tinapay" };
const nena = { merchantId: "m-nena", name: "Aling Nena's", slug: "aling-nenas-karinderya" };
const barako = {
  itemId: "i-barako",
  name: "Kapeng Barako",
  optionIds: ["o-less"],
  optionNames: ["Less sugar"],
  quantity: 1,
};

describe("cart store", () => {
  beforeEach(() => useCart.getState().clear());

  it("merges the same dish with the same choices and counts items", () => {
    useCart.getState().add(kape, barako);
    useCart.getState().add(kape, { ...barako, quantity: 2 });
    useCart.getState().add(kape, { ...barako, optionIds: ["o-none"], optionNames: ["No sugar"] });
    const { lines } = useCart.getState();
    expect(lines.map((l) => [l.key, l.quantity])).toEqual([
      ["i-barako:o-less", 3],
      ["i-barako:o-none", 1],
    ]);
    expect(itemCount(lines)).toBe(4);
    expect(lineKey("i", ["b", "a"])).toBe("i:a:b");
  });

  it("asks before mixing stores, and replaces the cart when told to", () => {
    useCart.getState().add(kape, barako);
    expect(useCart.getState().add(nena, { ...barako, itemId: "i-adobo" })).toBe("replace");
    expect(useCart.getState().store?.merchantId).toBe("m-kape");
    useCart.getState().replace(nena, { ...barako, itemId: "i-adobo" });
    expect(useCart.getState().store?.merchantId).toBe("m-nena");
    expect(useCart.getState().lines).toHaveLength(1);
  });

  it("removes a line at zero and forgets the store when the cart empties", () => {
    useCart.getState().add(kape, barako);
    const key = useCart.getState().lines[0]?.key ?? "";
    useCart.getState().setQuantity(key, 5);
    expect(useCart.getState().lines[0]?.quantity).toBe(5);
    useCart.getState().setQuantity(key, 0);
    expect(useCart.getState()).toMatchObject({ lines: [], store: null });
  });
});
