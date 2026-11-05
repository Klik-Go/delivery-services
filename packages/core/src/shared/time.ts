/** Times are stored in UTC and shown to people in Philippine time. */
export const MANILA_TIME_ZONE = "Asia/Manila";

const MANILA_DATE_TIME = new Intl.DateTimeFormat("en-US", {
  timeZone: MANILA_TIME_ZONE,
  dateStyle: "medium",
  timeStyle: "short",
});

/** Formats a UTC instant for display in Asia/Manila, e.g. "Nov 5, 2026, 12:30 AM". */
export function formatManilaDateTime(instant: Date): string {
  // Normalise the narrow no-break space some ICU versions put before AM/PM.
  return MANILA_DATE_TIME.format(instant).replace(/\u202f/g, " ");
}
