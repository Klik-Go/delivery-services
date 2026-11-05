import { describe, expect, it } from "vitest";
import { AppError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";
import { MemoryLogger } from "../testing";
import type { IDatabaseProbe } from "./readiness-service";
import { ReadinessService } from "./readiness-service";

const probe = (answer: Result<string | null, AppError>): IDatabaseProbe => ({
  schemaVersion: () => Promise.resolve(answer),
});

describe("ReadinessService", () => {
  it("is ready when the database answers and has every migration this build expects", async () => {
    const service = new ReadinessService({
      database: probe(ok("20261110100000")),
      expectedSchemaVersion: "20261110100000",
      logger: new MemoryLogger(),
    });
    expect(await service.check()).toEqual({
      status: "ready",
      database: "ok",
      schemaVersion: "20261110100000",
      expectedSchemaVersion: "20261110100000",
    });
  });

  it("is not ready when the database is missing this build's migrations", async () => {
    const service = new ReadinessService({
      database: probe(ok("20261108100000")),
      expectedSchemaVersion: "20261110100000",
      logger: new MemoryLogger(),
    });
    expect(await service.check()).toMatchObject({ status: "not_ready", database: "outdated" });
  });

  it("is not ready when no migration has ever been applied", async () => {
    const service = new ReadinessService({
      database: probe(ok(null)),
      expectedSchemaVersion: "20261110100000",
      logger: new MemoryLogger(),
    });
    expect(await service.check()).toMatchObject({ database: "outdated", schemaVersion: null });
  });

  it("counts a database ahead of this build as ok (migrations deploy before the app)", async () => {
    const service = new ReadinessService({
      database: probe(ok("20261201100000")),
      expectedSchemaVersion: "20261110100000",
      logger: new MemoryLogger(),
    });
    expect(await service.check()).toMatchObject({ status: "ready", database: "ok" });
  });

  it("is not ready and logs why when the database cannot be reached", async () => {
    const logger = new MemoryLogger();
    const service = new ReadinessService({
      database: probe(err(new AppError("INTERNAL", "connect ECONNREFUSED"))),
      expectedSchemaVersion: "20261110100000",
      logger,
    });
    expect(await service.check()).toMatchObject({
      status: "not_ready",
      database: "unreachable",
      schemaVersion: null,
    });
    expect(logger.lines.map((l) => l.message)).toContain("readiness.database_unreachable");
  });
});
