import type { IAuditLog } from "../ops/ports";
import type { Clock } from "../ports/clock";
import type { Logger } from "../ports/logger";
import type { IKycFileRemover, IKycRetentionRepository } from "./ports";

/**
 * Deletes rider ID files once Klik Go no longer needs them (RA 10173: keep personal data only as
 * long as necessary): rejected applications after `rejected_days`, riders who stopped riding after
 * `inactive_days`, erased accounts at once. The document rows stay, marked purged, as the record.
 */
export class KycRetentionService {
  constructor(
    private readonly deps: {
      retention: IKycRetentionRepository;
      files: IKycFileRemover;
      audit: IAuditLog;
      clock: Clock;
      logger: Logger;
      batchSize?: number;
    },
  ) {}

  async purgeDue(): Promise<{ readonly purged: number }> {
    const now = this.deps.clock.now();
    const due = await this.deps.retention.due(now, this.deps.batchSize ?? 50);
    if (due.length === 0) return { purged: 0 };
    const removed = await this.deps.files.remove(due.map((file) => file.storagePath));
    if (!removed.ok) {
      // Retried on the next run; nothing was marked.
      this.deps.logger.warn("kyc.purge_failed", { files: due.length, code: removed.error.code });
      return { purged: 0 };
    }
    await this.deps.retention.markPurged(
      due.map((file) => file.id),
      now,
    );
    for (const riderId of new Set(due.map((file) => file.riderId))) {
      await this.deps.audit.record({
        actorId: null,
        actorRole: null,
        action: "kyc.purged",
        entityType: "riders",
        entityId: riderId,
        meta: { files: due.filter((file) => file.riderId === riderId).length },
      });
    }
    this.deps.logger.info("kyc.purged", { files: due.length });
    return { purged: due.length };
  }
}
