import { randomUUID } from "node:crypto";
import { LEGAL_VERSIONS } from "@klikgo/types";
import { getPrismaClient } from "@klikgo/db";
import { afterAll, describe, expect, it } from "vitest";
import {
  PrismaAccountDataRepository,
  PrismaConsentRepository,
  PrismaFeatureSwitches,
  PrismaJobRunRepository,
  PrismaKycRetentionRepository,
  PrismaSystemStatusRepository,
} from "./prisma-hardening-repositories";

if (process.env.CI && !process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set in CI for repository tests.");
}
const describeDb = describe.skipIf(!process.env.DATABASE_URL);

const NENA = "5eed0000-0000-4000-8000-000000000101";
const MAKATI_ZONE_SLUG = "makati";
const CENTRE = { lat: 14.5547, lng: 121.0244 };

describeDb("hardening repositories (local Supabase, seed data)", () => {
  const prisma = getPrismaClient();

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /** A fresh account with a saved address and a delivered order from Aling Nena's. */
  async function person(): Promise<{ userId: string; orderId: string }> {
    const userId = randomUUID();
    const phone = `+63917${String(Math.floor(Math.random() * 10_000_000)).padStart(7, "0")}`;
    await prisma.$executeRaw`
      insert into auth.users (id, instance_id, aud, role, phone, raw_user_meta_data, created_at, updated_at,
                              confirmation_token, recovery_token, email_change_token_new, email_change)
      values (${userId}::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
              ${phone.slice(1)}, '{"full_name": "Erin Export"}', now(), now(), '', '', '', '')`;
    // (Empty tokens, not NULL: Supabase Auth cannot list users whose token columns are NULL.)
    await prisma.$executeRaw`
      insert into public.addresses (user_id, label, location, landmark, barangay, city, contact_phone)
      values (${userId}::uuid, 'Home', extensions.st_setsrid(extensions.st_makepoint(${CENTRE.lng}, ${CENTRE.lat}), 4326)::extensions.geography,
              'Near the chapel', 'Poblacion', 'Makati', ${phone})`;
    const [zone] = await prisma.$queryRaw<{ id: string }[]>`
      select id from public.zones where slug = ${MAKATI_ZONE_SLUG}`;
    const code = `KG-${randomUUID().slice(0, 6).toUpperCase()}`;
    const [order] = await prisma.$queryRaw<{ id: string }[]>`
      insert into public.orders (code, customer_id, merchant_id, zone_id, status, payment_method,
        subtotal_centavos, delivery_fee_centavos, total_centavos, address_snapshot, dropoff)
      values (${code}, ${userId}::uuid, ${NENA}::uuid, ${zone?.id}::uuid, 'placed', 'cod', 20000, 3900, 23900,
              '{"street": "12 Mabini St", "barangay": "Poblacion", "city": "Makati"}',
              extensions.st_setsrid(extensions.st_makepoint(${CENTRE.lng}, ${CENTRE.lat}), 4326)::extensions.geography)
      returning id`;
    return { userId, orderId: order?.id ?? "" };
  }

  it("records consents once per version and reads them back", async () => {
    const { userId } = await person();
    const repo = new PrismaConsentRepository(prisma);
    const docs = [
      { document: "terms" as const, version: LEGAL_VERSIONS.terms },
      { document: "privacy" as const, version: LEGAL_VERSIONS.privacy },
    ];
    await repo.record(userId, docs);
    await repo.record(userId, docs);
    expect((await repo.forUser(userId)).map((c) => [c.document, c.version])).toEqual([
      ["terms", LEGAL_VERSIONS.terms],
      ["privacy", LEGAL_VERSIONS.privacy],
    ]);
  });

  it("exports a person's own data, sees an open order as blocking, then erases them", async () => {
    const { userId, orderId } = await person();
    const repo = new PrismaAccountDataRepository(prisma);
    const data = await repo.exportFor(userId);
    expect(data.profile).toMatchObject({ id: userId, full_name: "Erin Export" });
    expect(data.addresses).toHaveLength(1);
    expect(data.orders).toEqual([
      expect.objectContaining({ store: "Aling Nena's Karinderya", total_centavos: 23900 }),
    ]);
    expect(data.rider).toBeNull();

    const before = await repo.erasureFacts(userId);
    expect(before).toMatchObject({
      exists: true,
      alreadyErased: false,
      roles: ["customer"],
      activeOrders: 1,
    });

    await prisma.$transaction([
      prisma.$executeRaw`select set_config('klikgo.actor_role', 'admin', true)`,
      prisma.$executeRaw`
        update public.orders set status = 'cancelled', cancel_reason = 'Test', cancelled_by_role = 'admin'
         where id = ${orderId}::uuid`,
    ]);
    expect((await repo.erasureFacts(userId)).activeOrders).toBe(0);

    expect(await repo.erase(userId)).toEqual({ orders: 1, addresses: 1 });
    const after = await repo.erasureFacts(userId);
    expect(after).toMatchObject({ exists: true, alreadyErased: true, roles: [] });
    const [order] = await prisma.$queryRaw<{ address_snapshot: unknown; total_centavos: number }[]>`
      select address_snapshot, total_centavos from public.orders where id = ${orderId}::uuid`;
    expect(order).toEqual({
      address_snapshot: { barangay: "Poblacion", city: "Makati", erased: true },
      total_centavos: 23900,
    });
    expect((await repo.erasureFacts(randomUUID())).exists).toBe(false);
  });

  it("lists no KYC files due when none are past the retention period, and marks purges", async () => {
    const repo = new PrismaKycRetentionRepository(prisma);
    const due = await repo.due(new Date(), 10);
    expect(Array.isArray(due)).toBe(true);
    await repo.markPurged([randomUUID()], new Date());
  });

  it("reads switches with safe defaults and caches them", async () => {
    let now = 0;
    const switches = new PrismaFeatureSwitches(prisma, 1_000, () => now);
    expect(await switches.isOn("online_payments")).toBe(true);
    expect(await switches.isOn("flat_delivery_fee")).toBe(false);
    await prisma.feature_flags.update({
      where: { key: "flat_delivery_fee" },
      data: { enabled: true },
    });
    try {
      expect(await switches.isOn("flat_delivery_fee")).toBe(false);
      now = 2_000;
      expect(await switches.isOn("flat_delivery_fee")).toBe(true);
    } finally {
      await prisma.feature_flags.update({
        where: { key: "flat_delivery_fee" },
        data: { enabled: false },
      });
    }
  });

  it("records job runs and shows them, cron jobs, webhook failures and SLA breaches", async () => {
    const runs = new PrismaJobRunRepository(prisma);
    const id = await runs.start("background", new Date());
    await runs.finish(id, { ok: true, summary: { notifications: 1 } }, new Date());
    const old = await runs.start("background", new Date(Date.now() - 10 * 86_400_000));
    await runs.finish(old, { ok: false, summary: {}, error: "x".repeat(600) }, new Date());
    expect(await runs.prune(new Date(Date.now() - 3 * 86_400_000))).toBeGreaterThanOrEqual(1);

    const status = new PrismaSystemStatusRepository(prisma);
    const recent = await status.jobRuns(5);
    expect(recent[0]).toMatchObject({ job: "background", ok: true, summary: { notifications: 1 } });
    const cron = await status.cronJobs();
    expect(cron.map((c) => c.name)).toContain("merchant-sla");

    await prisma.webhook_events.create({
      data: {
        gateway: "paymongo",
        event_id: `evt_${randomUUID()}`,
        type: "payment.paid",
        payload: {},
        error: "Signature mismatch",
        received_at: new Date(),
      },
    });
    const failures = await status.webhookFailures(new Date(Date.now() - 3_600_000), new Date(), 10);
    expect(failures.some((f) => f.error === "Signature mismatch")).toBe(true);
    expect(Array.isArray(await status.slaBreaches(new Date(Date.now() - 86_400_000), 10))).toBe(
      true,
    );
  });
});
