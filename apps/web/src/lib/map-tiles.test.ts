import { describe, expect, it } from "vitest";
import { DEFAULT_TILE_URL, mapTileOrigin, mapTileUrl } from "./map-tiles";

describe("map tiles", () => {
  it("uses OpenStreetMap when nothing is configured", () => {
    expect(mapTileUrl(undefined)).toBe(DEFAULT_TILE_URL);
    expect(mapTileOrigin("")).toBe("https://tile.openstreetmap.org");
  });

  it("uses a configured https provider and allows its origin", () => {
    const url = "https://api.maptiler.com/maps/streets/{z}/{x}/{y}.png?key=public";
    expect(mapTileUrl(url)).toBe(url);
    expect(mapTileOrigin(url)).toBe("https://api.maptiler.com");
  });

  it("supports subdomain placeholders", () => {
    expect(mapTileOrigin("https://tiles.example.com/{z}/{x}/{y}.png")).toBe(
      "https://tiles.example.com",
    );
  });

  it("refuses plain http and garbage, falling back to the default", () => {
    expect(mapTileUrl("http://tiles.example.com/{z}/{x}/{y}.png")).toBe(DEFAULT_TILE_URL);
    expect(mapTileUrl("not a url")).toBe(DEFAULT_TILE_URL);
  });
});
