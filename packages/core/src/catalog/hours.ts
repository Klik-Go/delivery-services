import { WEEKDAYS, type Weekday, type WeeklyHours } from "@klikgo/types";
import { manilaDate } from "../shared/time";

/** Whether a store takes orders now and, if not, when it next opens. */
export interface OpeningStatus {
  readonly open: boolean;
  /** Next opening, e.g. { day: "today", time: "17:00" }; null when the owner closed the store. */
  readonly opensAt: { readonly day: "today" | "tomorrow" | Weekday; readonly time: string } | null;
}

const MANILA_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Manila",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const minutes = (clock: string): number => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3));

function manilaNow(now: Date): { weekday: Weekday; minuteOfDay: number } {
  const parts = Object.fromEntries(MANILA_PARTS.formatToParts(now).map((p) => [p.type, p.value]));
  const weekday = (parts.weekday ?? "Mon").toLowerCase().slice(0, 3) as Weekday;
  return { weekday, minuteOfDay: Number(parts.hour) * 60 + Number(parts.minute) };
}

/**
 * Applies the owner's open toggle, weekly hours (Asia/Manila) and holiday closures. Looks ahead a
 * week for the next opening window.
 */
export function openingStatus(
  store: {
    readonly isOpen: boolean;
    readonly hours: WeeklyHours;
    readonly closedDates: readonly string[];
  },
  now: Date,
): OpeningStatus {
  if (!store.isOpen) return { open: false, opensAt: null };
  const { weekday, minuteOfDay } = manilaNow(now);
  const start = WEEKDAYS.indexOf(weekday);
  for (let offset = 0; offset < 8; offset += 1) {
    const day = WEEKDAYS[(start + offset) % 7] as Weekday;
    const date = manilaDate(new Date(now.getTime() + offset * 86_400_000));
    if (store.closedDates.includes(date)) continue;
    for (const window of store.hours[day]) {
      if (
        offset === 0 &&
        minutes(window.open) <= minuteOfDay &&
        minuteOfDay < minutes(window.close)
      )
        return { open: true, opensAt: null };
      if (offset > 0 || minutes(window.open) > minuteOfDay) {
        const label = offset === 0 ? "today" : offset === 1 ? "tomorrow" : day;
        return { open: false, opensAt: { day: label, time: window.open } };
      }
    }
  }
  return { open: false, opensAt: null };
}
