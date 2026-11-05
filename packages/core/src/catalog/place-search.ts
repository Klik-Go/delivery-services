import type { IRateLimiter, RateLimitRule } from "../auth/ports";
import type { GeoPoint } from "../merchant/ports";
import { RateLimitedError, type AppError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";
import type { ICache } from "./ports";

/** One autocomplete suggestion. */
export interface PlaceSuggestion {
  readonly id: string;
  readonly primary: string;
  readonly secondary: string | null;
}

/** A chosen place's pin. */
export interface PlaceLocation {
  readonly label: string;
  readonly location: GeoPoint;
}

/** Address autocomplete (Google Places through the BFF in production). */
export interface IPlaceSearch {
  suggest(
    query: string,
    session: string,
    near: GeoPoint | null,
  ): Promise<Result<PlaceSuggestion[], AppError>>;
  place(id: string, session: string): Promise<Result<PlaceLocation, AppError>>;
}

/** Autocomplete costs money per call: 60 keystroke lookups per network per minute. */
export const PLACE_LOOKUPS_PER_IP: RateLimitRule = { limit: 60, windowSeconds: 60 };
const CACHE_SECONDS = 600;

/**
 * Address autocomplete through the BFF with a server-side key, session tokens and a 10-minute cache
 * (docs/BUILD_PLAN.md Phase 4). Only the typed text and a coarse location bias leave the server.
 */
export class PlaceSearchService {
  constructor(
    private readonly deps: { places: IPlaceSearch; cache: ICache; rateLimiter: IRateLimiter },
  ) {}

  async suggest(
    query: string,
    session: string,
    near: GeoPoint | null,
    context: { readonly clientIp: string },
  ): Promise<Result<PlaceSuggestion[], AppError>> {
    const limited = await this.limit(context.clientIp);
    if (limited) return err(limited);
    const key = `places:q:${query.trim().toLowerCase()}`;
    const hit = this.deps.cache.get<PlaceSuggestion[]>(key);
    if (hit) return ok(hit);
    const result = await this.deps.places.suggest(query, session, near);
    if (result.ok) this.deps.cache.set(key, result.value, CACHE_SECONDS);
    return result;
  }

  async place(
    id: string,
    session: string,
    context: { readonly clientIp: string },
  ): Promise<Result<PlaceLocation, AppError>> {
    const limited = await this.limit(context.clientIp);
    if (limited) return err(limited);
    const key = `places:id:${id}`;
    const hit = this.deps.cache.get<PlaceLocation>(key);
    if (hit) return ok(hit);
    const result = await this.deps.places.place(id, session);
    if (result.ok) this.deps.cache.set(key, result.value, CACHE_SECONDS);
    return result;
  }

  private async limit(clientIp: string): Promise<RateLimitedError | null> {
    const decision = await this.deps.rateLimiter.hit(`places:ip:${clientIp}`, PLACE_LOOKUPS_PER_IP);
    return decision.allowed
      ? null
      : new RateLimitedError(
          "Too many searches. Please wait a moment.",
          decision.retryAfterSeconds,
        );
  }
}
