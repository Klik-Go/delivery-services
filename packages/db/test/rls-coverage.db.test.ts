import { expect, it } from "vitest";
import { describeDb, useRollbackTransaction } from "./support";

/** Tables only the server (service role / postgres) may touch: no client policy at all. */
const SERVER_ONLY_TABLES = ["webhook_events"];

describeDb("row-level security coverage", () => {
  const { db } = useRollbackTransaction();

  it("enables RLS on every table in the public schema", async () => {
    const { rows } = await db().query<{ tablename: string }>(
      `select tablename from pg_tables where schemaname = 'public' and not rowsecurity order by 1`,
    );
    expect(rows.map((r) => r.tablename)).toEqual([]);
  });

  it("gives every client-facing table at least one policy", async () => {
    const { rows } = await db().query<{ tablename: string }>(
      `select t.tablename from pg_tables t
       where t.schemaname = 'public'
         and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = t.tablename)
       order by 1`,
    );
    expect(rows.map((r) => r.tablename)).toEqual(SERVER_ONLY_TABLES);
  });

  it("never grants the anonymous role write access through a policy", async () => {
    const { rows } = await db().query<{ policy: string }>(
      `select tablename || '.' || policyname as policy from pg_policies
       where schemaname = 'public' and 'anon' = any(roles) and cmd <> 'SELECT'`,
    );
    expect(rows).toEqual([]);
  });

  it("keeps the security-definer helpers out of the API-exposed public schema", async () => {
    const { rows } = await db().query<{ name: string }>(
      `select p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.prosecdef order by 1`,
    );
    expect(rows.map((r) => r.name)).toEqual([]);
  });
});
