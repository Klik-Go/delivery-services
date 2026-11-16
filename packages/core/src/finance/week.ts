const DAY_MS = 24 * 60 * 60 * 1000;
/** Asia/Manila is UTC+8 all year (no daylight saving). */
const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A settlement week: Monday to Sunday in Asia/Manila (docs/BUSINESS.md §5.4). */
export interface Week {
  /** Monday, YYYY-MM-DD. */
  readonly start: string;
  /** Sunday, YYYY-MM-DD. */
  readonly end: string;
  /** Monday 00:00 Manila, as an instant. */
  readonly startsAt: Date;
  /** The next Monday 00:00 Manila (exclusive end). */
  readonly endsAt: Date;
}

const isoDate = (utcMidnightMs: number): string =>
  new Date(utcMidnightMs).toISOString().slice(0, 10);

function weekFromMonday(mondayUtcMs: number): Week {
  return {
    start: isoDate(mondayUtcMs),
    end: isoDate(mondayUtcMs + 6 * DAY_MS),
    startsAt: new Date(mondayUtcMs - MANILA_OFFSET_MS),
    endsAt: new Date(mondayUtcMs + 7 * DAY_MS - MANILA_OFFSET_MS),
  };
}

/** The week an instant falls in (Manila calendar). */
export function weekOf(instant: Date): Week {
  const manila = instant.getTime() + MANILA_OFFSET_MS;
  const midnight = manila - (((manila % DAY_MS) + DAY_MS) % DAY_MS);
  const isoDay = (new Date(midnight).getUTCDay() + 6) % 7; // Monday = 0
  return weekFromMonday(midnight - isoDay * DAY_MS);
}

/** The week before the one an instant falls in: the week a Monday settlement pays out. */
export function previousWeek(instant: Date): Week {
  return weekOf(new Date(weekOf(instant).startsAt.getTime() - DAY_MS));
}

/** The week starting on a Monday given as YYYY-MM-DD; null for other days or bad dates. */
export function weekStarting(monday: string): Week | null {
  const match = ISO_DATE.exec(monday);
  if (!match) return null;
  const ms = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (Number.isNaN(ms) || isoDate(ms) !== monday || new Date(ms).getUTCDay() !== 1) return null;
  return weekFromMonday(ms);
}
