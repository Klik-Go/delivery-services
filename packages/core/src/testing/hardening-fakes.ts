import type { LegalDocument } from "@klikgo/types";
import type {
  AccountExport,
  AnalyticsCapture,
  ConsentRecord,
  CronJobView,
  ErasureFacts,
  ErrorContext,
  IAccountAuthAdmin,
  IAccountDataRepository,
  IAnalytics,
  IConsentRepository,
  IErrorReporter,
  IFeatureSwitches,
  IJobRunRepository,
  IKycFileRemover,
  IKycRetentionRepository,
  ISystemStatusRepository,
  JobRunView,
  KycFileDue,
  SlaBreachView,
  SwitchKey,
  WebhookFailureView,
} from "../hardening/ports";
import { ServiceUnavailableError, type AppError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";

/** Consents in memory. */
export class InMemoryConsents implements IConsentRepository {
  readonly records = new Map<string, ConsentRecord[]>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  forUser(userId: string): Promise<ConsentRecord[]> {
    return Promise.resolve([...(this.records.get(userId) ?? [])]);
  }

  record(
    userId: string,
    documents: readonly { readonly document: LegalDocument; readonly version: string }[],
  ): Promise<void> {
    const mine = this.records.get(userId) ?? [];
    for (const { document, version } of documents) {
      if (!mine.some((r) => r.document === document && r.version === version))
        mine.push({ document, version, acceptedAt: this.now() });
    }
    this.records.set(userId, mine);
    return Promise.resolve();
  }
}

/** One account's data in memory, with the same erasure rules as private.erase_account. */
export interface FakeAccount {
  profile: { fullName: string | null; phone: string | null; status: "active" | "deleted" };
  facts: Omit<ErasureFacts, "exists" | "alreadyErased">;
  addresses: string[];
  orders: { id: string; totalCentavos: number; address: string | null }[];
}

export class InMemoryAccountData implements IAccountDataRepository {
  readonly accounts = new Map<string, FakeAccount>();

  exportFor(userId: string): Promise<AccountExport> {
    const account = this.accounts.get(userId);
    return Promise.resolve({
      generatedAt: "2026-11-23T00:00:00.000Z",
      profile: { id: userId, ...(account?.profile ?? {}) },
      roles: (account?.facts.roles ?? []).map((role) => ({ role })),
      consents: [],
      addresses: (account?.addresses ?? []).map((label) => ({ label })),
      orders: account?.orders ?? [],
      ratings: [],
      rewards: {},
      rider: null,
    });
  }

  erasureFacts(userId: string): Promise<ErasureFacts> {
    const account = this.accounts.get(userId);
    if (!account) {
      return Promise.resolve({
        exists: false,
        alreadyErased: false,
        roles: [],
        activeOrders: 0,
        activeDeliveries: 0,
        cashHeldCentavos: 0,
        unpaidCentavos: 0,
      });
    }
    return Promise.resolve({
      exists: true,
      alreadyErased: account.profile.status === "deleted",
      ...account.facts,
    });
  }

  erase(userId: string): Promise<{ orders: number; addresses: number }> {
    const account = this.accounts.get(userId);
    if (!account) return Promise.reject(new Error("no such account"));
    const addresses = account.addresses.length;
    const orders = account.orders.filter((o) => o.address !== null).length;
    account.addresses = [];
    account.orders = account.orders.map((o) => ({ ...o, address: null }));
    account.profile = { fullName: null, phone: null, status: "deleted" };
    account.facts = { ...account.facts, roles: [] };
    return Promise.resolve({ orders, addresses });
  }
}

/** Records soft deletes; `down` simulates Supabase Auth being unreachable. */
export class FakeAccountAuthAdmin implements IAccountAuthAdmin {
  readonly deleted: string[] = [];
  down = false;

  softDelete(userId: string): Promise<Result<void, AppError>> {
    if (this.down)
      return Promise.resolve(err(new ServiceUnavailableError("Try again in a moment.")));
    if (!this.deleted.includes(userId)) this.deleted.push(userId);
    return Promise.resolve(ok(undefined));
  }
}

/** ID files due for deletion, in memory. */
export class InMemoryKycRetention implements IKycRetentionRepository {
  readonly files: (KycFileDue & { purgedAt: Date | null })[] = [];

  due(_now: Date, limit: number): Promise<KycFileDue[]> {
    return Promise.resolve(
      this.files
        .filter((f) => f.purgedAt === null)
        .slice(0, limit)
        .map(({ id, riderId, storagePath }) => ({ id, riderId, storagePath })),
    );
  }

  markPurged(ids: readonly string[], at: Date): Promise<void> {
    for (const file of this.files) if (ids.includes(file.id)) file.purgedAt = at;
    return Promise.resolve();
  }
}

/** Storage that records deletions; `down` makes every call fail. */
export class FakeKycFileRemover implements IKycFileRemover {
  readonly removed: string[] = [];
  down = false;

  remove(paths: readonly string[]): Promise<Result<void, AppError>> {
    if (this.down) return Promise.resolve(err(new ServiceUnavailableError("Storage is down.")));
    this.removed.push(...paths);
    return Promise.resolve(ok(undefined));
  }
}

/** Switches you flip in a test; unknown switches are off except online payments. */
export class InMemorySwitches implements IFeatureSwitches {
  private readonly state = new Map<SwitchKey, boolean>([
    ["online_payments", true],
    ["flat_delivery_fee", false],
  ]);

  set(key: SwitchKey, on: boolean): this {
    this.state.set(key, on);
    return this;
  }

  isOn(key: SwitchKey): Promise<boolean> {
    return Promise.resolve(this.state.get(key) ?? false);
  }
}

/** Keeps captured errors; `failing` makes the tracker throw. */
export class RecordingErrorReporter implements IErrorReporter {
  readonly captured: {
    error: { name: string; message: string; stack?: string };
    context: ErrorContext;
  }[] = [];
  failing = false;

  capture(
    error: { readonly name: string; readonly message: string; readonly stack?: string },
    context: ErrorContext,
  ): Promise<void> {
    if (this.failing) return Promise.reject(new Error("tracker down"));
    this.captured.push({ error: { ...error }, context });
    return Promise.resolve();
  }
}

/** Keeps analytics events; `failing` makes the provider throw. */
export class RecordingAnalytics implements IAnalytics {
  readonly events: AnalyticsCapture[] = [];
  failing = false;

  capture(event: AnalyticsCapture): Promise<void> {
    if (this.failing) return Promise.reject(new Error("analytics down"));
    this.events.push(event);
    return Promise.resolve();
  }
}

/** job_runs in memory. */
export class InMemoryJobRuns implements IJobRunRepository {
  readonly runs: (JobRunView & { id: string })[] = [];

  start(job: string, at: Date): Promise<string> {
    const id = String(this.runs.length + 1);
    this.runs.unshift({
      id,
      job,
      startedAt: at,
      finishedAt: null,
      ok: null,
      summary: {},
      error: null,
    });
    return Promise.resolve(id);
  }

  finish(
    id: string,
    outcome: {
      readonly ok: boolean;
      readonly summary: Readonly<Record<string, number>>;
      readonly error?: string;
    },
    at: Date,
  ): Promise<void> {
    const index = this.runs.findIndex((r) => r.id === id);
    const run = this.runs[index];
    if (run) {
      this.runs[index] = {
        ...run,
        finishedAt: at,
        ok: outcome.ok,
        summary: outcome.summary,
        error: outcome.error ?? null,
      };
    }
    return Promise.resolve();
  }

  prune(before: Date): Promise<number> {
    const keep = this.runs.filter((r) => r.startedAt >= before);
    const pruned = this.runs.length - keep.length;
    this.runs.splice(0, this.runs.length, ...keep);
    return Promise.resolve(pruned);
  }
}

/** System status read model in memory. */
export class InMemorySystemStatus implements ISystemStatusRepository {
  constructor(
    readonly jobs: InMemoryJobRuns = new InMemoryJobRuns(),
    readonly cron: CronJobView[] = [],
    readonly webhooks: (WebhookFailureView & { processed: boolean })[] = [],
    readonly breaches: SlaBreachView[] = [],
  ) {}

  jobRuns(limit: number): Promise<JobRunView[]> {
    return Promise.resolve(this.jobs.runs.slice(0, limit));
  }

  cronJobs(): Promise<CronJobView[]> {
    return Promise.resolve([...this.cron]);
  }

  webhookFailures(since: Date, staleBefore: Date, limit: number): Promise<WebhookFailureView[]> {
    return Promise.resolve(
      this.webhooks
        .filter(
          (w) =>
            w.receivedAt >= since &&
            (w.error !== null || (!w.processed && w.receivedAt < staleBefore)),
        )
        .slice(0, limit)
        .map(({ processed: _processed, ...view }) => view),
    );
  }

  slaBreaches(since: Date, limit: number): Promise<SlaBreachView[]> {
    return Promise.resolve(this.breaches.filter((b) => b.at >= since).slice(0, limit));
  }
}
