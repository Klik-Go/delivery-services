import pg from "pg";

/**
 * Direct Postgres access for scenarios that assert database state (extensions, RLS, geo).
 * Connects lazily so scenarios without @db never need a database. @db scenarios run inside a
 * transaction that is rolled back afterwards, so they never change the seed data.
 */
export class DbHelper {
  private connection: pg.Client | undefined;
  private inTransaction = false;

  constructor(private readonly connectionString: string | undefined) {}

  /** The connected client (opens the connection on first use). */
  async client(): Promise<pg.Client> {
    if (!this.connectionString) {
      throw new Error(
        "DATABASE_URL is not set. Run `pnpm db:start` and export DATABASE_URL (see README).",
      );
    }
    if (!this.connection) {
      this.connection = new pg.Client({ connectionString: this.connectionString });
      await this.connection.connect();
    }
    return this.connection;
  }

  /** Runs a parameterised query and returns its rows. */
  async query<Row extends Record<string, unknown>>(
    sql: string,
    params: unknown[] = [],
  ): Promise<Row[]> {
    const client = await this.client();
    const result = await client.query<Row>(sql, params);
    return result.rows;
  }

  /** Starts the scenario transaction. */
  async begin(): Promise<void> {
    await (await this.client()).query("begin");
    this.inTransaction = true;
  }

  /**
   * Runs `fn` expecting it may fail, inside a savepoint so the scenario transaction survives.
   * Returns the error message, or null on success.
   */
  async attempt(fn: () => Promise<unknown>): Promise<string | null> {
    const client = await this.client();
    await client.query("savepoint attempt");
    try {
      await fn();
      await client.query("release savepoint attempt");
      return null;
    } catch (error) {
      await client.query("rollback to savepoint attempt");
      return error instanceof Error ? error.message : String(error);
    }
  }

  /** Rolls back the scenario transaction (if any) and closes the connection. */
  async close(): Promise<void> {
    if (this.inTransaction) await this.connection?.query("rollback");
    this.inTransaction = false;
    await this.connection?.end();
    this.connection = undefined;
  }
}
