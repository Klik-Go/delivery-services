/** Longest slug we generate (the database allows more; short links are nicer to share). */
const MAX_SLUG_LENGTH = 60;

/**
 * URL slug for a store name: "Aling Nena's Karinderya" → "aling-nenas-karinderya". Accents are
 * dropped ("Niño" → "nino") and apostrophes removed rather than turned into dashes. Built from the
 * words (no backtracking regex), so it stays linear on any input.
 */
export function slugify(name: string): string {
  const words = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((word) => word !== "");
  let slug = words.join("-").slice(0, MAX_SLUG_LENGTH);
  while (slug.endsWith("-")) slug = slug.slice(0, -1);
  return slug || "store";
}
