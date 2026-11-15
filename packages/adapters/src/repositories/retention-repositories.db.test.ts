import { randomUUID } from "node:crypto";
import { getPrismaClient } from "@klikgo/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PrismaOrderHistoryRepository,
  PrismaPromoAdminRepository,
  PrismaRatingRepository,
  PrismaRewardsRepository,
  PrismaTicketRepository,
} from "./prisma-retention-repositories";

if (process.env.CI && !process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set in CI for repository tests.");
}
const describeDb = describe.skipIf(!process.env.DATABASE_URL);

const KAPE = "5eed0000-0000-4000-8000-000000000102";
const RICO = "5eed0000-0000-4000-8000-000000000201";
const RICO_USER = "5eed0000-0000-4000-8000-0000000000d1";
const CARMEN_HOME = { lat: 14.568, lng: 121.033 };
const ELSEWHERE = { lat: 14.5547, lng: 121.0244 };
const NEWCOMER_HOME = { lat: 14.561, lng: 121.016 };

/** Ratings, history, rewards, tickets and campaigns against the seeded local database. */
describeDb("retention repositories (local Supabase, seed data)", () => {
  const prisma = getPrismaClient();
  const ratings = new PrismaRatingRepository(prisma);
  const history = new PrismaOrderHistoryRepository(prisma);
  const rewards = new PrismaRewardsRepository(prisma);
  const tickets = new PrismaTicketRepository(prisma);
  const campaigns = new PrismaPromoAdminRepository(prisma);
  let zoneId = "";
  let referrer = "";
  let friend = "";

  /** A throwaway customer (the sign-up trigger makes the profile). */
  async function newCustomer(name: string): Promise<string> {
    const id = randomUUID();
    await prisma.$executeRaw`
      insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
                              confirmation_token, recovery_token, email_change_token_new, email_change,
                              created_at, updated_at)
      values (${id}::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
              ${`${id}@retention.test`}, '{}', ${JSON.stringify({ full_name: name })}::jsonb,
              '', '', '', '', now(), now())`;
    return id;
  }

  /** A COD order walked to delivered by Rico, the way dispatch and the rider app would. */
  async function deliveredOrder(
    customerId: string,
    dropoff = ELSEWHERE,
    subtotal = 20000,
  ): Promise<string> {
    const item = await prisma.menu_items.findFirstOrThrow({
      where: { merchant_id: KAPE, name: "Kapeng Barako" },
    });
    return prisma.$transaction(async (tx) => {
      const [order] = await tx.$queryRaw<{ id: string }[]>`
        insert into public.orders (customer_id, merchant_id, zone_id, status, payment_method,
                                   subtotal_centavos, delivery_fee_centavos, total_centavos,
                                   address_snapshot, dropoff)
        values (${customerId}::uuid, ${KAPE}::uuid, ${zoneId}::uuid, 'placed', 'cod', ${subtotal}, 3900,
                ${subtotal + 3900}, '{"label":"Home","landmark":"Gate","contact_phone":"+639170000031"}',
                extensions.st_setsrid(extensions.st_makepoint(${dropoff.lng}, ${dropoff.lat}), 4326)::extensions.geography)
        returning id`;
      const id = order?.id ?? "";
      await tx.$executeRaw`
        insert into public.order_items (order_id, menu_item_id, name_snapshot, unit_price_centavos,
                                        quantity, modifiers_snapshot, line_total_centavos)
        values (${id}::uuid, ${item.id}::uuid, 'Kapeng Barako', ${subtotal / 2}, 2, '[]', ${subtotal})`;
      for (const status of ["accepted", "preparing", "ready", "picked_up", "delivered"]) {
        await tx.$executeRaw`select set_config('klikgo.actor_role', '', true)`;
        await tx.$executeRaw`
          update public.orders set status = ${status}::public.order_status,
                 rider_id = case when ${status} = 'picked_up' then ${RICO}::uuid else rider_id end
           where id = ${id}::uuid`;
      }
      return id;
    });
  }

  beforeAll(async () => {
    zoneId = (
      await prisma.merchants.findUniqueOrThrow({ where: { id: KAPE }, select: { zone_id: true } })
    ).zone_id;
    referrer = await newCustomer("Rhea Referrer");
    friend = await newCustomer("Fely Friend");
    // Mark everything already delivered as processed, so these tests only see their own orders.
    await prisma.$executeRaw`update public.orders set rewards_processed_at = now()
                              where status = 'delivered' and rewards_processed_at is null`;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("saves, edits and reads ratings, opening one ticket for a low rating", async () => {
    const orderId = await deliveredOrder(referrer);
    const order = await ratings.order(orderId);
    expect(order).toMatchObject({ riderId: RICO, riderUserId: RICO_USER, status: "delivered" });
    const low = {
      orderId,
      fromUserId: referrer,
      targetType: "merchant" as const,
      targetId: KAPE,
      score: 2,
      tags: ["cold_food"],
      comment: "Lukewarm",
      ticket: { zoneId, summary: "Store Kape't Tinapay rated 2/5" },
    };
    const first = await ratings.save(low);
    const edited = await ratings.save({ ...low, score: 1, ticket: { zoneId, summary: "again" } });
    expect(edited).toMatchObject({ id: first.id, score: 1 });
    expect(await ratings.ratings(orderId)).toHaveLength(1);
    const open = await tickets.tickets([zoneId], "open");
    const mine = open.filter((t) => t.orderId === orderId);
    expect(mine).toMatchObject([
      { summary: "Store Kape't Tinapay rated 2/5", comment: "Lukewarm" },
    ]);

    await ratings.save({
      orderId,
      fromUserId: RICO_USER,
      targetType: "customer",
      targetId: referrer,
      score: 5,
      tags: ["polite"],
      comment: null,
      ticket: null,
    });
    const deliveries = await ratings.riderDeliveries(RICO_USER, new Date(Date.now() - 60_000));
    expect(deliveries.find((d) => d.order.id === orderId)?.rating).toMatchObject({ score: 5 });
    const profile = await prisma.profiles.findUniqueOrThrow({ where: { id: referrer } });
    expect(Number(profile.rating_avg)).toBe(5);

    const ticketId = mine[0]?.id ?? "";
    expect(await tickets.resolve(ticketId, RICO_USER, "Called the store")).toBe(true);
    expect(await tickets.resolve(ticketId, RICO_USER, "Again")).toBe(false);
    expect(await tickets.ticket(ticketId)).toMatchObject({
      status: "resolved",
      resolution: "Called the store",
    });
    expect((await tickets.tickets("all", "resolved")).some((t) => t.id === ticketId)).toBe(true);
    expect(await ratings.order(randomUUID())).toBeNull();
  });

  it("lists a customer's history with a summary and turns an order back into lines", async () => {
    const orderId = await deliveredOrder(friend, ELSEWHERE, 12000);
    const [latest] = await history.history(friend, null, 20);
    expect(latest).toMatchObject({
      id: orderId,
      status: "delivered",
      merchantSlug: "kapet-tinapay",
      itemCount: 2,
      itemsSummary: "2× Kapeng Barako",
      hasRider: true,
      rated: [],
    });
    expect(await history.history(friend, latest?.createdAt ?? null, 20)).toEqual([]);
    const source = await history.reorderSource(orderId);
    expect(source).toMatchObject({
      customerId: friend,
      merchantId: KAPE,
      lines: [{ quantity: 2 }],
    });
    expect(source?.dropoff.lat).toBeCloseTo(ELSEWHERE.lat, 5);
    expect(await history.reorderSource(randomUUID())).toBeNull();
  });

  it("gives referral codes, records one referral per device and rewards it once", async () => {
    const code = await rewards.referralCode(referrer);
    expect(code).toMatch(/^[A-Z2-9]{8}$/);
    expect(await rewards.referralCode(referrer)).toBe(code);
    expect(await rewards.referrerByCode(code)).toBe(referrer);
    const newcomer = await newCustomer("Nora Newcomer");
    const device = randomUUID().replace(/-/g, "").repeat(2);
    expect(
      await rewards.createReferral({
        referrerId: referrer,
        refereeId: newcomer,
        code,
        deviceHash: device,
      }),
    ).toBe(true);
    const another = await newCustomer("Ana Another");
    expect(
      await rewards.createReferral({
        referrerId: referrer,
        refereeId: another,
        code,
        deviceHash: device,
      }),
    ).toBe(false);
    expect(await rewards.referralOf(newcomer)).toEqual({ status: "pending" });
    expect(await rewards.orderCount(newcomer)).toBe(0);

    const orderId = await deliveredOrder(newcomer, NEWCOMER_HOME);
    const facts = (await rewards.rewardsDue(500)).find((f) => f.orderId === orderId);
    expect(facts).toMatchObject({
      customerId: newcomer,
      subtotalCentavos: 20000,
      openStamps: 0,
      referral: { referrerId: referrer, sameAddressAsReferrer: false },
    });
    const voucher = (ownerId: string) => ({
      ownerId,
      source: "referral" as const,
      type: "fixed_off" as const,
      discountCentavos: 5000,
      maxDiscountCentavos: null,
      description: "₱50 off",
      endsAt: new Date(Date.now() + 86_400_000),
    });
    const plan = {
      orderId,
      customerId: newcomer,
      stamp: true,
      loyaltyVoucher: null,
      referral: {
        id: facts?.referral?.id ?? "",
        outcome: "rewarded" as const,
        referrerVoucher: voucher(referrer),
        refereeVoucher: voucher(newcomer),
        rewardCentavos: 5000,
      },
    };
    expect(await rewards.applyRewards(plan)).toBe(true);
    expect(await rewards.applyRewards(plan)).toBe(false);
    expect(await rewards.referralOf(newcomer)).toEqual({ status: "rewarded" });
    expect((await rewards.referralCounts(referrer)).rewarded).toBe(1);
    expect(await rewards.openStamps(newcomer)).toBe(1);
    expect(await rewards.vouchers(newcomer)).toMatchObject([
      { type: "fixed_off", source: "referral", discountCentavos: 5000, used: false },
    ]);
  });

  it("spots a first order sent to the referrer's address and voids the referral", async () => {
    await prisma.$executeRaw`
      insert into public.addresses (user_id, label, location, landmark, barangay, city, contact_phone)
      values (${referrer}::uuid, 'Home',
              extensions.st_setsrid(extensions.st_makepoint(${CARMEN_HOME.lng}, ${CARMEN_HOME.lat}), 4326)::extensions.geography,
              'Blue gate', 'Poblacion', 'Makati City', '+639170000099')`;
    const sibling = await newCustomer("Sid Sibling");
    await rewards.createReferral({
      referrerId: referrer,
      refereeId: sibling,
      code: await rewards.referralCode(referrer),
      deviceHash: null,
    });
    const orderId = await deliveredOrder(sibling, CARMEN_HOME);
    const facts = (await rewards.rewardsDue(500)).find((f) => f.orderId === orderId);
    expect(facts?.referral?.sameAddressAsReferrer).toBe(true);
    await rewards.applyRewards({
      orderId,
      customerId: sibling,
      stamp: false,
      loyaltyVoucher: null,
      referral: { id: facts?.referral?.id ?? "", outcome: "void", reason: "Same address" },
    });
    expect(await rewards.referralOf(sibling)).toEqual({ status: "void" });
  });

  it("turns open stamps into a free-delivery voucher", async () => {
    const regular = await newCustomer("Reggie Regular");
    const orders: string[] = [];
    for (let i = 0; i < 3; i += 1) orders.push(await deliveredOrder(regular));
    for (const orderId of orders.slice(0, 2)) {
      await rewards.applyRewards({
        orderId,
        customerId: regular,
        stamp: true,
        loyaltyVoucher: null,
        referral: null,
      });
    }
    expect(await rewards.openStamps(regular)).toBe(2);
    await rewards.applyRewards({
      orderId: orders[2] ?? "",
      customerId: regular,
      stamp: true,
      loyaltyVoucher: {
        stamps: 3,
        voucher: {
          ownerId: regular,
          source: "loyalty",
          type: "free_delivery",
          discountCentavos: null,
          maxDiscountCentavos: null,
          description: "Free delivery",
          endsAt: new Date(Date.now() + 86_400_000),
        },
      },
      referral: null,
    });
    expect(await rewards.openStamps(regular)).toBe(0);
    const [voucher] = await rewards.vouchers(regular);
    expect(voucher).toMatchObject({ type: "free_delivery", source: "loyalty" });
    expect(voucher?.code).toMatch(/^LOYAL[A-Z2-9]{8}$/);
  });

  it("creates, lists and switches off campaigns; codes are unique", async () => {
    const code = `CAMP${randomUUID().slice(0, 6).toUpperCase().replace(/-/g, "0")}`;
    const input = {
      code,
      type: "percent_off" as const,
      discountBps: 1000,
      maxDiscountCentavos: 6000,
      minSubtotalCentavos: 15000,
      startsAt: new Date().toISOString(),
      endsAt: new Date(Date.now() + 86_400_000).toISOString(),
      perUserLimit: 1,
      budgetCentavos: 100000,
      firstOrders: 1,
    };
    const id = await campaigns.create(input);
    expect(id).toBeTruthy();
    expect(await campaigns.create(input)).toBeNull();
    expect(await campaigns.setActive(id ?? "", false)).toBe(true);
    expect(await campaigns.setActive(randomUUID(), false)).toBe(false);
    const listed = (await campaigns.campaigns()).find((p) => p.id === id);
    expect(listed).toMatchObject({
      code,
      isActive: false,
      budgetCentavos: 100000,
      firstOrders: 1,
      redemptions: 0,
    });
  });
});
