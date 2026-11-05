/**
 * URL slug for a store name: "Aling Nena's Karinderya" → "aling-nenas-karinderya". Accents are
 * dropped ("Niño" → "nino") and apostrophes removed rather than turned into dashes.
 */
export function slugify(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return slug || "store";
}
