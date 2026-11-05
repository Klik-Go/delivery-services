/** Supported UI languages: English and Filipino (Taglish-friendly copy lives in messages/). */
export const LOCALES = ["en", "fil"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

/** Cookie that stores the chosen language (next-intl's default name). */
export const LOCALE_COOKIE = "NEXT_LOCALE";

/** Returns a supported locale, falling back to English. */
export function resolveLocale(value: string | undefined): Locale {
  return LOCALES.find((locale) => locale === value) ?? DEFAULT_LOCALE;
}
