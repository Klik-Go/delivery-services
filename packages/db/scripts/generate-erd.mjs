#!/usr/bin/env node
// Generates docs/ERD.md (Mermaid diagrams per domain + RLS policy list) from the migrated local
// database, so the diagram can never drift from supabase/migrations.
// Usage (needs DATABASE_URL):  node scripts/generate-erd.mjs [--check]
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";

const erdPath = fileURLToPath(new URL("../../../docs/ERD.md", import.meta.url));
const check = process.argv.includes("--check");

/** Domain groups, in reading order. Every public table must appear exactly once. */
const DOMAINS = [
  ["People, roles and zones", ["profiles", "user_roles", "invites", "zones", "addresses"]],
  [
    "Merchants and menus",
    [
      "merchant_applications",
      "merchants",
      "merchant_closures",
      "menu_categories",
      "menu_items",
      "modifier_groups",
      "modifier_options",
    ],
  ],
  ["Riders", ["riders", "rider_kyc_documents", "rider_locations", "rider_location_breadcrumbs"]],
  [
    "Orders and dispatch",
    ["orders", "order_items", "order_events", "order_status_transitions", "dispatch_offers"],
  ],
  ["Payments and money", ["payments", "refunds", "webhook_events", "ledger_entries", "payouts"]],
  [
    "Engagement and operations",
    [
      "waitlist_signups",
      "ratings",
      "promos",
      "promo_redemptions",
      "referrals",
      "loyalty_stamps",
      "device_push_subscriptions",
      "notifications",
      "audit_logs",
      "feature_flags",
      "fee_rules",
    ],
  ],
];

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const columns = (
  await client.query(`
    select c.table_name, c.column_name, c.is_nullable = 'YES' as nullable,
           case when c.data_type = 'ARRAY' then ltrim(c.udt_name, '_') || '_array'
                when c.data_type = 'USER-DEFINED' then c.udt_name
                else c.udt_name end as type
    from information_schema.columns c
    join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
    order by c.table_name, c.ordinal_position`)
).rows;

const keys = (
  await client.query(`
    select tc.table_name, kcu.column_name, tc.constraint_type
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu
      on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
    where tc.table_schema = 'public' and tc.constraint_type in ('PRIMARY KEY', 'FOREIGN KEY', 'UNIQUE')`)
).rows;

const foreignKeys = (
  await client.query(`
    select con.conname, child.relname as child, parent_ns.nspname as parent_schema, parent.relname as parent,
           array_agg(att.attname::text order by k.ord) as columns,
           bool_and(not att.attnotnull) as nullable
    from pg_constraint con
    join pg_class child on child.oid = con.conrelid
    join pg_namespace ns on ns.oid = child.relnamespace
    join pg_class parent on parent.oid = con.confrelid
    join pg_namespace parent_ns on parent_ns.oid = parent.relnamespace
    cross join lateral unnest(con.conkey) with ordinality k(attnum, ord)
    join pg_attribute att on att.attrelid = con.conrelid and att.attnum = k.attnum
    where con.contype = 'f' and ns.nspname = 'public'
    group by con.conname, child.relname, parent_ns.nspname, parent.relname
    order by child.relname, con.conname`)
).rows;

const singleColumnUnique = new Set(
  (
    await client.query(`
      select c.relname || '.' || a.attname as key
      from pg_index i
      join pg_class c on c.oid = i.indrelid
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
      where n.nspname = 'public' and i.indisunique and i.indnkeyatts = 1 and i.indpred is null`)
  ).rows.map((r) => r.key),
);

const policies = (
  await client.query(`
    select tablename, policyname, cmd, array_to_string(roles, ', ') as roles
    from pg_policies where schemaname = 'public' order by tablename, policyname`)
).rows;
const rls = new Map(
  (
    await client.query(`select tablename, rowsecurity from pg_tables where schemaname = 'public'`)
  ).rows.map((r) => [r.tablename, r.rowsecurity]),
);
await client.end();

const tables = [...new Set(columns.map((c) => c.table_name))].sort();
const grouped = DOMAINS.flatMap(([, list]) => list);
const missing = tables.filter((t) => !grouped.includes(t));
const unknown = grouped.filter((t) => !tables.includes(t));
if (missing.length || unknown.length) {
  console.error(
    `Update DOMAINS in scripts/generate-erd.mjs. Missing: ${missing.join(", ") || "-"}; unknown: ${unknown.join(", ") || "-"}`,
  );
  process.exit(1);
}

const marker = (table, column) => {
  const kinds = keys
    .filter((k) => k.table_name === table && k.column_name === column)
    .map((k) => k.constraint_type);
  const parts = [];
  if (kinds.includes("PRIMARY KEY")) parts.push("PK");
  if (kinds.includes("FOREIGN KEY")) parts.push("FK");
  if (!kinds.includes("PRIMARY KEY") && kinds.includes("UNIQUE")) parts.push("UK");
  return parts.length ? ` ${parts.join(", ")}` : "";
};

function diagram(title, list) {
  const lines = ["erDiagram"];
  for (const fk of foreignKeys) {
    if (!list.includes(fk.child) && !list.includes(fk.parent)) continue;
    const parent = fk.parent_schema === "public" ? fk.parent : `${fk.parent_schema}_${fk.parent}`;
    const oneToOne =
      fk.columns.length === 1 && singleColumnUnique.has(`${fk.child}.${fk.columns[0]}`);
    const parentSide = fk.nullable ? "|o" : "||";
    const childSide = oneToOne ? "o|" : "o{";
    lines.push(`  ${parent} ${parentSide}--${childSide} ${fk.child} : "${fk.columns.join(", ")}"`);
  }
  for (const table of list) {
    lines.push(`  ${table} {`);
    for (const c of columns.filter((col) => col.table_name === table)) {
      lines.push(`    ${c.type} ${c.column_name}${marker(table, c.column_name)}`);
    }
    lines.push("  }");
  }
  return `## ${title}\n\n\`\`\`mermaid\n${lines.join("\n")}\n\`\`\`\n`;
}

const policySection = tables
  .map((table) => {
    const rows = policies.filter((p) => p.tablename === table);
    const list = rows.length
      ? rows.map((p) => `\`${p.policyname}\` (${p.cmd.toLowerCase()} · ${p.roles})`).join("<br>")
      : "none: server only";
    return `| \`${table}\` | ${rls.get(table) ? "on" : "**OFF**"} | ${list} |`;
  })
  .join("\n");

const doc = `# Klik Go — Entity relationship diagram

> Generated from the migrated database by \`pnpm --filter @klikgo/db db:erd\`; do not edit by hand.
> Source of truth: \`supabase/migrations\`. CI fails if this file is out of date.

Conventions: money columns are integer centavos (\`*_centavos\`), times are \`timestamptz\` (UTC),
locations are PostGIS \`geography\` (SRID 4326). \`PK\` primary key, \`FK\` foreign key, \`UK\` unique.
Cardinality: \`||\` exactly one, \`|o\` zero or one, \`o{\` zero or many. \`auth_users\` is Supabase Auth's user table.

${DOMAINS.map(([title, list]) => diagram(title, list)).join("\n")}
## Row-level security policies

Every table has RLS on. Policies decide which rows each role sees; column grants
(\`supabase/migrations/20261105800000_geo_and_grants.sql\`) decide what clients may change.
Role helpers live in the \`private\` schema (\`has_role\`, \`is_admin\`, \`is_merchant_member\`,
\`coordinates_zone\`, \`current_rider_id\`, …).

| Table | RLS | Policies |
|---|---|---|
${policySection}
`;

if (check) {
  if (readFileSync(erdPath, "utf8") !== doc) {
    console.error("docs/ERD.md is out of date. Run `pnpm --filter @klikgo/db db:erd` and commit.");
    process.exit(1);
  }
  console.log("docs/ERD.md matches the migrated database.");
} else {
  writeFileSync(erdPath, doc);
  console.log("Wrote docs/ERD.md");
}
