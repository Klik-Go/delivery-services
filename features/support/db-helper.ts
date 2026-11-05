import pg from "pg";

/**
 * Direct Postgres access for scenarios that assert database state (extensions, RLS, seeds).
 * Connects lazily so scenarios without @db never need a database.
 */
export class DbHelper {
  private client: pg.Client | undefined;

  constructor(private readonly connectionString: string | undefined) {}

  /** Runs a parameterised query and returns its rows. */
  async query<Row extends Record<string, unknown>>(
    sql: string,
    params: unknown[] = [],
  ): Promise<Row[]> {
    const client = await this.connect();
    const result = await client.query<Row>(sql, params);
    return result.rows;
  }

  /** Closes the connection if one was opened. */
  async close(): Promise<void> {
    await this.client?.end();
    this.client = undefined;
  }

  private async connect(): Promise<pg.Client> {
    if (!this.connectionString) {
      throw new Error(
        "DATABASE_URL is not set. Run `pnpm db:start` and export DATABASE_URL (see README).",
      );
    }
    if (!this.client) {
      this.client = new pg.Client({ connectionString: this.connectionString });
      await this.client.connect();
    }
    return this.client;
  }
}
