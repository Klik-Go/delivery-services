import type { MerchantCategory } from "@klikgo/types";
import type { GeoPoint, IPhotoStorage } from "../merchant/ports";
import type { Centavos } from "../shared/money";
import { etaRange, roadMeters } from "./geo";
import { openingStatus, type OpeningStatus } from "./hours";
import type { StoreSummary } from "./ports";

/** A store as a card in the feed and search results. */
export interface StoreCard {
  readonly merchantId: string;
  readonly slug: string;
  readonly name: string;
  readonly category: MerchantCategory;
  readonly coverUrl: string | null;
  readonly ratingAvg: number;
  readonly ratingCount: number;
  readonly distanceMeters: number;
  readonly eta: { readonly min: number; readonly max: number };
  readonly deliveryFeeCentavos: Centavos;
  readonly opening: OpeningStatus;
  readonly freeDelivery: boolean;
  readonly minItemPriceCentavos: Centavos | null;
}

/** Builds a card for a customer at `point`; null when the store does not deliver that far. */
export function storeCard(
  store: StoreSummary,
  point: GeoPoint,
  deliveryFee: (distanceM: number) => Centavos,
  photos: IPhotoStorage,
  now: Date,
): StoreCard | null {
  const distanceMeters = roadMeters(store.location, point);
  if (distanceMeters > store.radiusKm * 1000) return null;
  return {
    merchantId: store.merchantId,
    slug: store.slug,
    name: store.name,
    category: store.category,
    coverUrl: store.coverPhotoPath ? photos.publicUrl(store.coverPhotoPath) : null,
    ratingAvg: store.ratingAvg,
    ratingCount: store.ratingCount,
    distanceMeters,
    eta: etaRange(store.prepMinutes, distanceMeters),
    deliveryFeeCentavos: deliveryFee(distanceMeters),
    opening: openingStatus(store, now),
    freeDelivery: store.hasFreeDeliveryPromo,
    minItemPriceCentavos: store.minItemPriceCentavos,
  };
}

/** Open stores first, then nearest. */
export function byOpenThenDistance(a: StoreCard, b: StoreCard): number {
  if (a.opening.open !== b.opening.open) return a.opening.open ? -1 : 1;
  return a.distanceMeters - b.distanceMeters;
}
