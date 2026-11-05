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

const MANILA_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Manila",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The calendar date in Asia/Manila at `instant`, as YYYY-MM-DD (e.g. for "closed today"). */
export function manilaDate(instant: Date): string {
  return MANILA_DATE.format(instant);
}
