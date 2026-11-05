#!/usr/bin/env node
// Regenerates prisma/schema.prisma from the migrated local database so it always mirrors
// supabase/migrations (the source of truth), then normalises it:
//   * auth.users is reduced to its id + the profiles relation. Supabase owns the auth schema and
//     changes it between versions; mapping all of it would make every Supabase upgrade "drift".
//   * Partial indexes are dropped. Prisma reads a partial unique index (e.g. "one default address
//     per user") as a one-to-one relation, which is wrong; the database still enforces them.
//
// Usage (needs DIRECT_URL, e.g. postgresql://postgres:postgres@127.0.0.1:54322/postgres):
//   node scripts/pull-schema.mjs           rewrite prisma/schema.prisma
//   node scripts/pull-schema.mjs --check   exit 1 if the committed schema is out of date (CI)
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const packageDir = fileURLToPath(new URL("..", import.meta.url));
const schemaPath = join(packageDir, "prisma/schema.prisma");
const check = process.argv.includes("--check");

if (!process.env.DIRECT_URL) {
  console.error("DIRECT_URL is not set (the local Supabase database URL).");
  process.exit(2);
}

const prisma = (...args) =>
  execFileSync("pnpm", ["exec", "prisma", ...args], {
    cwd: packageDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

const HEADER = `// Klik Go Prisma schema. GENERATED: run \`pnpm --filter @klikgo/db db:pull\`; do not edit by hand.
// Source of truth: supabase/migrations (RLS, PostGIS and pg_cron live in SQL). This file mirrors
// the migrated database for typed queries; CI fails if it drifts (\`db:pull --check\`).
// Prisma 7: connection URLs are in prisma.config.ts (CLI, DIRECT_URL) and in the pg driver
// adapter (runtime, pooled DATABASE_URL). Geography columns are Unsupported: query them with SQL.
`;

/** Finds the balanced "(...)" starting at `open`, ignoring parentheses inside string literals. */
function closingParen(text, open) {
  let depth = 0;
  let quote = null;
  for (let i = open; i < text.length; i += 1) {
    const c = text[i];
    if (quote) {
      if (c === "\\") i += 1;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === "(") depth += 1;
    else if (c === ")") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  throw new Error(`Unbalanced parentheses at ${open}`);
}

/** Removes `@unique(… where: …)` field attributes and `@@index/@@unique(… where: …)` lines. */
function dropPartialIndexes(body) {
  const lines = body.split("\n").filter((line) => {
    const t = line.trim();
    return !((t.startsWith("@@index(") || t.startsWith("@@unique(")) && t.includes("where:"));
  });
  return lines
    .map((line) => {
      let out = line;
      let at = out.indexOf("@unique(");
      while (at !== -1) {
        const end = closingParen(out, at + "@unique".length);
        const attribute = out.slice(at, end + 1);
        if (attribute.includes("where:")) {
          out = out.slice(0, at).trimEnd() + out.slice(end + 1);
          at = out.indexOf("@unique(");
        } else {
          at = out.indexOf("@unique(", end);
        }
      }
      return out;
    })
    .join("\n");
}

const raw = prisma("db", "pull", "--print");
const blockRe =
  /((?:^\/\/\/[^\n]*\n)*)^(model|enum|view|type|generator|datasource) (\w+) \{\n([\s\S]*?)^\}$/gm;
const blocks = [...raw.matchAll(blockRe)].map((m) => ({
  docs: m[1],
  kind: m[2],
  name: m[3],
  body: m[4],
}));

const kept = [];
for (const block of blocks) {
  const isAuth = block.body.includes('@@schema("auth")');
  if (isAuth && !(block.kind === "model" && block.name === "users")) continue;
  if (block.kind === "generator") {
    block.body = block.body
      .replace(/^\s*previewFeatures\s*=\s*\["partialIndexes"\]\n/m, "")
      .replace('"partialIndexes", ', "");
  } else if (block.kind === "model" && block.name === "users") {
    block.docs =
      "/// Supabase Auth user (auth.users). Owned by Supabase; only the id and the profile link are mapped.\n";
    block.body = '  id       String    @id @db.Uuid\n  profiles profiles?\n\n  @@schema("auth")\n';
  } else if (block.kind === "model") {
    block.body = dropPartialIndexes(block.body);
  }
  kept.push(block);
}

// With partial uniques gone, foreign keys that were "unique" are plain many-to-one again: turn the
// matching optional back-relations (`Model?`) into lists (`Model[]`).
const models = new Map(kept.filter((b) => b.kind === "model").map((b) => [b.name, b]));
for (const model of models.values()) {
  const uniqueFields = new Set();
  for (const line of model.body.split("\n")) {
    const field = /^\s+(\w+)\s+\S+.*@(id|unique)\b/.exec(line);
    if (field) uniqueFields.add(field[1]);
    const compound = /^\s+@@unique\(\[(\w+)\]/.exec(line);
    if (compound) uniqueFields.add(compound[1]);
  }
  for (const line of model.body.split("\n")) {
    const relation = /^\s+\w+\s+(\w+)\??\s+@relation\(([^)]*)\)/.exec(line);
    if (!relation) continue;
    const [, target, args] = relation;
    const fields = /fields:\s*\[([^\]]*)\]/
      .exec(args)?.[1]
      .split(",")
      .map((s) => s.trim());
    if (!fields || fields.length !== 1 || uniqueFields.has(fields[0])) continue;
    const name = /^"([^"]+)"/.exec(args.trim())?.[1];
    const back = models.get(target);
    if (!back) continue;
    back.body = back.body
      .split("\n")
      .map((l) => {
        const m = new RegExp(`^(\\s+\\w+\\s+)${model.name}\\?(\\s|$)(.*)$`).exec(l);
        if (!m) return l;
        const backName = /@relation\("([^"]+)"/.exec(m[3] ?? "")?.[1];
        return backName === name ? `${m[1]}${model.name}[]${m[2]}${m[3]}` : l;
      })
      .join("\n");
  }
}

const output =
  HEADER + "\n" + kept.map((b) => `${b.docs}${b.kind} ${b.name} {\n${b.body}}`).join("\n\n") + "\n";
const dir = mkdtempSync(join(tmpdir(), "klikgo-prisma-"));
const candidate = join(dir, "schema.prisma");
writeFileSync(candidate, output);
prisma("format", "--schema", candidate);
const formatted = readFileSync(candidate, "utf8");

if (check) {
  if (formatted !== readFileSync(schemaPath, "utf8")) {
    console.error(
      "packages/db/prisma/schema.prisma is out of date. Run `pnpm --filter @klikgo/db db:pull` and commit.",
    );
    process.exit(1);
  }
  console.log("Prisma schema matches the migrated database.");
} else {
  writeFileSync(schemaPath, formatted);
  console.log("Wrote prisma/schema.prisma");
}
