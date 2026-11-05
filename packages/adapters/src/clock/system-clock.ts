import type { Clock } from "@klikgo/core";

/** The real wall clock. */
export class SystemClock implements Clock {
  /** Returns the current instant. */
  now(): Date {
    return new Date();
  }
}
