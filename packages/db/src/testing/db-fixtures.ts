import { randomUUID } from "node:crypto";
import type { AppRole, OrderStatus, RiderStatus } from "@klikgo/types";
import type pg from "pg";
import { type LatLng, pointEwkt, squareEwkt } from "./geo";

/**
 * Test-data builders for integration tests and Cucumber. Every builder writes as the
 * connection's own role (postgres in tests, which bypasses RLS), so call them *before*
 * switching to a user with {@link asUser}. Use inside a transaction that is rolled back.
 */
export class DbFixtures {
  constructor(private readonly db: pg.ClientBase) {}

  /** Creates an auth user; the on-signup trigger adds the profile and the customer role. */
  async user(name: string, roles: readonly RoleGrant[] = []): Promise<string> {
    const id = randomUUID();
    const tag = id.slice(0, 8);
    const phone = `63917${String(parseInt(tag, 16) % 10_000_000).padStart(7, "0")}`;
    await this.db.query(
      `insert into auth.users (id, instance_id, aud, role, email, phone, raw_user_meta_data, created_at, updated_at)
       values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, $3, $4, now(), now())`,
      [id, `${tag}@example.test`, phone, JSON.stringify({ full_name: name })],
    );
    for (const grant of roles) await this.grantRole(id, grant);
    return id;
  }

  /** Grants an extra role, scoped to a merchant or zone where the role needs one. */
  async grantRole(userId: string, grant: RoleGrant): Promise<void> {
    await this.db.query(
      `insert into public.user_roles (user_id, role, merchant_id, zone_id) values ($1, $2, $3, $4)`,
      [userId, grant.role, grant.merchantId ?? null, grant.zoneId ?? null],
    );
  }

  /** Creates a square zone of `halfSizeM` metres around `centre`. */
  async zone(options: {
    name: string;
    centre: LatLng;
    halfSizeM?: number;
    isActive?: boolean;
  }): Promise<string> {
    const slug = `${options.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${randomUUID().slice(0, 6)}`;
    const { rows } = await this.db.query<{ id: string }>(
      `insert into public.zones (name, slug, zone_type, area, base_fee_centavos, per_km_centavos, max_radius_km, is_active)
       values ($1, $2, 'barangay', $3::extensions.geography, 3900, 1000, 5, $4) returning id`,
      [
        options.name,
        slug,
        squareEwkt(options.centre, options.halfSizeM ?? 1500),
        options.isActive ?? true,
      ],
    );
    return firstId(rows);
  }

  /** Creates an active merchant at `location` owned by `ownerId` (who gets merchant_owner). */
  async merchant(options: {
    zoneId: string;
    ownerId: string;
    name: string;
    location: LatLng;
  }): Promise<string> {
    const slug = `${options.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${randomUUID().slice(0, 6)}`;
    const { rows } = await this.db.query<{ id: string }>(
      `insert into public.merchants (zone_id, owner_id, name, slug, category, location, status, is_open)
       values ($1, $2, $3, $4, 'food', $5::extensions.geography, 'active', true) returning id`,
      [options.zoneId, options.ownerId, options.name, slug, pointEwkt(options.location)],
    );
    const id = firstId(rows);
    await this.grantRole(options.ownerId, { role: "merchant_owner", merchantId: id });
    return id;
  }

  /** Adds a menu item (and its category) to a merchant. */
  async menuItem(options: {
    merchantId: string;
    name: string;
    priceCentavos: number;
  }): Promise<string> {
    const category = await this.db.query<{ id: string }>(
      `insert into public.menu_categories (merchant_id, name) values ($1, 'Meals') returning id`,
      [options.merchantId],
    );
    const { rows } = await this.db.query<{ id: string }>(
      `insert into public.menu_items (merchant_id, category_id, name, price_centavos) values ($1, $2, $3, $4) returning id`,
      [options.merchantId, firstId(category.rows), options.name, options.priceCentavos],
    );
    return firstId(rows);
  }

  /** Creates a rider (with the rider role) and, optionally, a last known location. */
  async rider(options: {
    userId: string;
    zoneId: string;
    status?: RiderStatus;
    isOnline?: boolean;
    location?: LatLng;
    lastSeenSecondsAgo?: number;
  }): Promise<string> {
    await this.grantRole(options.userId, { role: "rider" });
    const { rows } = await this.db.query<{ id: string }>(
      `insert into public.riders (user_id, zone_id, vehicle_type, plate_no, status, is_online)
       values ($1, $2, 'motorcycle', $3, $4, $5) returning id`,
      [
        options.userId,
        options.zoneId,
        `TST ${randomUUID().slice(0, 4).toUpperCase()}`,
        options.status ?? "active",
        options.isOnline ?? false,
      ],
    );
    const id = firstId(rows);
    if (options.location) {
      await this.db.query(
        `insert into public.rider_locations (rider_id, location, updated_at)
         values ($1, $2::extensions.geography, now() - make_interval(secs => $3))`,
        [id, pointEwkt(options.location), options.lastSeenSecondsAgo ?? 0],
      );
    }
    return id;
  }

  /** Creates a saved address for a customer. */
  async address(options: { userId: string; location: LatLng; label?: string }): Promise<string> {
    const { rows } = await this.db.query<{ id: string }>(
      `insert into public.addresses (user_id, label, location, landmark, barangay, city, contact_phone)
       values ($1, $2, $3::extensions.geography, 'Near the chapel', 'Poblacion', 'Placeholder City', '+639170000000')
       returning id`,
      [options.userId, options.label ?? "Home", pointEwkt(options.location)],
    );
    return firstId(rows);
  }

  /**
   * Creates a COD order (status `placed`) for ₱200 + ₱39 delivery = ₱239, then walks it through
   * `advanceTo` using legal transitions so the order history is realistic.
   */
  async order(options: {
    customerId: string;
    merchantId: string;
    zoneId: string;
    dropoff: LatLng;
    advanceTo?: readonly OrderStatus[];
  }): Promise<string> {
    const { rows } = await this.db.query<{ id: string }>(
      `insert into public.orders (code, customer_id, merchant_id, zone_id, status, payment_method,
         subtotal_centavos, delivery_fee_centavos, total_centavos, address_snapshot, dropoff)
       values ($1, $2, $3, $4, 'placed', 'cod', 20000, 3900, 23900, $5, $6::extensions.geography)
       returning id`,
      [
        `KG-${randomUUID().slice(0, 6).toUpperCase()}`,
        options.customerId,
        options.merchantId,
        options.zoneId,
        JSON.stringify({
          label: "Home",
          landmark: "Near the chapel",
          contact_phone: "+639170000000",
        }),
        pointEwkt(options.dropoff),
      ],
    );
    const id = firstId(rows);
    for (const status of options.advanceTo ?? []) await this.setStatus(id, status);
    return id;
  }

  /** Changes an order's status as `actorRole` (the database validates the transition). */
  async setStatus(
    orderId: string,
    status: OrderStatus,
    actor?: { id: string; role: AppRole },
  ): Promise<void> {
    await this.db.query(
      `select set_config('klikgo.actor_id', $1, true), set_config('klikgo.actor_role', $2, true)`,
      [actor?.id ?? "", actor?.role ?? ""],
    );
    const cancel =
      status === "cancelled"
        ? ", cancel_reason = 'Test cancellation', cancelled_by_role = 'admin'"
        : status === "rejected"
          ? ", reject_reason = 'Test rejection'"
          : "";
    await this.db.query(`update public.orders set status = $2${cancel} where id = $1`, [
      orderId,
      status,
    ]);
  }

  /** Assigns a rider to an order (as dispatch would after the rider accepts). */
  async assignRider(orderId: string, riderId: string): Promise<void> {
    await this.db.query(
      `insert into public.dispatch_offers (order_id, rider_id, status, rider_earnings_centavos, expires_at)
       values ($1, $2, 'accepted', 6000, now() + interval '30 seconds')`,
      [orderId, riderId],
    );
    await this.db.query(
      `update public.orders set rider_id = $2, dispatch_status = 'assigned' where id = $1`,
      [orderId, riderId],
    );
  }

  /** Offers an order to a rider without assigning it. */
  async offer(orderId: string, riderId: string): Promise<void> {
    await this.db.query(
      `insert into public.dispatch_offers (order_id, rider_id, status, rider_earnings_centavos, expires_at)
       values ($1, $2, 'offered', 6000, now() + interval '30 seconds')`,
      [orderId, riderId],
    );
  }

  /** Records a KYC document row for a rider (the file itself lives in the private bucket). */
  async kycDocument(riderId: string): Promise<string> {
    const { rows } = await this.db.query<{ id: string }>(
      `insert into public.rider_kyc_documents (rider_id, type, storage_path)
       values ($1::uuid, 'government_id', $1::text || '/government-id.jpg') returning id`,
      [riderId],
    );
    return firstId(rows);
  }
}

/** A role to grant, with the merchant or zone it applies to. */
export interface RoleGrant {
  readonly role: AppRole;
  readonly merchantId?: string;
  readonly zoneId?: string;
}

/**
 * Runs `fn` as a signed-in user (`authenticated` role with their JWT `sub`), or as an anonymous
 * visitor when `userId` is null, so RLS applies exactly as for a real client. Must run inside a
 * transaction; the role is restored afterwards.
 */
export async function asUser<T>(
  db: pg.ClientBase,
  userId: string | null,
  fn: () => Promise<T>,
): Promise<T> {
  const claims = userId ? { sub: userId, role: "authenticated" } : { role: "anon" };
  await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
  await db.query(userId ? "set local role authenticated" : "set local role anon");
  try {
    return await fn();
  } finally {
    await db.query("reset role");
  }
}

function firstId(rows: readonly { id: string }[]): string {
  const id = rows[0]?.id;
  if (!id) throw new Error("Insert returned no id");
  return id;
}
