/** OpenStreetMap's own tile server: fine for a pilot, but its usage policy forbids heavy use. */
export const DEFAULT_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

/**
 * The tile template the pin map uses. `NEXT_PUBLIC_MAP_TILE_URL` swaps in a commercial OSM-based
 * provider (MapTiler, Stadia, ...) without a code change; anything that is not https falls back
 * to the default so a typo cannot open the CSP to plain http.
 */
export function mapTileUrl(configured: string | undefined): string {
  if (!configured) return DEFAULT_TILE_URL;
  try {
    return new URL(configured.replaceAll(/\{[a-z]\}/g, "a")).protocol === "https:"
      ? configured
      : DEFAULT_TILE_URL;
  } catch {
    return DEFAULT_TILE_URL;
  }
}

/** The origin the CSP must allow in img-src for {@link mapTileUrl}'s tiles. */
export function mapTileOrigin(configured: string | undefined): string {
  return new URL(mapTileUrl(configured).replaceAll(/\{[a-z]\}/g, "a")).origin;
}
