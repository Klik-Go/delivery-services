import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe } from "vitest";
import { DbFixtures } from "../src/testing";

export const DATABASE_URL = process.env.DATABASE_URL;

// In CI these tests must run, never silently skip.
if (process.env.CI && !DATABASE_URL) {
  throw new Error("DATABASE_URL must be set in CI for database integration tests.");
}

/** `describe` that only runs when a local Supabase database is configured. */
export const describeDb = describe.skipIf(!DATABASE_URL);

/** Opens one connection per file and wraps every test in a transaction that is rolled back. */
export function useRollbackTransaction(): { db: () => pg.Client; fx: () => DbFixtures } {
  let client: pg.Client | undefined;
  let fixtures: DbFixtures | undefined;

  beforeAll(async () => {
    client = new pg.Client({ connectionString: DATABASE_URL });
    await client.connect();
    fixtures = new DbFixtures(client);
  });
  beforeEach(async () => {
    await client?.query("begin");
  });
  afterEach(async () => {
    await client?.query("rollback");
  });
  afterAll(async () => {
    await client?.end();
  });

  return {
    db: () => {
      if (!client) throw new Error("Database client not ready");
      return client;
    },
    fx: () => {
      if (!fixtures) throw new Error("Fixtures not ready");
      return fixtures;
    },
  };
}

/**
 * Runs a statement that is expected to fail, inside a savepoint so the surrounding test
 * transaction stays usable. Returns the error message, or null if it unexpectedly succeeded.
 */
export async function failureOf(
  db: pg.ClientBase,
  run: () => Promise<unknown>,
): Promise<string | null> {
  await db.query("savepoint expect_failure");
  try {
    await run();
    await db.query("release savepoint expect_failure");
    return null;
  } catch (error) {
    await db.query("rollback to savepoint expect_failure");
    return error instanceof Error ? error.message : String(error);
  }
}

/** Returns the ids from a query as a sorted array, for set comparisons. */
export async function ids(
  db: pg.ClientBase,
  sql: string,
  params: unknown[] = [],
): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>(sql, params);
  return rows.map((row) => String(row.id)).sort();
}
