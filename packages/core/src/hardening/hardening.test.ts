import { LEGAL_VERSIONS } from "@klikgo/types";
import { describe, expect, it } from "vitest";
import { AuthorizationService } from "../auth/authorization-service";
import { ConsoleAccess } from "../ops/console-access";
import type { AuditEntry, IAuditLog } from "../ops/ports";
import { BackgroundJobs } from "../ordering/background-jobs";
import { ONLINE_PAYMENTS_PAUSED } from "../ordering/order-service";
import { REDACTED } from "../shared/pii";
import {
  FakeAccountAuthAdmin,
  FakeClock,
  FakeKycFileRemover,
  InMemoryAccountData,
  InMemoryConsents,
  InMemoryJobRuns,
  InMemoryKycRetention,
  InMemoryRateLimiter,
  InMemorySystemStatus,
  MemoryLogger,
  RecordingAnalytics,
  RecordingErrorReporter,
  barakoOrder,
  orderingWorld,
  sessionUser,
  type FakeAccount,
} from "../testing";
import { AccountService, blocker } from "./account-service";
import { ConsentService, safeNext } from "./consent-service";
import { KycRetentionService } from "./kyc-retention-service";
import { AnalyticsService, ErrorReportingService } from "./observability";
import { JOB_LAG_ALERT_SECONDS, SystemStatusService } from "./system-status-service";

const NOW = new Date("2026-11-23T04:00:00Z");
const customer = sessionUser("cust-1", [{ role: "customer" }], "aal1");
const admin = sessionUser("admin-1", [{ role: "admin" }]);
const coordinator = sessionUser("coord-1", [{ role: "coordinator", zoneId: "zone-1" }]);

class AuditSpy implements IAuditLog {
  readonly entries: AuditEntry[] = [];
  record(entry: AuditEntry): Promise<void> {
    this.entries.push(entry);
    return Promise.resolve();
  }
}

describe("ConsentService", () => {
  const versions = { terms: LEGAL_VERSIONS.terms, privacy: LEGAL_VERSIONS.privacy };

  it("sends someone who has not agreed to the current documents to the consent screen first", async () => {
    const consents = new InMemoryConsents(() => NOW);
    const service = new ConsentService({ consents });
    expect(await service.missing("cust-1")).toEqual(["terms", "privacy"]);
    expect(await service.landingFor("cust-1", "/orders?tab=past")).toBe(
      "/consent?next=%2Forders%3Ftab%3Dpast",
    );

    const accepted = await service.accept(customer, versions);
    expect(accepted).toEqual({ ok: true, value: { accepted: ["terms", "privacy"] } });
    expect(await service.landingFor("cust-1", "/orders")).toBe("/orders");
    const status = await service.status(customer);
    expect(status.ok && status.value.needed).toEqual([]);
    expect(status.ok && status.value.accepted).toHaveLength(2);
  });

  it("asks again when a document gets a new version, and records each version once", async () => {
    const consents = new InMemoryConsents(() => NOW);
    await consents.record("cust-1", [
      { document: "terms", version: "2025-01-01" },
      { document: "privacy", version: LEGAL_VERSIONS.privacy },
    ]);
    const service = new ConsentService({ consents });
    expect(await service.missing("cust-1")).toEqual(["terms"]);
    await service.accept(customer, versions);
    await service.accept(customer, versions);
    expect(consents.records.get("cust-1")).toHaveLength(3);
  });

  it("needs a signed-in person", async () => {
    const service = new ConsentService({ consents: new InMemoryConsents() });
    expect((await service.status(null)).ok).toBe(false);
    expect((await service.accept(null, versions)).ok).toBe(false);
  });

  it("keeps the next page on this site (no open redirects)", () => {
    expect(safeNext("/s/kape")).toBe("/s/kape");
    for (const bad of ["https://evil.example", "//evil.example", "/\\evil", "", null, undefined]) {
      expect(safeNext(bad), String(bad)).toBe("/");
    }
  });
});

describe("AccountService", () => {
  function world(account: Partial<FakeAccount["facts"]> = {}) {
    const accounts = new InMemoryAccountData();
    accounts.accounts.set("cust-1", {
      profile: { fullName: "Ana Cruz", phone: "+639171234567", status: "active" },
      facts: {
        roles: ["customer"],
        activeOrders: 0,
        activeDeliveries: 0,
        cashHeldCentavos: 0,
        unpaidCentavos: 0,
        ...account,
      },
      addresses: ["Home"],
      orders: [{ id: "o-1", totalCentavos: 23900, address: "12 Mabini St" }],
    });
    const authAdmin = new FakeAccountAuthAdmin();
    const audit = new AuditSpy();
    const service = new AccountService({
      accounts,
      authAdmin,
      audit,
      rateLimiter: new InMemoryRateLimiter(),
      clock: new FakeClock(NOW),
      logger: new MemoryLogger(),
    });
    return { accounts, authAdmin, audit, service };
  }

  it("exports the person's data as a dated JSON file and audits it", async () => {
    const { service, audit } = world();
    const file = await service.exportData(customer);
    expect(file.ok && file.value.filename).toBe("klikgo-my-data-2026-11-23.json");
    const body = file.ok ? (JSON.parse(file.value.body) as { orders: unknown[] }) : null;
    expect(body?.orders).toHaveLength(1);
    expect(audit.entries).toEqual([
      expect.objectContaining({
        action: "privacy.export",
        actorId: "cust-1",
        actorRole: "customer",
      }),
    ]);
  });

  it("allows three exports a day", async () => {
    const { service } = world();
    for (let i = 0; i < 3; i += 1) expect((await service.exportData(customer)).ok).toBe(true);
    const fourth = await service.exportData(customer);
    expect(!fourth.ok && fourth.error.code).toBe("RATE_LIMITED");
    expect((await service.exportData(null)).ok).toBe(false);
  });

  it("erases the account, removes the sign-in and audits it, once", async () => {
    const { service, accounts, authAdmin, audit } = world();
    expect(await service.deleteAccount(customer, { confirm: "DELETE" })).toEqual({
      ok: true,
      value: { erased: true },
    });
    const erased = accounts.accounts.get("cust-1");
    expect(erased?.profile).toEqual({ fullName: null, phone: null, status: "deleted" });
    expect(erased?.addresses).toEqual([]);
    expect(erased?.orders).toEqual([{ id: "o-1", totalCentavos: 23900, address: null }]);
    expect(authAdmin.deleted).toEqual(["cust-1"]);
    expect(audit.entries.map((e) => [e.action, e.meta])).toEqual([
      ["privacy.erase", { orders: 1, addresses: 1 }],
    ]);
  });

  it("finishes the sign-in removal on a retry after Supabase Auth was down", async () => {
    const { service, authAdmin, audit } = world();
    authAdmin.down = true;
    const first = await service.deleteAccount(customer, { confirm: "DELETE" });
    expect(!first.ok && first.error.code).toBe("UNAVAILABLE");
    authAdmin.down = false;
    expect((await service.deleteAccount(customer, { confirm: "DELETE" })).ok).toBe(true);
    expect(audit.entries).toHaveLength(1);
    expect(authAdmin.deleted).toEqual(["cust-1"]);
  });

  it("needs the typed confirmation and a signed-in, known person", async () => {
    const { service } = world();
    const typo = await service.deleteAccount(customer, { confirm: "delete me" });
    expect(!typo.ok && typo.error.message).toBe("Type DELETE to confirm.");
    expect((await service.deleteAccount(null, { confirm: "DELETE" })).ok).toBe(false);
    const stranger = await service.deleteAccount(sessionUser("nobody", []), { confirm: "DELETE" });
    expect(!stranger.ok && stranger.error.code).toBe("UNAUTHORIZED");
  });

  it.each([
    [{ roles: ["merchant_owner"] as const }, "Ask an admin to remove your staff access first."],
    [{ activeOrders: 1 }, "You have an order in progress."],
    [{ activeDeliveries: 1 }, "You have a delivery in progress."],
    [{ cashHeldCentavos: 5000 }, "Hand in the cash on delivery you hold"],
    [{ unpaidCentavos: 12000 }, "You still have earnings to be paid."],
  ])("waits while something is in progress: %o", async (facts, message) => {
    const { service, authAdmin } = world({ ...facts, roles: [...(facts.roles ?? ["customer"])] });
    const refused = await service.deleteAccount(customer, { confirm: "DELETE" });
    expect(!refused.ok && refused.error.code).toBe("CONFLICT");
    expect(!refused.ok && refused.error.message).toContain(message);
    expect(authAdmin.deleted).toEqual([]);
  });

  it("lets a rider with nothing outstanding go", () => {
    expect(
      blocker({
        exists: true,
        alreadyErased: false,
        roles: ["customer", "rider"],
        activeOrders: 0,
        activeDeliveries: 0,
        cashHeldCentavos: 0,
        unpaidCentavos: 0,
      }),
    ).toBeNull();
  });
});

describe("KycRetentionService", () => {
  function world() {
    const retention = new InMemoryKycRetention();
    retention.files.push(
      { id: "d-1", riderId: "r-1", storagePath: "r-1/id.jpg", purgedAt: null },
      { id: "d-2", riderId: "r-1", storagePath: "r-1/selfie.jpg", purgedAt: null },
      { id: "d-3", riderId: "r-2", storagePath: "r-2/id.jpg", purgedAt: null },
    );
    const files = new FakeKycFileRemover();
    const audit = new AuditSpy();
    const service = new KycRetentionService({
      retention,
      files,
      audit,
      clock: new FakeClock(NOW),
      logger: new MemoryLogger(),
    });
    return { retention, files, audit, service };
  }

  it("deletes due files, marks them purged and audits each rider once", async () => {
    const { service, files, retention, audit } = world();
    expect(await service.purgeDue()).toEqual({ purged: 3 });
    expect(files.removed).toEqual(["r-1/id.jpg", "r-1/selfie.jpg", "r-2/id.jpg"]);
    expect(retention.files.every((f) => f.purgedAt?.getTime() === NOW.getTime())).toBe(true);
    expect(audit.entries.map((e) => [e.action, e.entityId, e.meta, e.actorId])).toEqual([
      ["kyc.purged", "r-1", { files: 2 }, null],
      ["kyc.purged", "r-2", { files: 1 }, null],
    ]);
    expect(await service.purgeDue()).toEqual({ purged: 0 });
  });

  it("marks nothing when storage is down, so the next run tries again", async () => {
    const { service, files, retention } = world();
    files.down = true;
    expect(await service.purgeDue()).toEqual({ purged: 0 });
    expect(retention.files.every((f) => f.purgedAt === null)).toBe(true);
  });
});

describe("ErrorReportingService", () => {
  function world() {
    const reporter = new RecordingErrorReporter();
    const logger = new MemoryLogger();
    const service = new ErrorReportingService({
      reporter,
      rateLimiter: new InMemoryRateLimiter(),
      logger,
    });
    return { reporter, logger, service };
  }

  it("reports server errors with phone numbers and personal fields removed", async () => {
    const { service, reporter } = world();
    await service.reportServer(new TypeError("No rider for +639171234567"), {
      requestId: "req-1",
      route: "/api/orders",
      extra: { phone: "09171234567", orderId: "o-1" },
    });
    expect(reporter.captured[0]?.error).toMatchObject({
      name: "TypeError",
      message: `No rider for ${REDACTED}`,
    });
    expect(reporter.captured[0]?.context).toMatchObject({
      source: "server",
      requestId: "req-1",
      extra: { phone: REDACTED, orderId: "o-1" },
    });
    await service.reportServer("plain string", {});
    await service.reportServer({ odd: true }, {});
    expect(reporter.captured.slice(1).map((c) => c.error.message)).toEqual([
      "plain string",
      "Unknown error",
    ]);
  });

  it("scrubs and rate limits browser reports", async () => {
    const { service, reporter } = world();
    const report = {
      kind: "error" as const,
      message: "Cannot read address of ana@example.ph",
      stack: "at checkout (0917 123 4567)",
      path: "/checkout",
      digest: "abc",
    };
    const context = { requestId: "req-2", userId: "cust-1", clientIp: "203.0.113.9" };
    expect(await service.reportBrowser(report, context)).toEqual({
      ok: true,
      value: { accepted: true },
    });
    expect(reporter.captured[0]).toEqual({
      error: {
        name: "error",
        message: `Cannot read address of ${REDACTED}`,
        stack: `at checkout (${REDACTED})`,
      },
      context: {
        source: "browser",
        requestId: "req-2",
        route: "/checkout",
        userId: "cust-1",
        tags: { digest: "abc" },
      },
    });
    for (let i = 0; i < 19; i += 1)
      await service.reportBrowser({ kind: "error", message: "x" }, context);
    const limited = await service.reportBrowser({ kind: "error", message: "x" }, context);
    expect(!limited.ok && limited.error.code).toBe("RATE_LIMITED");
  });

  it("never throws when the tracker is down", async () => {
    const { service, reporter, logger } = world();
    reporter.failing = true;
    await expect(service.reportServer(new Error("boom"), {})).resolves.toBeUndefined();
    expect(logger.lines.some((l) => l.message === "errors.report_failed")).toBe(true);
  });
});

describe("AnalyticsService", () => {
  function world() {
    const analytics = new RecordingAnalytics();
    const logger = new MemoryLogger();
    const service = new AnalyticsService({ analytics, clock: new FakeClock(NOW), logger });
    return { analytics, logger, service };
  }

  it("counts funnel events by account id, or the install id before sign-in, with ids only", async () => {
    const { service, analytics } = world();
    await service.track(
      { name: "store_viewed", storeId: "7b0c3a0e-4c4b-4f3e-9a51-2f3d1c6b8a10", path: "/s/kape" },
      { userId: null, anonymousId: "anon-1", optedOut: false },
    );
    await service.track(
      { name: "order_placed", orderId: "9b0c3a0e-4c4b-4f3e-9a51-2f3d1c6b8a10" },
      { userId: "cust-1", anonymousId: "anon-1", optedOut: false },
    );
    expect(analytics.events).toEqual([
      {
        distinctId: "anon-1",
        event: "store_viewed",
        properties: {
          signed_in: false,
          store_id: "7b0c3a0e-4c4b-4f3e-9a51-2f3d1c6b8a10",
          path: "/s/kape",
        },
        at: NOW,
      },
      {
        distinctId: "cust-1",
        event: "order_placed",
        properties: { signed_in: true, order_id: "9b0c3a0e-4c4b-4f3e-9a51-2f3d1c6b8a10" },
        at: NOW,
      },
    ]);
  });

  it("does not count browsers that opt out or have no id, and survives an outage", async () => {
    const { service, analytics, logger } = world();
    const optedOut = await service.track(
      { name: "home_viewed" },
      { userId: "cust-1", anonymousId: null, optedOut: true },
    );
    expect(optedOut).toEqual({ ok: true, value: { counted: false } });
    const anonymous = await service.track(
      { name: "home_viewed" },
      { userId: null, anonymousId: null, optedOut: false },
    );
    expect(anonymous.ok && anonymous.value.counted).toBe(false);
    analytics.failing = true;
    const down = await service.track(
      { name: "home_viewed" },
      { userId: "cust-1", anonymousId: null, optedOut: false },
    );
    expect(down.ok).toBe(true);
    expect(logger.lines.some((l) => l.message === "analytics.capture_failed")).toBe(true);
  });
});

describe("SystemStatusService", () => {
  function world() {
    const status = new InMemorySystemStatus();
    const clock = new FakeClock(NOW);
    const service = new SystemStatusService({
      access: new ConsoleAccess(new AuthorizationService(), new AuditSpy()),
      status,
      clock,
    });
    return { status, clock, service };
  }

  it("shows job lag, failing webhooks and missed deadlines to admins only", async () => {
    const { service, status } = world();
    const at = (msAgo: number) => new Date(NOW.getTime() - msAgo);
    await status.jobs.start("background", at(40_000));
    const id = await status.jobs.start("background", at(30_000));
    await status.jobs.finish(id, { ok: true, summary: { rewards: 1 } }, at(29_000));
    const failed = await status.jobs.start("background", at(5_000));
    await status.jobs.finish(failed, { ok: false, summary: {}, error: "TypeError" }, at(4_000));
    status.webhooks.push(
      {
        gateway: "paymongo",
        type: "payment.paid",
        receivedAt: at(60_000),
        error: "bad",
        processed: true,
      },
      {
        gateway: "paymongo",
        type: "payment.paid",
        receivedAt: at(10 * 60_000),
        error: null,
        processed: false,
      },
      {
        gateway: "paymongo",
        type: "payment.paid",
        receivedAt: at(60_000),
        error: null,
        processed: false,
      },
      {
        gateway: "paymongo",
        type: "payment.paid",
        receivedAt: at(2 * 86_400_000),
        error: "old",
        processed: true,
      },
    );
    status.breaches.push({
      orderId: "o-1",
      code: "KG-1",
      zoneId: "zone-1",
      merchantName: "Kape't Tinapay",
      kind: "store_late",
      at: at(3_600_000),
    });

    const result = await service.status(admin);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.jobs).toMatchObject({ lagSeconds: 29, healthy: true });
    expect(result.value.jobs.lastRun?.ok).toBe(false);
    expect(result.value.webhookFailures.map((w) => w.error)).toEqual(["bad", null]);
    expect(result.value.slaBreaches).toHaveLength(1);

    const refused = await service.status(coordinator);
    expect(!refused.ok && refused.error.code).toBe("FORBIDDEN");
  });

  it("flags the jobs as unhealthy when nothing succeeded recently", async () => {
    const { service, status } = world();
    expect((await service.status(admin)).ok && (await service.status(admin))).toMatchObject({
      value: { jobs: { lagSeconds: null, healthy: false, lastRun: null } },
    });
    const id = await status.jobs.start("background", new Date(NOW.getTime() - 600_000));
    await status.jobs.finish(
      id,
      { ok: true, summary: {} },
      new Date(NOW.getTime() - (JOB_LAG_ALERT_SECONDS + 1) * 1000),
    );
    const late = await service.status(admin);
    expect(late.ok && late.value.jobs.healthy).toBe(false);
  });
});

describe("BackgroundJobs run records", () => {
  function jobs(runs: InMemoryJobRuns, failing = false) {
    const w = orderingWorld(NOW);
    return new BackgroundJobs({
      notifications: {
        deliverQueued: () =>
          failing ? Promise.reject(new TypeError("db down")) : Promise.resolve(2),
      },
      lifecycle: w.store,
      refunds: w.refunds,
      kycRetention: { purgeDue: () => Promise.resolve({ purged: 1 }) },
      runs: { repository: runs, clock: new FakeClock(NOW) },
      logger: new MemoryLogger(),
    });
  }

  it("records each run with its counts and prunes runs older than three days", async () => {
    const runs = new InMemoryJobRuns();
    await runs.start("background", new Date(NOW.getTime() - 4 * 86_400_000));
    const result = await jobs(runs).run();
    expect(result.kycPurged).toBe(1);
    expect(runs.runs).toHaveLength(1);
    expect(runs.runs[0]).toMatchObject({
      job: "background",
      ok: true,
      summary: { notifications: 2, kycPurged: 1, rewards: 0 },
    });
  });

  it("records a failed run and still raises the error", async () => {
    const runs = new InMemoryJobRuns();
    await expect(jobs(runs, true).run()).rejects.toThrow("db down");
    expect(runs.runs[0]).toMatchObject({ ok: false, error: "TypeError" });
  });

  it("logs and carries on when the KYC purge fails", async () => {
    const w = orderingWorld(NOW);
    const logger = new MemoryLogger();
    const run = await new BackgroundJobs({
      notifications: { deliverQueued: () => Promise.resolve(0) },
      lifecycle: w.store,
      refunds: w.refunds,
      kycRetention: { purgeDue: () => Promise.reject(new Error("storage")) },
      logger,
    }).run();
    expect(run.kycPurged).toBe(0);
    expect(logger.lines.some((l) => l.message === "jobs.kyc_retention_failed")).toBe(true);
  });
});

describe("switches during an outage", () => {
  it("offers cash on delivery only and refuses online orders while online payments are paused", async () => {
    const w = orderingWorld();
    w.switches.set("online_payments", false);
    const quote = await w.orders.quoteCheckout(barakoOrder(), w.customer);
    expect(quote.ok && quote.value.paymentMethods).toEqual(["cod"]);
    const online = await w.orders.placeOrder(barakoOrder({ paymentMethod: "gcash" }), {
      idempotencyKey: "pause-online-1",
      actor: w.customer,
      urls: w.urls,
    });
    expect(!online.ok && online.error.message).toBe(ONLINE_PAYMENTS_PAUSED);
    const cod = await w.orders.placeOrder(barakoOrder(), {
      idempotencyKey: "pause-online-2",
      actor: w.customer,
      urls: w.urls,
    });
    expect(cod.ok).toBe(true);
  });

  it("charges the zone base fee whatever the distance while the flat fee is on", async () => {
    const w = orderingWorld();
    const far = barakoOrder({ dropoff: { lat: 14.5647, lng: 121.0344 } });
    const before = await w.orders.quoteCheckout(far, w.customer);
    w.switches.set("flat_delivery_fee", true);
    const flat = await w.orders.quoteCheckout(far, w.customer);
    const near = await w.orders.quoteCheckout(barakoOrder(), w.customer);
    const fee = (q: typeof flat) => (q.ok ? q.value.quote.deliveryFeeCentavos : -1);
    expect(fee(flat)).toBe(fee(near));
    expect(fee(before)).toBeGreaterThan(fee(flat));
  });
});
