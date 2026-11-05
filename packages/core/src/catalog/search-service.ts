import type { SearchQuery } from "@klikgo/types";
import type { GeoPoint } from "../merchant/ports";
import type { Centavos } from "../shared/money";
import type { FeedService } from "./feed-service";
import type { IServiceArea, ISearchRepository } from "./ports";
import { byOpenThenDistance, type StoreCard } from "./store-card";

/** A store in search results with the dishes that matched there. */
export interface SearchGroup {
  readonly store: StoreCard;
  readonly dishes: readonly {
    readonly itemId: string;
    readonly name: string;
    readonly priceCentavos: Centavos;
    readonly isAvailable: boolean;
  }[];
}

/**
 * Search within the customer's zone: stores and dishes (Postgres full-text + trigram), grouped by
 * store, with filters (category, open now) and sorting (relevance or distance).
 */
export class SearchService {
  constructor(
    private readonly deps: {
      serviceArea: IServiceArea;
      search: ISearchRepository;
      feed: FeedService;
    },
  ) {}

  async search(point: GeoPoint, query: SearchQuery): Promise<SearchGroup[]> {
    const zone = await this.deps.serviceArea.zoneFor(point);
    if (!zone) return [];
    const [matches, stores, fees] = await Promise.all([
      this.deps.search.search(zone.id, query.q),
      this.deps.feed.storesInZone(zone.id),
      this.deps.feed.zoneFees(zone.id),
    ]);
    const cards = new Map(
      this.deps.feed.cards(stores, fees, point).map((card) => [card.merchantId, card]),
    );
    const groups = new Map<
      string,
      { store: StoreCard; score: number; dishes: SearchGroup["dishes"][number][] }
    >();
    const group = (merchantId: string, score: number) => {
      const card = cards.get(merchantId);
      if (!card) return undefined;
      const existing = groups.get(merchantId);
      if (existing) {
        existing.score = Math.max(existing.score, score);
        return existing;
      }
      const created = { store: card, score, dishes: [] };
      groups.set(merchantId, created);
      return created;
    };
    for (const hit of matches.stores) group(hit.merchantId, hit.score);
    for (const dish of matches.dishes) {
      group(dish.merchantId, dish.score)?.dishes.push({
        itemId: dish.itemId,
        name: dish.name,
        priceCentavos: dish.priceCentavos,
        isAvailable: dish.isAvailable,
      });
    }

    return [...groups.values()]
      .filter((g) => !query.category || g.store.category === query.category)
      .filter((g) => !query.openNow || g.store.opening.open)
      .sort((a, b) =>
        query.sort === "distance" ? byOpenThenDistance(a.store, b.store) : b.score - a.score,
      )
      .map(({ store, dishes }) => ({ store, dishes }));
  }
}
