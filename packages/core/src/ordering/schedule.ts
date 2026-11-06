import { WEEKDAYS, type Weekday, type WeeklyHours } from "@klikgo/types";
import { manilaDate } from "../shared/time";

/** Earliest a scheduled delivery can be booked, and how slots are spaced. */
export const SCHEDULE_LEAD_MINUTES = 45;
export const SCHEDULE_STEP_MINUTES = 30;

const minutes = (clock: string): number => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3));

const MANILA_WEEKDAY = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Manila",
  weekday: "short",
});

/** Midnight in Manila (UTC+8 all year) on the Manila date of `instant`. */
function manilaMidnight(instant: Date): Date {
  return new Date(`${manilaDate(instant)}T00:00:00+08:00`);
}

/**
 * Today's delivery slots (Asia/Manila) for "Schedule": every 30 minutes inside the store's opening
 * windows, starting at least 45 minutes from now. Empty when the store is closed for the day.
 */
export function deliverySlots(
  store: {
    readonly isOpen: boolean;
    readonly hours: WeeklyHours;
    readonly closedDates: readonly string[];
  },
  now: Date,
): Date[] {
  if (!store.isOpen || store.closedDates.includes(manilaDate(now))) return [];
  const weekday = MANILA_WEEKDAY.format(now).toLowerCase().slice(0, 3) as Weekday;
  if (!WEEKDAYS.includes(weekday)) return [];
  const midnight = manilaMidnight(now).getTime();
  const earliest = now.getTime() + SCHEDULE_LEAD_MINUTES * 60_000;
  const slots: Date[] = [];
  for (const window of store.hours[weekday]) {
    for (
      let m = Math.ceil(minutes(window.open) / SCHEDULE_STEP_MINUTES) * SCHEDULE_STEP_MINUTES;
      m < minutes(window.close);
      m += SCHEDULE_STEP_MINUTES
    ) {
      const slot = midnight + m * 60_000;
      if (slot >= earliest) slots.push(new Date(slot));
    }
  }
  return slots;
}
