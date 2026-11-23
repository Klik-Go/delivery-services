import { randomUUID } from "node:crypto";
import { getPrismaClient } from "@klikgo/db";
import { afterAll, describe, expect, it } from "vitest";
import {
  PrismaKpiRepository,
  PrismaPilotInviteRepository,
  PrismaPilotSettings,
  RandomInviteCodes,
} from "./prisma-pilot-repositories";

if (process.env.CI && !process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set in CI for repository tests.");
}
const describeDb = describe.skipIf(!process.env.DATABASE_URL);
const ADMIN = "5eed0000-0000-4000-8000-0000000000a1";

describeDb("pilot repositories (local Supabase, seed data)", () => {
  const prisma = getPrismaClient();

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("makes readable 8-character codes without look-alike characters", () => {
    const codes = new Set(Array.from({ length: 200 }, () => new RandomInviteCodes().next()));
    expect(codes.size).toBe(200);
    for (const code of codes) expect(code).toMatch(/^[A-HJKMNP-Z2-9]{8}$/);
  });

  it("creates invites, texts the waitlist once and redeems through the database", async () => {
    const repo = new PrismaPilotInviteRepository(prisma);
    const tag = randomUUID()
      .slice(0, 6)
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "A");
    const [signup] = await prisma.$queryRaw<{ id: string }[]>`
      insert into public.waitlist_signups (name, phone, barangay, location, created_at)
      values ('Wally Wait', '+639170009999', 'Poblacion',
              extensions.st_setsrid(extensions.st_makepoint(121.0, 14.5), 4326)::extensions.geography,
              now() - interval '10 years')
      returning id`;
    const waiting = await repo.waiting(500);
    expect(waiting.some((p) => p.waitlistId === signup?.id)).toBe(true);
    await repo.create(
      [
        { code: `W${tag}1`, batch: "Waitlist", waitlistId: signup?.id ?? null, expiresAt: null },
        { code: `F${tag}1`, batch: "Flyers", waitlistId: null, expiresAt: null },
      ],
      ADMIN,
    );
    await repo.markSent(`W${tag}1`, new Date());
    expect((await repo.waiting(500)).some((p) => p.waitlistId === signup?.id)).toBe(false);

    const [user] = await prisma.$queryRaw<{ id: string }[]>`select id from public.profiles limit 1`;
    const userId = user?.id ?? "";
    const before = await repo.hasAccess(userId);
    const outcome = await repo.redeem(`F${tag}1`, userId, 1_000_000, new Date());
    expect(before ? outcome === "already" : outcome === "ok").toBe(true);
    expect(await repo.hasAccess(userId)).toBe(true);
    expect(await repo.redeem("NOSUCHCODE", userId, 1_000_000, new Date())).toBe("already");

    const summary = await repo.summary(1000);
    expect(summary.invites.find((i) => i.code === `W${tag}1`)).toMatchObject({
      batch: "Waitlist",
      fromWaitlist: true,
    });
    expect(summary.total).toBeGreaterThanOrEqual(2);
  });

  it("reads the pilot switches with their settings and safe defaults", async () => {
    let now = 0;
    const settings = new PrismaPilotSettings(prisma, 1_000, () => now);
    expect(await settings.current()).toEqual({
      inviteOnly: false,
      maxCustomers: 100,
      categories: null,
      scheduledOrders: true,
    });
    await prisma.feature_flags.update({ where: { key: "pilot_scope" }, data: { enabled: true } });
    try {
      now = 5_000;
      expect((await settings.current()).categories).toEqual(["food"]);
      settings.forget();
    } finally {
      await prisma.feature_flags.update({
        where: { key: "pilot_scope" },
        data: { enabled: false },
      });
    }
  });

  it("computes KPI figures and a day-by-day trend", async () => {
    const kpis = new PrismaKpiRepository(prisma);
    const to = new Date();
    const figures = await kpis.figures(new Date(to.getTime() - 30 * 86_400_000), to);
    expect(figures.placed).toBeGreaterThanOrEqual(figures.delivered);
    expect(figures.riderOnlineSeconds).toBeGreaterThanOrEqual(0);
    const days = await kpis.daily(14, to);
    expect(days).toHaveLength(14);
    expect(days[13]?.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
