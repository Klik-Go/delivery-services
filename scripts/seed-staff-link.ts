#!/usr/bin/env -S node --import tsx
/**
 * LOCAL ONLY. Prints a one-time set-password link for a staff account from the local seed
 * (supabase/seed.sql), e.g. nena@seed.klikgo.test. Seeded staff have no password; staff sign in
 * with email + password + an authenticator app (TOTP), so this is how you sign in as one of them on
 * your machine. Refuses anything but the local Supabase stack. Accounts: docs/DEMO.md.
 *
 * Required env: NEXT_PUBLIC_SUPABASE_URL (local), SUPABASE_SERVICE_ROLE_KEY (local), STAFF_EMAIL.
 * Optional: NEXT_PUBLIC_APP_URL (defaults to http://localhost:3000).
 * Usage: STAFF_EMAIL=nena@seed.klikgo.test pnpm seed:staff-link
 */
import { createClient } from "@supabase/supabase-js";

const STAFF_ROLES = new Set(["admin", "coordinator", "merchant_owner", "merchant_staff"]);

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
if (!["127.0.0.1", "localhost"].includes(new URL(supabaseUrl).hostname)) {
  console.error(
    "seed:staff-link only works against the local Supabase stack. Hosted staff join by invite.",
  );
  process.exit(2);
}
const serviceKey = required("SUPABASE_SERVICE_ROLE_KEY", process.env.SUPABASE_SERVICE_ROLE_KEY);
const email = required("STAFF_EMAIL", process.env.STAFF_EMAIL).trim().toLowerCase();
const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

const admin = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function findUserId(): Promise<string | null> {
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const match = data.users.find((user) => user.email?.toLowerCase() === email);
    if (match) return match.id;
    if (data.users.length < 200) return null;
  }
  return null;
}

const userId = await findUserId();
if (!userId) {
  console.error(`No local account for ${email}. Run pnpm db:reset to load the seed.`);
  process.exit(1);
}
// Checked before any link exists: the link must never open a customer's or rider's account.
const roles = await admin.from("user_roles").select("role").eq("user_id", userId);
if (roles.error) throw new Error(roles.error.message);
if (!roles.data.some((row: { role: string }) => STAFF_ROLES.has(row.role))) {
  console.error(`${email} is not a staff account; customers and riders sign in by phone.`);
  process.exit(1);
}
const { data, error } = await admin.auth.admin.generateLink({ type: "recovery", email });
if (error) {
  console.error(`Could not create the link: ${error.message}`);
  process.exit(1);
}
const link = new URL("/auth/confirm", appUrl);
link.search = new URLSearchParams({
  token_hash: data.properties.hashed_token,
  type: "recovery",
  next: "/auth/set-password",
}).toString();
console.log(
  `One-time link for ${email} (set a password, enrol an authenticator app, then sign in at /auth/staff):`,
);
console.log(link.toString());
