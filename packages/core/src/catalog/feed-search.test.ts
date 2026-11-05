import { describe, expect, it } from "vitest";
import { FakeClock } from "../testing/fake-clock";
import { MemoryCache, InMemorySearchRepository } from "../testing/catalog-fakes";
import { FakePhotoStorage } from "../testing/merchant-fakes";
import { DistanceBandFee, ZoneBaseFee } from "./fee-strategies";
import { FeedService } from "./feed-service";
import { PricingService } from "./pricing-service";
import { SearchService } from "./search-service";
import { AYALA, catalogWorld } from "../testing/catalog-world";

function setup() {
  const { area, catalog } = catalogWorld();
  const clock = new FakeClock(new Date("2026-11-02T03:00:00Z"));
  const pricing = new PricingService({
    catalog,
    serviceArea: area,
    delivery: [new DistanceBandFee(), new ZoneBaseFee()],
    surcharges: [],
    clock,
  });
  let nowMs = 0;
  const cache = new MemoryCache(() => nowMs);
  const feed = new FeedService({
    serviceArea: area,
    catalog,
    pricing,
    photos: new FakePhotoStorage(),
    cache,
    clock,
  });
  const search = new SearchService({
    serviceArea: area,
    search: new InMemorySearchRepository(catalog),
    feed,
  });
  return { feed, search, catalog, advance: (ms: number) => (nowMs += ms) };
}

describe("FeedService", () => {
  it("lists nearby stores with fee and arrival time, and skips stores that do not reach the pin", async () => {
    const { feed } = setup();
    const result = await feed.feed(AYALA, null);
    expect(result.zone?.name).toBe("Makati City");
    expect(result.stores.map((s) => s.name)).toEqual(["Kape't Tinapay", "Aling Nena's Karinderya"]);
    expect(result.stores[0]).toMatchObject({
      deliveryFeeCentavos: 3900,
      eta: { min: 20, max: 30 },
    });
  });

  it("builds rails and leaves out empty ones", async () => {
    const { feed, catalog } = setup();
    catalog.recent.set("customer-1", ["nena", "gone"]);
    const kape = catalog.stores[0];
    if (kape) Object.assign(kape, { hasFreeDeliveryPromo: true });
    const result = await feed.feed(AYALA, "customer-1");
    const rails = Object.fromEntries(
      result.rails.map((r) => [r.key, r.stores.map((s) => s.merchantId)]),
    );
    expect(rails).toEqual({
      orderAgain: ["nena"],
      near: ["kape", "nena"],
      under100: ["kape"],
      fast: ["kape"],
      freeDelivery: ["kape"],
    });
    expect(result.categories).toEqual(["food"]);
  });

  it("shows nothing outside every zone", async () => {
    const { feed } = setup();
    expect(await feed.feed({ lat: 10.3, lng: 123.9 }, null)).toEqual({
      zone: null,
      categories: [],
      promos: [],
      rails: [],
      stores: [],
    });
  });

  it("shares zone data for 60 seconds", async () => {
    const { feed, catalog, advance } = setup();
    await feed.feed(AYALA, null);
    await feed.feed(AYALA, null);
    expect(catalog.calls).toBe(1);
    advance(61_000);
    await feed.feed(AYALA, null);
    expect(catalog.calls).toBe(2);
  });
});

describe("SearchService", () => {
  it("groups matching dishes under their store", async () => {
    const { search } = setup();
    const groups = await search.search(AYALA, { q: "barako", sort: "relevance", openNow: false });
    expect(groups.map((g) => [g.store.name, g.dishes.map((d) => d.name)])).toEqual([
      ["Kape't Tinapay", ["Kapeng Barako"]],
    ]);
  });

  it("filters by category and open now, and sorts by distance", async () => {
    const { search, catalog } = setup();
    const nena = catalog.stores[1];
    if (nena) Object.assign(nena, { isOpen: false });
    const all = await search.search(AYALA, { q: "a", sort: "distance", openNow: false });
    const open = await search.search(AYALA, { q: "a", sort: "distance", openNow: true });
    const grocery = await search.search(AYALA, {
      q: "a",
      sort: "relevance",
      category: "grocery",
      openNow: false,
    });
    expect(all.map((g) => g.store.merchantId)).toEqual(["kape", "nena"]);
    expect(open.map((g) => g.store.merchantId)).toEqual(["kape"]);
    expect(grocery).toEqual([]);
    expect(
      await search.search({ lat: 0, lng: 0 }, { q: "a", sort: "relevance", openNow: false }),
    ).toEqual([]);
  });
});
