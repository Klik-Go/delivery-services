/** Source of the current time. Injected so timers (SLA, offer expiry) are testable. */
export interface Clock {
  /** Returns the current instant. */
  now(): Date;
}
