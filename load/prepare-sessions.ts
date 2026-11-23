/**
 * Prepares the accounts the k6 lunch-peak test uses (run once before `k6 run load/lunch-peak.js`):
 * customers signed in with the placeholder code (consent recorded), and the store owner of
 * Kape't Tinapay signed in with password + TOTP. Writes cookies and ids to load/.sessions.json
 * (git-ignored). Local or staging only: it needs the service-role key and PLACEHOLDER_OTP_CODE.
 *
 * Usage: node --import tsx load/prepare-sessions.ts [customers=20]
 */
import { randomBytes, randomInt } from "node:crypto";
import { writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { LEGAL_VERSIONS } from "@klikgo/types";
import { Secret, TOTP } from "otpauth";
import pg from "pg";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const CODE = process.env.PLACEHOLDER_OTP_CODE;
const STORE_SLUG = "kapet-tinapay";
const customers = Number(process.argv[2] ?? 20);

function need(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} (see docs/runbooks/LOAD_TEST.md).`);
  return value;
}

/** Cookie jar for one account. */
class Jar {
  readonly cookies = new Map<string, string>();
  constructor(readonly ip: string) {}

  async post(path: string, body: unknown): Promise<Response> {
    const response = await fetch(new URL(path, BASE_URL), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": this.ip,
        cookie: this.header(),
      },
      body: JSON.stringify(body),
      redirect: "manual",
    });
    for (const line of response.headers.getSetCookie()) {
      const [pair] = line.split(";");
      const at = pair?.indexOf("=") ?? -1;
      if (pair && at > 0) this.cookies.set(pair.slice(0, at), pair.slice(at + 1));
    }
    if (!response.ok)
      throw new Error(`${path}: ${String(response.status)} ${await response.text()}`);
    return response;
  }

  header(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

const ip = (): string =>
  `10.${String(randomInt(0, 256))}.${String(randomInt(0, 256))}.${String(randomInt(1, 255))}`;

async function customer(): Promise<string> {
  if (!CODE) throw new Error("Set PLACEHOLDER_OTP_CODE (customers sign in with it).");
  const jar = new Jar(ip());
  const phone = `+63918${String(randomInt(0, 10_000_000)).padStart(7, "0")}`;
  await jar.post("/api/auth/otp", { phone });
  await jar.post("/api/auth/otp/verify", { phone, code: CODE });
  await jar.post("/api/me/consents", LEGAL_VERSIONS);
  return jar.header();
}

async function owner(db: pg.Client, merchantId: string): Promise<string> {
  const admin = createClient(need("NEXT_PUBLIC_SUPABASE_URL"), need("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const email = `load-owner-${randomBytes(4).toString("hex")}@example.test`;
  const password = `Pw-${randomBytes(12).toString("base64url")}`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (!data.user) throw new Error(error?.message ?? "Could not create the owner");
  await db.query(
    "insert into public.user_roles (user_id, role, merchant_id) values ($1, 'merchant_owner', $2)",
    [data.user.id, merchantId],
  );
  const jar = new Jar(ip());
  await jar.post("/api/auth/password", { email, password });
  const enrol = (await (await jar.post("/api/auth/mfa/enroll", {})).json()) as {
    data: { factorId: string; secret: string };
  };
  const totp = new TOTP({ secret: Secret.fromBase32(enrol.data.secret), digits: 6, period: 30 });
  await jar.post("/api/auth/mfa/verify", { factorId: enrol.data.factorId, code: totp.generate() });
  await jar.post("/api/me/consents", LEGAL_VERSIONS);
  return jar.header();
}

const db = new pg.Client({ connectionString: need("DATABASE_URL") });
await db.connect();
try {
  const store = (
    await db.query<{ id: string }>("select id from public.merchants where slug = $1", [STORE_SLUG])
  ).rows[0];
  if (!store) throw new Error(`No store ${STORE_SLUG}; load the seed first.`);
  // Plain items (no required choices), so every cart is orderable.
  const items = (
    await db.query<{ id: string }>(
      `select i.id from public.menu_items i where i.merchant_id = $1 and i.is_available
          and not exists (select 1 from public.modifier_groups g
                           where g.menu_item_id = i.id and (g.is_required or g.min_select > 0))`,
      [store.id],
    )
  ).rows.map((r) => r.id);
  // The load test runs at any hour: keep the store open all day while it runs.
  const days = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  await db.query("update public.merchants set is_open = true, hours = $2 where id = $1", [
    store.id,
    JSON.stringify(Object.fromEntries(days.map((d) => [d, [{ open: "00:00", close: "23:59" }]]))),
  ]);
  const sessions = {
    storeSlug: STORE_SLUG,
    merchantId: store.id,
    items,
    owner: await owner(db, store.id),
    customers: [] as string[],
  };
  for (let i = 0; i < customers; i += 1) sessions.customers.push(await customer());
  writeFileSync(new URL("./.sessions.json", import.meta.url), JSON.stringify(sessions));
  console.log(
    `Wrote load/.sessions.json: ${String(customers)} customers, 1 owner, ${String(items.length)} items.`,
  );
} finally {
  await db.end();
}
