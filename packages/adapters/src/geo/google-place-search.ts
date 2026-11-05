import {
  err,
  NotFoundError,
  ok,
  ServiceUnavailableError,
  type AppError,
  type GeoPoint,
  type IPlaceSearch,
  type Logger,
  type PlaceLocation,
  type PlaceSuggestion,
  type Result,
} from "@klikgo/core";
import { z } from "zod";

const AutocompleteSchema = z.object({
  suggestions: z
    .array(
      z.object({
        placePrediction: z
          .object({
            placeId: z.string(),
            structuredFormat: z
              .object({
                mainText: z.object({ text: z.string() }),
                secondaryText: z.object({ text: z.string() }).optional(),
              })
              .optional(),
            text: z.object({ text: z.string() }).optional(),
          })
          .optional(),
      }),
    )
    .default([]),
});

const PlaceSchema = z.object({
  location: z.object({ latitude: z.number(), longitude: z.number() }),
  displayName: z.object({ text: z.string() }).optional(),
  formattedAddress: z.string().optional(),
});

/**
 * Google Places API (New) autocomplete and place details with a server-side key and session tokens
 * (one billable session per address search). Results are limited to the Philippines.
 */
export class GooglePlaceSearch implements IPlaceSearch {
  constructor(private readonly options: { apiKey: string; logger: Logger; fetch?: typeof fetch }) {}

  async suggest(
    query: string,
    session: string,
    near: GeoPoint | null,
  ): Promise<Result<PlaceSuggestion[], AppError>> {
    const response = await this.call("https://places.googleapis.com/v1/places:autocomplete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        input: query,
        sessionToken: session,
        includedRegionCodes: ["ph"],
        ...(near
          ? {
              locationBias: {
                circle: { center: { latitude: near.lat, longitude: near.lng }, radius: 20_000 },
              },
            }
          : {}),
      }),
    });
    if (!response.ok) return response;
    const parsed = AutocompleteSchema.safeParse(response.value);
    if (!parsed.success) return err(unavailable());
    return ok(
      parsed.data.suggestions.flatMap(({ placePrediction: p }) =>
        p
          ? [
              {
                id: p.placeId,
                primary: p.structuredFormat?.mainText.text ?? p.text?.text ?? "",
                secondary: p.structuredFormat?.secondaryText?.text ?? null,
              },
            ]
          : [],
      ),
    );
  }

  async place(id: string, session: string): Promise<Result<PlaceLocation, AppError>> {
    if (!/^[A-Za-z0-9_-]{1,300}$/.test(id)) return err(new NotFoundError("Place", id));
    const response = await this.call(
      `https://places.googleapis.com/v1/places/${id}?sessionToken=${encodeURIComponent(session)}`,
      { headers: { "x-goog-fieldmask": "location,displayName,formattedAddress" } },
    );
    if (!response.ok) return response;
    const parsed = PlaceSchema.safeParse(response.value);
    if (!parsed.success) return err(new NotFoundError("Place", id));
    return ok({
      label: parsed.data.displayName?.text ?? parsed.data.formattedAddress ?? "",
      location: { lat: parsed.data.location.latitude, lng: parsed.data.location.longitude },
    });
  }

  private async call(url: string, init: RequestInit): Promise<Result<unknown, AppError>> {
    try {
      const response = await (this.options.fetch ?? fetch)(url, {
        ...init,
        headers: {
          ...(init.headers as Record<string, string>),
          "x-goog-api-key": this.options.apiKey,
        },
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) {
        this.options.logger.warn("places.http_error", { status: response.status });
        return err(unavailable());
      }
      return ok(await response.json());
    } catch (error) {
      this.options.logger.warn("places.request_failed", { err: error });
      return err(unavailable());
    }
  }
}

/** Without a key: no suggestions (customers use GPS or drag the pin), never an exception. */
export class UnconfiguredPlaceSearch implements IPlaceSearch {
  suggest(): Promise<Result<PlaceSuggestion[], AppError>> {
    return Promise.resolve(ok([]));
  }

  place(id: string): Promise<Result<PlaceLocation, AppError>> {
    return Promise.resolve(err(new NotFoundError("Place", id)));
  }
}

function unavailable(): ServiceUnavailableError {
  return new ServiceUnavailableError("Address search is not available right now.");
}
