import { MemoryLogger } from "@klikgo/core/testing";
import { describe, expect, it, vi } from "vitest";
import { GooglePlaceSearch, UnconfiguredPlaceSearch } from "./google-place-search";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("GooglePlaceSearch", () => {
  it("asks for Philippine suggestions near the customer with the session token and server key", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(
      json({
        suggestions: [
          {
            placePrediction: {
              placeId: "abc",
              structuredFormat: {
                mainText: { text: "Ayala Avenue" },
                secondaryText: { text: "Makati" },
              },
            },
          },
          { queryPrediction: {} },
        ],
      }),
    );
    const places = new GooglePlaceSearch({ apiKey: "k", logger: new MemoryLogger(), fetch: send });
    const result = await places.suggest("ayala", "session-1", { lat: 14.55, lng: 121.02 });
    expect(result).toEqual({
      ok: true,
      value: [{ id: "abc", primary: "Ayala Avenue", secondary: "Makati" }],
    });
    const [, init] = send.mock.calls[0] ?? [];
    const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as Record<
      string,
      unknown
    >;
    expect(body).toMatchObject({
      input: "ayala",
      sessionToken: "session-1",
      includedRegionCodes: ["ph"],
    });
    expect(new Headers(init?.headers).get("x-goog-api-key")).toBe("k");
  });

  it("resolves a place to its pin and rejects odd ids", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(
      json({
        location: { latitude: 14.55, longitude: 121.02 },
        displayName: { text: "Ayala Triangle" },
      }),
    );
    const places = new GooglePlaceSearch({ apiKey: "k", logger: new MemoryLogger(), fetch: send });
    expect(await places.place("abc", "s")).toEqual({
      ok: true,
      value: { label: "Ayala Triangle", location: { lat: 14.55, lng: 121.02 } },
    });
    expect((await places.place("../etc", "s")).ok).toBe(false);
  });

  it("reports the service as unavailable on errors", async () => {
    const down = new GooglePlaceSearch({
      apiKey: "k",
      logger: new MemoryLogger(),
      fetch: vi.fn<typeof fetch>().mockResolvedValue(json({}, 403)),
    });
    const offline = new GooglePlaceSearch({
      apiKey: "k",
      logger: new MemoryLogger(),
      fetch: vi.fn<typeof fetch>().mockRejectedValue(new Error("x")),
    });
    const garbled = new GooglePlaceSearch({
      apiKey: "k",
      logger: new MemoryLogger(),
      fetch: vi.fn<typeof fetch>().mockResolvedValue(json({ suggestions: "x" })),
    });
    for (const result of [
      await down.suggest("a", "s", null),
      await offline.place("abc", "s"),
      await garbled.suggest("a", "s", null),
    ])
      expect(!result.ok && result.error.code).toBe("UNAVAILABLE");
  });

  it("without a key, suggests nothing and finds nothing", async () => {
    const places = new UnconfiguredPlaceSearch();
    expect(await places.suggest()).toEqual({ ok: true, value: [] });
    expect((await places.place("x")).ok).toBe(false);
  });
});
