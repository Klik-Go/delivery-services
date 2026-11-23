import type {
  AccountExport,
  ConsentRecord,
  CronJobView,
  ErasureFacts,
  IAccountDataRepository,
  IConsentRepository,
  IFeatureSwitches,
  IJobRunRepository,
  IKycRetentionRepository,
  ISystemStatusRepository,
  JobRunView,
  KycFileDue,
  SlaBreachView,
  SwitchKey,
  WebhookFailureView,
} from "@klikgo/core";
import type { Prisma, PrismaClient } from "@klikgo/db";
import type { AppRole, LegalDocument } from "@klikgo/types";

const num = (value: number | bigint | Prisma.Decimal | null | undefined): number =>
  value === null || value === undefined ? 0 : Number(value);

/** Order statuses that are over (nothing more happens to the order). */
const FINISHED = ["delivered", "rejected", "cancelled", "failed_delivery"] as const;

/** consents (server writes; the person and admins read through RLS elsewhere). */
export class PrismaConsentRepository implements IConsentRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async forUser(userId: string): Promise<ConsentRecord[]> {
    const rows = await this.prisma.consents.findMany({
      where: { user_id: userId },
      orderBy: { accepted_at: "asc" },
    });
    return rows.map((row) => ({
      document: row.document as LegalDocument,
      version: row.version,
      acceptedAt: row.accepted_at,
    }));
  }

  async record(
    userId: string,
    documents: readonly { readonly document: LegalDocument; readonly version: string }[],
  ): Promise<void> {
    await this.prisma.consents.createMany({
      data: documents.map((d) => ({ user_id: userId, document: d.document, version: d.version })),
      skipDuplicates: true,
    });
  }
}

/** Everything about one person (export) and the erasure itself (private.erase_account). */
export class PrismaAccountDataRepository implements IAccountDataRepository {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async exportFor(userId: string): Promise<AccountExport> {
    const [profile, roles, consents, addresses, orders, ratings, stamps, referrals, rider] =
      await Promise.all([
        this.prisma.profiles.findUnique({
          where: { id: userId },
          select: {
            id: true,
            full_name: true,
            phone: true,
            email: true,
            locale: true,
            status: true,
            created_at: true,
          },
        }),
        this.prisma.user_roles.findMany({
          where: { user_id: userId },
          select: { role: true, merchant_id: true, zone_id: true, created_at: true },
        }),
        this.prisma.consents.findMany({
          where: { user_id: userId },
          select: { document: true, version: true, accepted_at: true },
        }),
        this.prisma.$queryRaw<Record<string, unknown>[]>`
          select label, street, landmark, barangay, city, notes, contact_phone, is_default,
                 extensions.st_y(location::extensions.geometry) as lat,
                 extensions.st_x(location::extensions.geometry) as lng, created_at
            from public.addresses where user_id = ${userId}::uuid order by created_at`,
        this.prisma.$queryRaw<Record<string, unknown>[]>`
          select o.code, m.name as store, o.status::text as status, o.payment_method::text as payment_method,
                 o.subtotal_centavos, o.delivery_fee_centavos, o.service_fee_centavos,
                 o.small_order_fee_centavos, o.discount_centavos, o.tip_centavos, o.total_centavos,
                 o.address_snapshot, o.placed_at, o.delivered_at, o.cancelled_at, o.created_at,
                 coalesce((select jsonb_agg(jsonb_build_object('name', i.name_snapshot, 'quantity', i.quantity,
                            'line_total_centavos', i.line_total_centavos) order by i.created_at)
                             from public.order_items i where i.order_id = o.id), '[]'::jsonb) as items
            from public.orders o join public.merchants m on m.id = o.merchant_id
           where o.customer_id = ${userId}::uuid order by o.created_at`,
        this.prisma.ratings.findMany({
          where: { from_user_id: userId },
          select: { target_type: true, score: true, comment: true, created_at: true },
        }),
        this.prisma.loyalty_stamps.count({ where: { customer_id: userId } }),
        this.prisma.referrals.findMany({
          where: { OR: [{ referrer_id: userId }, { referee_id: userId }] },
          select: { code: true, status: true, reward_centavos: true, created_at: true },
        }),
        this.prisma.riders.findUnique({
          where: { user_id: userId },
          select: {
            id: true,
            vehicle_type: true,
            plate_no: true,
            status: true,
            payout_account_name: true,
            created_at: true,
          },
        }),
      ]);
    let riderData: AccountExport["rider"] = null;
    if (rider) {
      const [documents, payouts] = await Promise.all([
        this.prisma.rider_kyc_documents.findMany({
          where: { rider_id: rider.id },
          select: {
            type: true,
            status: true,
            created_at: true,
            reviewed_at: true,
            purged_at: true,
          },
        }),
        this.prisma.payouts.findMany({
          where: { party_type: "rider", party_id: rider.id },
          select: {
            period_start: true,
            period_end: true,
            amount_centavos: true,
            status: true,
            reference: true,
            paid_at: true,
          },
          orderBy: { period_start: "asc" },
        }),
      ]);
      riderData = { ...rider, documents, payouts };
    }
    return {
      generatedAt: this.now().toISOString(),
      profile: profile ?? { id: userId },
      roles,
      consents,
      addresses,
      orders,
      ratings,
      rewards: { loyaltyStamps: stamps, referrals },
      rider: riderData,
    };
  }

  async erasureFacts(userId: string): Promise<ErasureFacts> {
    const [row] = await this.prisma.$queryRaw<
      {
        status: string | null;
        roles: AppRole[] | null;
        active_orders: bigint;
        active_deliveries: bigint;
        held: bigint | null;
        unpaid: bigint | null;
      }[]
    >`
      with me as (select id, status::text as status from public.profiles where id = ${userId}::uuid),
           rider as (select id from public.riders where user_id = ${userId}::uuid)
      select (select status from me) as status,
             (select array_agg(role::text) from public.user_roles where user_id = ${userId}::uuid) as roles,
             (select count(*) from public.orders where customer_id = ${userId}::uuid
                and status::text <> all(${FINISHED as readonly string[]}::text[])) as active_orders,
             (select count(*) from public.orders where rider_id = (select id from rider)
                and status::text <> all(${FINISHED as readonly string[]}::text[])) as active_deliveries,
             (select sum(debit_centavos - credit_centavos) from public.ledger_entries
               where account = 'rider_cash_on_hand' and party_id = (select id from rider)) as held,
             (select sum(credit_centavos - debit_centavos) from public.ledger_entries
               where account in ('rider_payable', 'payouts_due') and party_id = (select id from rider)) as unpaid`;
    return {
      exists: row?.status !== null && row?.status !== undefined,
      alreadyErased: row?.status === "deleted",
      roles: row?.roles ?? [],
      activeOrders: num(row?.active_orders),
      activeDeliveries: num(row?.active_deliveries),
      cashHeldCentavos: Math.max(0, num(row?.held)),
      // Earned but not settled (rider_payable) plus approved but not yet paid (payouts_due).
      unpaidCentavos: Math.max(0, num(row?.unpaid)),
    };
  }

  async erase(userId: string): Promise<{ orders: number; addresses: number }> {
    const [row] = await this.prisma.$queryRaw<{ result: { orders: number; addresses: number } }[]>`
      select private.erase_account(${userId}::uuid) as result`;
    return { orders: row?.result.orders ?? 0, addresses: row?.result.addresses ?? 0 };
  }
}

/** ID files due for deletion (private.kyc_documents_due_for_purge). */
export class PrismaKycRetentionRepository implements IKycRetentionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async due(now: Date, limit: number): Promise<KycFileDue[]> {
    const rows = await this.prisma.$queryRaw<
      { id: string; rider_id: string; storage_path: string }[]
    >`select id, rider_id, storage_path from private.kyc_documents_due_for_purge(${now}, ${limit}::integer)`;
    return rows.map((r) => ({ id: r.id, riderId: r.rider_id, storagePath: r.storage_path }));
  }

  async markPurged(ids: readonly string[], at: Date): Promise<void> {
    await this.prisma.rider_kyc_documents.updateMany({
      where: { id: { in: [...ids] }, purged_at: null },
      data: { purged_at: at },
    });
  }
}

/**
 * Runtime switches from feature_flags, cached for a few seconds: checkout reads them on every
 * quote, and an admin's change still reaches every server within the cache time.
 */
export class PrismaFeatureSwitches implements IFeatureSwitches {
  private cache: { at: number; values: Map<string, boolean> } | null = null;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly ttlMs = 10_000,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async isOn(key: SwitchKey): Promise<boolean> {
    if (!this.cache || this.now() - this.cache.at > this.ttlMs) {
      const rows = await this.prisma.feature_flags.findMany({
        where: { key: { in: ["online_payments", "flat_delivery_fee"] } },
        select: { key: true, enabled: true },
      });
      this.cache = { at: this.now(), values: new Map(rows.map((r) => [r.key, r.enabled])) };
    }
    // A missing row means the safe default: online payments on, flat fee off.
    return this.cache.values.get(key) ?? key === "online_payments";
  }
}

/** job_runs. */
export class PrismaJobRunRepository implements IJobRunRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async start(job: string, at: Date): Promise<string> {
    const row = await this.prisma.job_runs.create({
      data: { job, started_at: at },
      select: { id: true },
    });
    return String(row.id);
  }

  async finish(
    id: string,
    outcome: {
      readonly ok: boolean;
      readonly summary: Readonly<Record<string, number>>;
      readonly error?: string;
    },
    at: Date,
  ): Promise<void> {
    await this.prisma.job_runs.update({
      where: { id: BigInt(id) },
      data: {
        finished_at: at,
        ok: outcome.ok,
        summary: outcome.summary,
        error: outcome.error?.slice(0, 500) ?? null,
      },
    });
  }

  async prune(before: Date): Promise<number> {
    const { count } = await this.prisma.job_runs.deleteMany({
      where: { job: "background", started_at: { lt: before } },
    });
    return count;
  }
}

/** The /admin/system read model. */
export class PrismaSystemStatusRepository implements ISystemStatusRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async jobRuns(limit: number): Promise<JobRunView[]> {
    const rows = await this.prisma.job_runs.findMany({
      orderBy: { started_at: "desc" },
      take: limit,
    });
    return rows.map((r) => ({
      job: r.job,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
      ok: r.ok,
      summary: (r.summary ?? {}) as Record<string, unknown>,
      error: r.error,
    }));
  }

  async cronJobs(): Promise<CronJobView[]> {
    const rows = await this.prisma.$queryRaw<
      { name: string; schedule: string; last_run_at: Date | null; last_status: string | null }[]
    >`
      select j.jobname as name, j.schedule,
             d.start_time as last_run_at, d.status as last_status
        from cron.job j
        left join lateral (
          select start_time, status from cron.job_run_details r
           where r.jobid = j.jobid order by r.start_time desc limit 1
        ) d on true
       order by j.jobname`;
    return rows.map((r) => ({
      name: r.name,
      schedule: r.schedule,
      lastRunAt: r.last_run_at,
      lastStatus: r.last_status,
    }));
  }

  async webhookFailures(
    since: Date,
    staleBefore: Date,
    limit: number,
  ): Promise<WebhookFailureView[]> {
    const rows = await this.prisma.webhook_events.findMany({
      where: {
        received_at: { gte: since },
        OR: [{ error: { not: null } }, { processed_at: null, received_at: { lt: staleBefore } }],
      },
      orderBy: { received_at: "desc" },
      take: limit,
      select: { gateway: true, type: true, received_at: true, error: true },
    });
    return rows.map((r) => ({
      gateway: r.gateway,
      type: r.type,
      receivedAt: r.received_at,
      error: r.error,
    }));
  }

  async slaBreaches(since: Date, limit: number): Promise<SlaBreachView[]> {
    const rows = await this.prisma.$queryRaw<
      { id: string; code: string; zone_id: string; merchant_name: string; kind: string; at: Date }[]
    >`
      select o.id, o.code, o.zone_id, m.name as merchant_name, b.kind, b.at
        from public.orders o
        join public.merchants m on m.id = o.merchant_id
        cross join lateral (values ('store_late', o.sla_flagged_at), ('no_rider', o.dispatch_flagged_at)) as b(kind, at)
       where b.at is not null and b.at >= ${since}
       order by b.at desc
       limit ${limit}::integer`;
    return rows.map((r) => ({
      orderId: r.id,
      code: r.code,
      zoneId: r.zone_id,
      merchantName: r.merchant_name,
      kind: r.kind === "no_rider" ? "no_rider" : "store_late",
      at: r.at,
    }));
  }
}
