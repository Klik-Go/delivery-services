import type { Clock } from "../ports/clock";

/** Deterministic clock for tests: time only moves when the test says so. */
export class FakeClock implements Clock {
  private current: Date;

  constructor(start: Date = new Date("2026-01-01T00:00:00.000Z")) {
    this.current = new Date(start);
  }

  /** Returns the frozen current time. */
  now(): Date {
    return new Date(this.current);
  }

  /** Moves time forward by `ms` milliseconds. */
  advanceBy(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }

  /** Jumps to an exact instant. */
  set(instant: Date): void {
    this.current = new Date(instant);
  }
}
