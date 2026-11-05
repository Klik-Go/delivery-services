import { describe, expect, it } from "vitest";
import { TtlMemoryCache } from "./ttl-memory-cache";

describe("TtlMemoryCache", () => {
  it("returns values until they expire", () => {
    let now = 0;
    const cache = new TtlMemoryCache(10, () => now);
    cache.set("feed:zone", [1, 2], 60);
    expect(cache.get("feed:zone")).toEqual([1, 2]);
    now = 60_000;
    expect(cache.get("feed:zone")).toBeUndefined();
    expect(cache.get("missing")).toBeUndefined();
  });

  it("evicts the oldest entries beyond its size", () => {
    const cache = new TtlMemoryCache(2);
    cache.set("a", 1, 60);
    cache.set("b", 2, 60);
    cache.set("c", 3, 60);
    expect([cache.get("a"), cache.get("b"), cache.get("c")]).toEqual([undefined, 2, 3]);
  });
});
