/** A corner as [longitude, latitude]. */
export type LngLat = readonly [number, number];

const same = (a: LngLat, b: LngLat): boolean => a[0] === b[0] && a[1] === b[1];

function cross(o: LngLat, a: LngLat, b: LngLat): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

/** True when segments p1p2 and p3p4 cross (touching at a shared corner does not count). */
function crosses(p1: LngLat, p2: LngLat, p3: LngLat, p4: LngLat): boolean {
  const d1 = cross(p3, p4, p1);
  const d2 = cross(p3, p4, p2);
  const d3 = cross(p1, p2, p3);
  const d4 = cross(p1, p2, p4);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/**
 * Cleans a drawn outline (drops a repeated closing corner and consecutive duplicates) and says why
 * it cannot be a zone: fewer than 3 corners, an edge crossing another, or no area. PostGIS checks
 * again when the zone is saved.
 */
export function checkOutline(
  ring: readonly LngLat[],
):
  { readonly ok: true; readonly ring: LngLat[] } | { readonly ok: false; readonly reason: string } {
  const corners: LngLat[] = [];
  for (const point of ring) {
    const last = corners[corners.length - 1];
    if (!last || !same(last, point)) corners.push(point);
  }
  const first = corners[0];
  const last = corners[corners.length - 1];
  if (first && last && corners.length > 1 && same(first, last)) corners.pop();
  if (corners.length < 3) return { ok: false, reason: "Draw at least 3 different corners." };

  const n = corners.length;
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      // Neighbouring edges share a corner; skip them.
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      const a1 = corners[i] as LngLat;
      const a2 = corners[(i + 1) % n] as LngLat;
      const b1 = corners[j] as LngLat;
      const b2 = corners[(j + 1) % n] as LngLat;
      if (crosses(a1, a2, b1, b2)) {
        return {
          ok: false,
          reason: "The outline crosses itself. Move the corners so edges don't cross.",
        };
      }
    }
  }
  let area = 0;
  for (let i = 0; i < corners.length; i += 1) {
    const a = corners[i] as LngLat;
    const b = corners[(i + 1) % corners.length] as LngLat;
    area += a[0] * b[1] - b[0] * a[1];
  }
  if (Math.abs(area) < 1e-10) return { ok: false, reason: "The outline has no area." };

  return { ok: true, ring: corners };
}
