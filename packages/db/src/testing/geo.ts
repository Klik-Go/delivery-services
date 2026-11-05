/** A WGS84 coordinate. */
export interface LatLng {
  readonly lat: number;
  readonly lng: number;
}

const METRES_PER_DEGREE_LAT = 111_320;

/** Moves a point by metres north/east (good enough for the few-km distances inside a zone). */
export function offsetLatLng(point: LatLng, northM: number, eastM = 0): LatLng {
  const lat = point.lat + northM / METRES_PER_DEGREE_LAT;
  const lng = point.lng + eastM / (METRES_PER_DEGREE_LAT * Math.cos((point.lat * Math.PI) / 180));
  return { lat, lng };
}

/** EWKT for a geography point, e.g. `SRID=4326;POINT(120.98 14.59)` (longitude first). */
export function pointEwkt({ lat, lng }: LatLng): string {
  return `SRID=4326;POINT(${lng} ${lat})`;
}

/** EWKT for a square polygon of `halfSizeM` metres around `centre`. */
export function squareEwkt(centre: LatLng, halfSizeM: number): string {
  const sw = offsetLatLng(centre, -halfSizeM, -halfSizeM);
  const ne = offsetLatLng(centre, halfSizeM, halfSizeM);
  const ring = [
    [sw.lng, sw.lat],
    [ne.lng, sw.lat],
    [ne.lng, ne.lat],
    [sw.lng, ne.lat],
    [sw.lng, sw.lat],
  ]
    .map(([lng, lat]) => `${lng} ${lat}`)
    .join(", ");
  return `SRID=4326;POLYGON((${ring}))`;
}
