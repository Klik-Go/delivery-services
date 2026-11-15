#!/usr/bin/env -S node --import tsx
/**
 * Loads (or hides) the demo riders used to show the rider app, dispatch and the rider console.
 * Idempotent: safe to run again. Data and placeholder documents: scripts/demo/demo-riders.ts.
 *
 *   DEMO_ACTION=load (default)
 *     1. finds or creates each demo rider's phone account and grants the rider role;
 *     2. puts every rider back in their demo state: approved and online near the demo stores,
 *        approved but offline, waiting for KYC review, or suspended with a reason;
 *     3. uploads placeholder KYC PDFs for the applicants to the private rider-kyc bucket and puts
 *        their documents back to "waiting for review" (so the review can be shown again);
 *     4. prints the riders' test numbers: on the hosted project add them under Supabase →
 *        Authentication → Phone → Test phone numbers and OTPs (docs/DEMO.md).
 *   DEMO_ACTION=hide
 *     takes every demo rider offline and suspends them (history is kept; `load` brings them back).
 *
 * A rider in the middle of a delivery is left as they are, and the script says so.
 *
 * Required env (names only; values come from Supabase settings, never committed):
 *   NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY (load only),
 *   DATABASE_URL (or DIRECT_URL).
 * Usage: pnpm demo:riders
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import pg from "pg";
import {
  DEMO_HIDDEN_REASON,
  DEMO_KYC_TYPES,
  DEMO_RIDERS,
  placeholderKycPdf,
  type DemoRider,
} from "./demo/demo-riders";

function required(name: string, value: string | undefined): string {
  if (!value) {
    console.error(`Missing ${name}. See .env.example.`);
    process.exit(2);
  }
  return value;
}

const action = (process.env.DEMO_ACTION ?? "load").trim().toLowerCase();
if (action !== "load" && action !== "hide") {
  console.error('DEMO_ACTION must be "load" or "hide".');
  process.exit(2);
}
const databaseUrl = required("DATABASE_URL", process.env.DIRECT_URL ?? process.env.DATABASE_URL);
const riderIds = DEMO_RIDERS.map((r) => r.id);

// Statuses after which an order no longer holds its rider.
const FINISHED = ["delivered", "rejected", "cancelled", "failed_delivery"];

const db = new pg.Client({ connectionString: databaseUrl });
await db.connect();

/** Demo riders with an order in progress: their state is not touched. */
async function busyRiders(): Promise<Set<string>> {
  const rows = await db.query<{ rider_id: string }>(
    `select distinct rider_id from public.orders
      where rider_id = any($1::uuid[]) and status <> all($2::public.order_status[])`,
    [riderIds, FINISHED],
  );
  return new Set(rows.rows.map((r) => r.rider_id));
}

if (action === "hide") {
  try {
    await db.query("begin");
    const busy = await busyRiders();
    const hidden = await db.query(
      `update public.riders set is_online = false, status = 'suspended', status_reason = $2
        where id = any($1::uuid[]) and not (id = any($3::uuid[]))`,
      [riderIds, DEMO_HIDDEN_REASON, [...busy]],
    );
    await db.query(
      `insert into public.audit_logs (action, entity_type, meta) values ('demo.riders.hide', 'riders', $1)`,
      [JSON.stringify({ hidden: hidden.rowCount, busy: busy.size })],
    );
    await db.query("commit");
    console.log(`Hid ${String(hidden.rowCount)} demo riders.`);
    if (busy.size) {
      console.log(
        `${String(busy.size)} demo rider(s) are on a delivery and were left online; run hide again after it ends.`,
      );
    }
  } catch (error) {
    await db.query("rollback");
    throw error;
  } finally {
    await db.end();
  }
  process.exit(0);
}

const supabaseUrl = required(
  "NEXT_PUBLIC_SUPABASE_URL",
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL,
);
const serviceKey = required("SUPABASE_SERVICE_ROLE_KEY", process.env.SUPABASE_SERVICE_ROLE_KEY);
const admin = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/** The account for this phone (Supabase stores it without "+"), created and confirmed if new. */
async function accountFor(client: SupabaseClient, rider: DemoRider): Promise<string> {
  const stored = rider.phone.replace(/^\+/, "");
  const existing = await db.query<{ id: string }>(`select id from auth.users where phone = $1`, [
    stored,
  ]);
  const found = existing.rows[0]?.id;
  if (found) return found;
  const { data, error } = await client.auth.admin.createUser({
    phone: rider.phone,
    phone_confirm: true,
    user_metadata: { full_name: rider.fullName },
  });
  if (error)
    throw new Error(`Could not create the account for ${rider.fullName}: ${error.message}`);
  return data.user.id;
}

const accounts = new Map<string, string>();
for (const rider of DEMO_RIDERS) accounts.set(rider.id, await accountFor(admin, rider));

// Placeholder documents first: storage is outside the database transaction, and re-uploading the
// same file is harmless if the transaction below fails.
const documents: { riderId: string; type: string; path: string; approved: boolean }[] = [];
for (const rider of DEMO_RIDERS.filter((r) => r.state === "applicant")) {
  for (const type of DEMO_KYC_TYPES) {
    const path = `${rider.id}/demo-${type}.pdf`;
    const { error } = await admin.storage
      .from("rider-kyc")
      .upload(path, placeholderKycPdf(rider, type), {
        contentType: "application/pdf",
        upsert: true,
      });
    if (error) throw new Error(`Could not upload ${path}: ${error.message}`);
    documents.push({
      riderId: rider.id,
      type,
      path,
      approved: rider.approvedDocuments?.includes(type) ?? false,
    });
  }
}

const loaded: DemoRider[] = [];
const kept: DemoRider[] = [];
try {
  await db.query("begin");
  const zones = new Map(
    (await db.query<{ id: string; slug: string }>("select id, slug from public.zones")).rows.map(
      (z) => [z.slug, z.id],
    ),
  );
  const busy = await busyRiders();

  for (const rider of DEMO_RIDERS) {
    const zoneId = zones.get(rider.zoneSlug);
    if (!zoneId)
      throw new Error(`Zone ${rider.zoneSlug} is missing: run the database migrations first.`);
    const userId = accounts.get(rider.id) ?? "";
    const other = await db.query<{ id: string }>(
      `select id from public.riders where user_id = $1 and id <> $2`,
      [userId, rider.id],
    );
    if (other.rowCount) {
      throw new Error(
        `${rider.phone} already belongs to another rider (${other.rows[0]?.id ?? ""}); change the demo number.`,
      );
    }
    await db.query(`update public.profiles set full_name = $2 where id = $1`, [
      userId,
      rider.fullName,
    ]);
    await db.query(
      `insert into public.user_roles (user_id, role) values ($1, 'rider')
       on conflict on constraint user_roles_unique do nothing`,
      [userId],
    );
    if (busy.has(rider.id)) {
      kept.push(rider);
      continue;
    }
    const status =
      rider.state === "applicant"
        ? "pending_kyc"
        : rider.state === "suspended"
          ? "suspended"
          : "active";
    await db.query(
      `insert into public.riders (id, user_id, zone_id, vehicle_type, plate_no, status, is_online,
                                  rating_avg, rating_count, payout_account_name, status_reason)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       on conflict (id) do update set
         zone_id = excluded.zone_id, vehicle_type = excluded.vehicle_type, plate_no = excluded.plate_no,
         status = excluded.status, is_online = excluded.is_online, rating_avg = excluded.rating_avg,
         rating_count = excluded.rating_count, payout_account_name = excluded.payout_account_name,
         status_reason = excluded.status_reason`,
      [
        rider.id,
        userId,
        zoneId,
        rider.vehicleType,
        rider.plateNo,
        status,
        rider.state === "online",
        rider.rating?.avg ?? 0,
        rider.rating?.count ?? 0,
        rider.payoutAccountName ?? null,
        rider.statusReason ?? null,
      ],
    );
    if (rider.at) {
      await db.query(
        `insert into public.rider_locations (rider_id, location, updated_at)
         values ($1, extensions.st_setsrid(extensions.st_makepoint($3, $2), 4326)::extensions.geography, now())
         on conflict (rider_id) do update set location = excluded.location, updated_at = now(),
           heading = null, speed_kph = null, accuracy_m = null`,
        [rider.id, rider.at.lat, rider.at.lng],
      );
    }
    loaded.push(rider);
  }

  for (const doc of documents) {
    if (busy.has(doc.riderId)) continue;
    await db.query(
      `insert into public.rider_kyc_documents (rider_id, type, storage_path, status, reviewed_at)
       values ($1, $2, $3, $4, $5)
       on conflict (storage_path) do update set status = excluded.status,
         reviewed_by = null, reviewed_at = excluded.reviewed_at, rejection_reason = null`,
      [
        doc.riderId,
        doc.type,
        doc.path,
        doc.approved ? "approved" : "pending",
        doc.approved ? new Date() : null,
      ],
    );
  }

  await db.query(
    `insert into public.audit_logs (action, entity_type, meta) values ('demo.riders.load', 'riders', $1)`,
    [JSON.stringify({ loaded: loaded.length, kept: kept.length, documents: documents.length })],
  );
  await db.query("commit");
} catch (error) {
  await db.query("rollback");
  await db.end();
  throw error;
}
await db.end();

console.log(`Loaded ${String(loaded.length)} demo riders.`);
for (const rider of DEMO_RIDERS) {
  console.log(
    `  ${rider.phone}  ${rider.fullName.padEnd(18)} ${rider.zoneSlug.padEnd(24)} ${rider.state}`,
  );
}
if (kept.length) {
  console.log(
    `Left as they are (on a delivery): ${kept.map((r) => r.fullName).join(", ")}. Run load again after it ends.`,
  );
}
console.log(
  "Riders sign in with a texted code only. On the hosted project add these numbers under Supabase → " +
    "Authentication → Phone → Test phone numbers and OTPs (number without +, then =your 6-digit code):",
);
console.log(`  ${DEMO_RIDERS.map((r) => `${r.phone.slice(1)}=<code>`).join(",")}`);
