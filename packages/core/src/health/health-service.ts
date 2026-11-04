import type { Clock } from "../ports/clock";
import { ok, type Result } from "../shared/result";

/** What the platform reports about itself to monitoring. */
export interface HealthReport {
  readonly status: "ok";
  readonly version: string;
  readonly checkedAt: string;
}

/** Dependencies are passed in by the composition root (apps/web/src/server/container.ts). */
export interface HealthServiceDeps {
  readonly clock: Clock;
  readonly version: string;
}

/** Answers "is the platform up?" for uptime monitors and deploy checks. */
export class HealthService {
  constructor(private readonly deps: HealthServiceDeps) {}

  /** Reports liveness. Readiness checks (database, gateways) are added as their adapters land. */
  check(): Result<HealthReport, never> {
    return ok({
      status: "ok",
      version: this.deps.version,
      checkedAt: this.deps.clock.now().toISOString(),
    });
  }
}
