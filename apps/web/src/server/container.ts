import "server-only";
import { createPinoLogger, SystemClock } from "@klikgo/adapters";
import { HealthService, type Logger } from "@klikgo/core";
import { getServerEnv, type ServerEnv } from "./env";

/**
 * Composition root: the only place that picks concrete adapters for core ports
 * (replaces NestJS DI from docs/BUSINESS.md §10.3 "D"). Route handlers get services from here.
 */
export interface Container {
  readonly logger: Logger;
  readonly healthService: HealthService;
}

/** Wires services to adapters for the given configuration. */
export function createContainer(env: ServerEnv): Container {
  const logger = createPinoLogger({ level: env.LOG_LEVEL, service: "klikgo-web" });
  const clock = new SystemClock();
  return {
    logger,
    healthService: new HealthService({ clock, version: env.APP_VERSION }),
  };
}

let container: Container | undefined;

/** Returns the process-wide container, created on first use. */
export function getContainer(): Container {
  container ??= createContainer(getServerEnv());
  return container;
}
