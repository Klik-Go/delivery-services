import type { WeeklyHours } from "@klikgo/types";
import type { PricedItem, StoreSummary } from "../catalog/ports";
import { InMemoryCatalog, InMemoryServiceArea } from "./catalog-fakes";

/** Ayala Avenue, Makati. */
export const AYALA = { lat: 14.5547, lng: 121.0244 };
export const ALL_DAY: WeeklyHours = Object.fromEntries(
  ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [
    d,
    [{ open: "00:00", close: "23:59" }],
  ]),
) as WeeklyHours;

export const BARAKO: PricedItem = {
  id: "item-barako",
  name: "Kapeng Barako",
  priceCentavos: 6000,
  isAvailable: true,
  groups: [
    {
      id: "g-sugar",
      name: "Sugar",
      required: true,
      minSelect: 1,
      maxSelect: 1,
      options: [
        { id: "o-none", name: "No sugar", priceDeltaCentavos: 0, isAvailable: true },
        { id: "o-less", name: "Less sugar", priceDeltaCentavos: 0, isAvailable: true },
        { id: "o-extra", name: "Extra shot", priceDeltaCentavos: 2500, isAvailable: true },
        { id: "o-gone", name: "Muscovado", priceDeltaCentavos: 500, isAvailable: false },
      ],
    },
  ],
};
export const PANDESAL: PricedItem = {
  id: "item-pandesal",
  name: "Pandesal (10 pcs)",
  priceCentavos: 4000,
  isAvailable: true,
  groups: [],
};
export const ENSAYMADA: PricedItem = {
  ...PANDESAL,
  id: "item-ensaymada",
  name: "Ensaymada",
  isAvailable: false,
};

/** A Makati-like world: one zone with three stores at increasing distances. */
export function catalogWorld(): { area: InMemoryServiceArea; catalog: InMemoryCatalog } {
  const area = new InMemoryServiceArea();
  area.zones.push({
    id: "zone-makati",
    name: "Makati City",
    slug: "makati",
    south: 14.53,
    west: 121.0,
    north: 14.58,
    east: 121.06,
  });
  const catalog = new InMemoryCatalog();
  const store = (overrides: Partial<StoreSummary> & { merchantId: string; items: PricedItem[] }) =>
    catalog.stores.push({
      slug: overrides.merchantId,
      name: overrides.merchantId,
      category: "food",
      description: null,
      coverPhotoPath: null,
      ratingAvg: 4.5,
      ratingCount: 10,
      location: AYALA,
      isOpen: true,
      hours: ALL_DAY,
      closedDates: [],
      prepMinutes: 15,
      radiusKm: 8,
      minItemPriceCentavos: 4000,
      hasFreeDeliveryPromo: false,
      zoneId: "zone-makati",
      ...overrides,
    });
  store({
    merchantId: "kape",
    name: "Kape't Tinapay",
    location: { lat: 14.5583, lng: 121.0187 },
    items: [BARAKO, PANDESAL, ENSAYMADA],
  });
  store({
    merchantId: "nena",
    name: "Aling Nena's Karinderya",
    location: { lat: 14.5653, lng: 121.0298 },
    minItemPriceCentavos: 12000,
    prepMinutes: 40,
    items: [],
  });
  store({
    merchantId: "far",
    name: "Far Lugawan",
    location: { lat: 14.62, lng: 121.1 },
    radiusKm: 3,
    items: [],
  });
  catalog.fees.set("zone-makati", {
    baseFeeCentavos: 3900,
    perKmCentavos: 1000,
    rules: [
      {
        kind: "delivery_distance_band",
        minDistanceM: 0,
        maxDistanceM: 2000,
        minSubtotalCentavos: null,
        feeCentavos: 3900,
        priority: 10,
      },
      {
        kind: "delivery_distance_band",
        minDistanceM: 2000,
        maxDistanceM: 4000,
        minSubtotalCentavos: null,
        feeCentavos: 4900,
        priority: 20,
      },
      {
        kind: "small_order_fee",
        minDistanceM: null,
        maxDistanceM: null,
        minSubtotalCentavos: 15000,
        feeCentavos: 2000,
        priority: 10,
      },
    ],
  });
  return { area, catalog };
}
