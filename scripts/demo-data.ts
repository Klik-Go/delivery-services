#!/usr/bin/env -S node --import tsx
/**
 * Loads (or hides) the demo stores used to show Klik Go end to end. Idempotent: safe to run again.
 *
 *   DEMO_ACTION=load (default)
 *     1. finds or creates the demo store owner (DEMO_OWNER_EMAIL) and grants merchant_owner;
 *     2. creates the demo stores with full menus in the three launch zones (existing demo stores
 *        are reopened and their hours reset; their menus are left as edited);
 *     3. adds delivery fee bands to zones that have none, and the demo promo codes;
 *     4. prints a one-time link for the owner to set a password and enrol TOTP (new or never-used
 *        accounts only; otherwise they sign in at /auth/staff).
 *   DEMO_ACTION=hide
 *     suspends the demo stores and switches the demo promos off (orders and history are kept).
 *
 * Required env (names only; values come from Supabase settings, never committed):
 *   NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY,
 *   DATABASE_URL (or DIRECT_URL), DEMO_OWNER_EMAIL (load only).
 * Optional: DEMO_STORE_PHONE (+63…, the number the 1-minute SLA text goes to),
 *   NEXT_PUBLIC_APP_URL (defaults to http://localhost:3000).
 * Usage: pnpm demo:data
 */
import { createClient, type User } from "@supabase/supabase-js";
import pg from "pg";
import { DEMO_HOURS, DEMO_PROMOS, DEMO_STORES } from "./demo/demo-data";

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
const storeIds = DEMO_STORES.map((s) => s.id);
const promoCodes = DEMO_PROMOS.map((p) => p.code);

const db = new pg.Client({ connectionString: databaseUrl });
await db.connect();

if (action === "hide") {
  try {
    await db.query("begin");
    const stores = await db.query(
      `update public.merchants set status = 'suspended', is_open = false where id = any($1::uuid[])`,
      [storeIds],
    );
    const promos = await db.query(
      `update public.promos set is_active = false where code = any($1::text[])`,
      [promoCodes],
    );
    await db.query(
      `insert into public.audit_logs (action, entity_type, meta) values ('demo.hide', 'merchants', $1)`,
      [JSON.stringify({ stores: stores.rowCount, promos: promos.rowCount })],
    );
    await db.query("commit");
    console.log(
      `Hid ${String(stores.rowCount)} demo stores and ${String(promos.rowCount)} demo promo codes.`,
    );
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
const email = required("DEMO_OWNER_EMAIL", process.env.DEMO_OWNER_EMAIL).trim().toLowerCase();
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error("DEMO_OWNER_EMAIL is not an email address.");
  process.exit(2);
}
const phoneInput = process.env.DEMO_STORE_PHONE?.replace(/[\s-]/g, "") ?? "";
const phone = phoneInput ? /^(?:\+?63|0)([89]\d{9})$/.exec(phoneInput)?.[1] : undefined;
if (phoneInput && !phone) {
  console.error("DEMO_STORE_PHONE must be a Philippine mobile number, e.g. 0917 123 4567.");
  process.exit(2);
}
const storePhone = phone ? `+63${phone}` : null;
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

// The owner: an invite for a new account, a password link for one that never signed in.
const existing = await findUser();
let ownerId = existing?.id ?? null;
let link: URL | null = null;
if (!existing || !existing.last_sign_in_at) {
  const type = existing ? "recovery" : "invite";
  const { data, error } = await admin.auth.admin.generateLink({ type, email });
  if (error) {
    console.error(`Could not create the ${type} link: ${error.message}`);
    process.exit(1);
  }
  ownerId = data.user.id;
  link = new URL("/auth/confirm", appUrl);
  link.search = new URLSearchParams({
    token_hash: data.properties.hashed_token,
    type,
    next: "/auth/set-password",
  }).toString();
}
if (!ownerId) throw new Error("No owner account");

const created: string[] = [];
const reopened: string[] = [];
try {
  await db.query("begin");
  const zones = new Map(
    (await db.query<{ id: string; slug: string }>("select id, slug from public.zones")).rows.map(
      (z) => [z.slug, z.id],
    ),
  );

  for (const store of DEMO_STORES) {
    const zoneId = zones.get(store.zoneSlug);
    if (!zoneId)
      throw new Error(`Zone ${store.zoneSlug} is missing: run the database migrations first.`);
    const inserted = await db.query(
      `insert into public.merchants (id, zone_id, owner_id, name, slug, description, category, address_line, phone,
                                     location, commission_bps, founding_commission_until, accepts_cod, is_open,
                                     default_prep_minutes, hours, status)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9,
               extensions.st_setsrid(extensions.st_makepoint($11, $10), 4326)::extensions.geography,
               2000, now() + interval '90 days', true, true, $12, $13, 'active')
       on conflict (id) do nothing`,
      [
        store.id,
        zoneId,
        ownerId,
        store.name,
        store.slug,
        store.description,
        store.category,
        store.addressLine,
        storePhone,
        store.lat,
        store.lng,
        store.prepMinutes,
        JSON.stringify(DEMO_HOURS),
      ],
    );
    if (inserted.rowCount === 1) {
      created.push(store.name);
      await addMenu(store);
    } else {
      reopened.push(store.name);
      await db.query(
        `update public.merchants
            set status = 'active', is_open = true, hours = $2, owner_id = $3,
                phone = coalesce($4, phone)
          where id = $1`,
        [store.id, JSON.stringify(DEMO_HOURS), ownerId, storePhone],
      );
    }
    await db.query(
      `insert into public.user_roles (user_id, role, merchant_id) values ($1, 'merchant_owner', $2)
       on conflict on constraint user_roles_unique do nothing`,
      [ownerId, store.id],
    );
  }

  // Delivery fees: distance bands and a small-order fee, only where a zone has no rules yet.
  for (const [slug, zoneId] of zones) {
    const provincial = slug === "san-marcelino-zambales";
    await db.query(
      `insert into public.fee_rules (zone_id, name, kind, min_distance_m, max_distance_m, min_subtotal_centavos, fee_centavos, priority)
       select $1, b.name, b.kind::public.fee_rule_kind, b.min_m, b.max_m, b.min_sub, b.fee, b.priority
         from (values
           ('Up to 2 km', 'delivery_distance_band', 0, 2000, null::integer, 3900, 10),
           ('2 to 4 km', 'delivery_distance_band', 2000, 4000, null, 4900, 20),
           ('Over 4 km', 'delivery_distance_band', 4000, null, null, $2::integer, 30),
           ('Small order under ₱150', 'small_order_fee', null, null, 15000, 2000, 10)
         ) as b(name, kind, min_m, max_m, min_sub, fee, priority)
        where not exists (select 1 from public.fee_rules f where f.zone_id = $1)`,
      [zoneId, provincial ? 6900 : 5900],
    );
  }

  for (const promo of DEMO_PROMOS) {
    await db.query(
      `insert into public.promos (code, type, discount_centavos, discount_bps, max_discount_centavos,
                                  min_subtotal_centavos, starts_at, ends_at, is_featured, is_active)
       values ($1, $2, $3, $4, $5, $6, now() - interval '1 day', now() + interval '90 days', true, true)
       on conflict (code) do update set is_active = true, ends_at = greatest(public.promos.ends_at, excluded.ends_at)`,
      [
        promo.code,
        promo.type,
        promo.discountCentavos,
        promo.discountBps,
        promo.maxDiscountCentavos,
        promo.minSubtotalCentavos,
      ],
    );
  }

  await db.query(
    `insert into public.audit_logs (action, entity_type, entity_id, meta) values ('demo.load', 'profiles', $1, $2)`,
    [ownerId, JSON.stringify({ created: created.length, reopened: reopened.length })],
  );
  await db.query("commit");
} catch (error) {
  await db.query("rollback");
  await db.end();
  throw error;
}
await db.end();

console.log(`Demo store owner: ${email}`);
console.log(
  `Created ${String(created.length)} demo stores${created.length ? `: ${created.join(", ")}` : ""}.`,
);
if (reopened.length) console.log(`Reopened ${String(reopened.length)} existing demo stores.`);
console.log(`Promo codes: ${promoCodes.join(", ")}.`);
for (const store of DEMO_STORES) {
  console.log(`  ${store.zoneSlug.padEnd(24)} ${new URL(`/s/${store.slug}`, appUrl).toString()}`);
}
if (link) {
  console.log(
    `One-time link for the owner (open it yourself, set a password, enrol TOTP, then go to /merchant/orders):\n${link.toString()}`,
  );
} else {
  console.log(
    "The owner already has a password: sign in at /auth/staff, then open /merchant/orders.",
  );
}

/** Categories, items and choice groups for a newly created demo store. */
async function addMenu(store: (typeof DEMO_STORES)[number]): Promise<void> {
  const categories = new Map<string, string>();
  for (const [index, item] of store.items.entries()) {
    let categoryId = categories.get(item.category);
    if (!categoryId) {
      const row = await db.query<{ id: string }>(
        `insert into public.menu_categories (merchant_id, name, sort) values ($1, $2, $3) returning id`,
        [store.id, item.category, categories.size],
      );
      categoryId = row.rows[0]?.id ?? "";
      categories.set(item.category, categoryId);
    }
    const itemRow = await db.query<{ id: string }>(
      `insert into public.menu_items (merchant_id, category_id, name, description, price_centavos, sort)
       values ($1, $2, $3, $4, $5, $6) returning id`,
      [store.id, categoryId, item.name, item.description ?? null, item.priceCentavos, index],
    );
    const choices = item.choices;
    if (!choices) continue;
    const group = await db.query<{ id: string }>(
      `insert into public.modifier_groups (menu_item_id, name, min_select, max_select, is_required)
       values ($1, $2, $3, $4, $5) returning id`,
      [itemRow.rows[0]?.id, choices.name, choices.required ? 1 : 0, choices.max, choices.required],
    );
    for (const [sort, [name, delta]] of choices.options.entries()) {
      await db.query(
        `insert into public.modifier_options (modifier_group_id, name, price_delta_centavos, sort) values ($1, $2, $3, $4)`,
        [group.rows[0]?.id, name, delta, sort],
      );
    }
  }
}
