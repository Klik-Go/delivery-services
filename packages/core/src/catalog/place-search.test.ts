import { describe, expect, it } from "vitest";
import { InMemoryRateLimiter } from "../testing/auth-fakes";
import { FakePlaceSearch, MemoryCache } from "../testing/catalog-fakes";
import { PlaceSearchService } from "./place-search";

const SESSION = "3f2b6f4e-8a1c-4c55-9d3e-2b1f0e9a7c11";

describe("PlaceSearchService", () => {
  function setup() {
    const places = new FakePlaceSearch();
    return {
      places,
      service: new PlaceSearchService({
        places,
        cache: new MemoryCache(),
        rateLimiter: new InMemoryRateLimiter(),
      }),
    };
  }

  it("suggests places and resolves the chosen one to a pin, caching repeated lookups", async () => {
    const { places, service } = setup();
    const first = await service.suggest("ayala", SESSION, null, { clientIp: "1.1.1.1" });
    await service.suggest("Ayala ", SESSION, null, { clientIp: "1.1.1.1" });
    expect(first.ok && first.value).toEqual([
      { id: "place-ayala", primary: "Ayala Avenue", secondary: "Makati City" },
    ]);
    const pin = await service.place("place-ayala", SESSION, { clientIp: "1.1.1.1" });
    await service.place("place-ayala", SESSION, { clientIp: "1.1.1.1" });
    expect(pin.ok && pin.value.location).toEqual({ lat: 14.5547, lng: 121.0244 });
    expect(places.calls).toBe(2);
    const missing = await service.place("nope", SESSION, { clientIp: "1.1.1.1" });
    expect(!missing.ok && missing.error.code).toBe("NOT_FOUND");
  });

  it("limits each network to 60 lookups a minute", async () => {
    const { service } = setup();
    for (let i = 0; i < 60; i += 1)
      await service.suggest(`q${String(i)}`, SESSION, null, { clientIp: "2.2.2.2" });
    const blocked = await service.suggest("more", SESSION, null, { clientIp: "2.2.2.2" });
    const blockedPlace = await service.place("place-ayala", SESSION, { clientIp: "2.2.2.2" });
    expect([blocked, blockedPlace].map((r) => !r.ok && r.error.code)).toEqual([
      "RATE_LIMITED",
      "RATE_LIMITED",
    ]);
  });
});
