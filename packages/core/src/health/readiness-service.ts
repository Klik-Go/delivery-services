import type { Logger } from "../ports/logger";
import type { AppError } from "../shared/errors";
import type { Result } from "../shared/result";

/** Asks the database which migration it is on. */
export interface IDatabaseProbe {
  /** Newest applied migration version (e.g. "20261110100000"), or null when none is recorded. */
  schemaVersion(): Promise<Result<string | null, AppError>>;
}

/** What /api/health/ready reports: can this deployment serve requests that need the database? */
export interface ReadinessReport {
  readonly status: "ready" | "not_ready";
  /** ok; unreachable (connection or credentials); outdated (this build's migrations not applied). */
  readonly database: "ok" | "unreachable" | "outdated";
  readonly schemaVersion: string | null;
  readonly expectedSchemaVersion: string;
}

export interface ReadinessServiceDeps {
  readonly database: IDatabaseProbe;
  /** The newest migration in this build (packages/db LATEST_MIGRATION). */
  readonly expectedSchemaVersion: string;
  readonly logger: Logger;
}

/**
 * Readiness, separate from liveness (/api/health): a deploy whose database is unreachable or
 * missing migrations answers every database request with a 500, so monitors and the owner need
 * to see that directly instead of from a customer's failed address screen.
 */
export class ReadinessService {
  constructor(private readonly deps: ReadinessServiceDeps) {}

  async check(): Promise<ReadinessReport> {
    const expectedSchemaVersion = this.deps.expectedSchemaVersion;
    const version = await this.deps.database.schemaVersion();
    if (!version.ok) {
      this.deps.logger.error("readiness.database_unreachable", { err: version.error });
      return {
        status: "not_ready",
        database: "unreachable",
        schemaVersion: null,
        expectedSchemaVersion,
      };
    }
    const schemaVersion = version.value;
    // Versions are timestamps (YYYYMMDDHHMMSS), so string order is time order.
    const current = schemaVersion !== null && schemaVersion >= expectedSchemaVersion;
    return {
      status: current ? "ready" : "not_ready",
      database: current ? "ok" : "outdated",
      schemaVersion,
      expectedSchemaVersion,
    };
  }
}
