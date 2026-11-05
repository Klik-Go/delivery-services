#!/usr/bin/env -S node --import tsx
/**
 * Creates (or recovers) the first Klik Go admin. Idempotent: safe to run again.
 *
 *   1. finds the account for ADMIN_EMAIL, or creates it as an invite;
 *   2. grants the `admin` role (user_roles) if missing;
 *   3. prints a one-time link to /auth/confirm → set password → enrol TOTP → /admin.
 *
 * Required env (names only; values from Supabase settings, never committed):
 *   NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY, ADMIN_EMAIL,
 *   DATABASE_URL (or DIRECT_URL), NEXT_PUBLIC_APP_URL (defaults to http://localhost:3000).
 * Usage: pnpm bootstrap:admin
 *
 * The link is a one-time credential: open it yourself, do not paste it into chats or tickets.
 */
import { createClient, type User } from "@supabase/supabase-js";
import pg from "pg";

function required(name: string, value: string | undefined): string {
  if (!value) {
    console.error(`Missing ${name}. See .env.example.`);
    process.exit(2);
  }
  return value;
}

const supabaseUrl = required(
  "NEXT_PUBLIC_SUPABASE_URL",
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL,
);
const serviceKey = required("SUPABASE_SERVICE_ROLE_KEY", process.env.SUPABASE_SERVICE_ROLE_KEY);
const email = required("ADMIN_EMAIL", process.env.ADMIN_EMAIL).trim().toLowerCase();
const databaseUrl = required("DATABASE_URL", process.env.DIRECT_URL ?? process.env.DATABASE_URL);
const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

const admin = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function findUser(): Promise<User | null> {
  for (let page = 1; page <= 50; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const match = data.users.find((user) => user.email?.toLowerCase() === email);
    if (match) return match;
    if (data.users.length < 200) return null;
  }
  return null;
}

const existing = await findUser();
const type = existing ? "recovery" : "invite";
const { data, error } = await admin.auth.admin.generateLink({ type, email });
if (error) {
  console.error(`Could not create the ${type} link: ${error.message}`);
  process.exit(1);
}

const db = new pg.Client({ connectionString: databaseUrl });
await db.connect();
try {
  const granted = await db.query(
    `insert into public.user_roles (user_id, role) values ($1, 'admin') on conflict on constraint user_roles_unique do nothing`,
    [data.user.id],
  );
  await db.query(
    `insert into public.audit_logs (action, entity_type, entity_id, meta) values ('admin.bootstrap', 'profiles', $1, $2)`,
    [data.user.id, JSON.stringify({ granted: granted.rowCount === 1, linkType: type })],
  );
  const link = new URL("/auth/confirm", appUrl);
  link.search = new URLSearchParams({
    token_hash: data.properties.hashed_token,
    type,
    next: "/auth/set-password",
  }).toString();
  console.log(`Admin ${existing ? "account found" : "account created"}: ${email}`);
  console.log(granted.rowCount === 1 ? "Granted the admin role." : "Already an admin.");
  console.log(
    `One-time link (open it yourself, then set a password and enrol TOTP):\n${link.toString()}`,
  );
} finally {
  await db.end();
}
