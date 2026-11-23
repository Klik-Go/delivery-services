import type { AppRole, FunnelEvent, LegalDocument } from "@klikgo/types";
import type { AppError } from "../shared/errors";
import type { Result } from "../shared/result";

// ---------------------------------------------------------------------------
// Consent
// ---------------------------------------------------------------------------

/** One recorded agreement to a dated version of a document. */
export interface ConsentRecord {
  readonly document: LegalDocument;
  readonly version: string;
  readonly acceptedAt: Date;
}

export interface IConsentRepository {
  /** Every agreement this person has recorded. */
  forUser(userId: string): Promise<ConsentRecord[]>;
  /** Records agreements; a version already recorded is left as it is. */
  record(
    userId: string,
    documents: readonly { readonly document: LegalDocument; readonly version: string }[],
  ): Promise<void>;
}

// ---------------------------------------------------------------------------
// Account data: export and erasure
// ---------------------------------------------------------------------------

/** Everything Klik Go holds about one person, as they may download it (RA 10173 §18). */
export interface AccountExport {
  readonly generatedAt: string;
  readonly profile: Readonly<Record<string, unknown>>;
  readonly roles: readonly Readonly<Record<string, unknown>>[];
  readonly consents: readonly Readonly<Record<string, unknown>>[];
  readonly addresses: readonly Readonly<Record<string, unknown>>[];
  readonly orders: readonly Readonly<Record<string, unknown>>[];
  readonly ratings: readonly Readonly<Record<string, unknown>>[];
  readonly rewards: Readonly<Record<string, unknown>>;
  /** Present for riders: the rider record, document list (never the files), payouts. */
  readonly rider: Readonly<Record<string, unknown>> | null;
}

/** What could stop an account from being erased now. */
export interface ErasureFacts {
  readonly exists: boolean;
  readonly alreadyErased: boolean;
  readonly roles: readonly AppRole[];
  /** Orders placed by the person that have not finished. */
  readonly activeOrders: number;
  /** Deliveries assigned to the person as a rider that have not finished. */
  readonly activeDeliveries: number;
  /** Cash on delivery the rider still holds. */
  readonly cashHeldCentavos: number;
  /** Earnings not yet paid out (payable, due or draft payouts). */
  readonly unpaidCentavos: number;
}

export interface IAccountDataRepository {
  exportFor(userId: string): Promise<AccountExport>;
  erasureFacts(userId: string): Promise<ErasureFacts>;
  /** Anonymises the account in one transaction (private.erase_account). */
  erase(userId: string): Promise<{ readonly orders: number; readonly addresses: number }>;
}

/** The auth side of erasure (Supabase Auth admin, server only). */
export interface IAccountAuthAdmin {
  /** Removes the sign-in (phone, email, identities, sessions) but keeps the user id for records. */
  softDelete(userId: string): Promise<Result<void, AppError>>;
}

// ---------------------------------------------------------------------------
// KYC retention
// ---------------------------------------------------------------------------

export interface KycFileDue {
  readonly id: string;
  readonly riderId: string;
  readonly storagePath: string;
}

export interface IKycRetentionRepository {
  /** ID files due for deletion under the kyc_retention setting (or because the account was erased). */
  due(now: Date, limit: number): Promise<KycFileDue[]>;
  markPurged(ids: readonly string[], at: Date): Promise<void>;
}

export interface IKycFileRemover {
  /** Deletes files from the private bucket; deleting a file that is already gone succeeds. */
  remove(paths: readonly string[]): Promise<Result<void, AppError>>;
}

// ---------------------------------------------------------------------------
// Switches (feature flags that change behaviour at runtime)
// ---------------------------------------------------------------------------

/** online_payments: off = cash on delivery only. flat_delivery_fee: on = the zone base fee. */
export type SwitchKey = "online_payments" | "flat_delivery_fee";

export interface IFeatureSwitches {
  isOn(key: SwitchKey): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Observability
// ---------------------------------------------------------------------------

/** Where an error happened, already free of personal data. */
export interface ErrorContext {
  readonly source: "server" | "browser";
  readonly requestId?: string;
  readonly route?: string;
  readonly userId?: string;
  readonly tags?: Readonly<Record<string, string>>;
  readonly extra?: Readonly<Record<string, unknown>>;
}

/** An error tracker (Sentry in production; a no-op when not configured). */
export interface IErrorReporter {
  capture(
    error: { readonly name: string; readonly message: string; readonly stack?: string },
    context: ErrorContext,
  ): Promise<void>;
}

/** One product analytics event, keyed by an opaque id only. */
export interface AnalyticsCapture {
  readonly distinctId: string;
  readonly event: FunnelEvent;
  readonly properties: Readonly<Record<string, string | number | boolean>>;
  readonly at: Date;
}

/** Product analytics (PostHog in production; a no-op when not configured). */
export interface IAnalytics {
  capture(event: AnalyticsCapture): Promise<void>;
}

// ---------------------------------------------------------------------------
// Background job runs and system status
// ---------------------------------------------------------------------------

export interface IJobRunRepository {
  start(job: string, at: Date): Promise<string>;
  finish(
    id: string,
    outcome: {
      readonly ok: boolean;
      readonly summary: Readonly<Record<string, number>>;
      readonly error?: string;
    },
    at: Date,
  ): Promise<void>;
  /** Deletes runs older than `before`. */
  prune(before: Date): Promise<number>;
}

export interface JobRunView {
  readonly job: string;
  readonly startedAt: Date;
  readonly finishedAt: Date | null;
  readonly ok: boolean | null;
  readonly summary: Readonly<Record<string, unknown>>;
  readonly error: string | null;
}

export interface CronJobView {
  readonly name: string;
  readonly schedule: string;
  readonly lastRunAt: Date | null;
  readonly lastStatus: string | null;
}

export interface WebhookFailureView {
  readonly gateway: string;
  readonly type: string;
  readonly receivedAt: Date;
  /** null while it is still waiting to be processed. */
  readonly error: string | null;
}

export interface SlaBreachView {
  readonly orderId: string;
  readonly code: string;
  readonly zoneId: string;
  readonly merchantName: string;
  readonly kind: "store_late" | "no_rider";
  readonly at: Date;
}

export interface ISystemStatusRepository {
  /** The latest runs of the background jobs, newest first. */
  jobRuns(limit: number): Promise<JobRunView[]>;
  /** pg_cron jobs with their last run. */
  cronJobs(): Promise<CronJobView[]>;
  /** Webhooks that failed, or still unprocessed after `staleBefore`, since `since`. */
  webhookFailures(since: Date, staleBefore: Date, limit: number): Promise<WebhookFailureView[]>;
  /** Orders the store did not accept in time, or no rider took, since `since`. */
  slaBreaches(since: Date, limit: number): Promise<SlaBreachView[]>;
}
