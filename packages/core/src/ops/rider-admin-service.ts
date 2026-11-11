import type { KycDocumentType } from "@klikgo/types";
import type { SessionUser } from "../auth/session-user";
import type { IMessageSender } from "../dispatch/dispatch-service";
import type { Clock } from "../ports/clock";
import { ConflictError, NotFoundError, type AppError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";
import type { ConsoleAccess } from "./console-access";
import {
  REQUIRED_KYC_DOCUMENTS,
  type IKycStorage,
  type IRiderAdminRepository,
  type KycDocument,
  type RiderApplication,
} from "./ports";

/** Review links last one minute (docs/BUILD_PLAN.md Phase 8). */
export const KYC_LINK_SECONDS = 60;
/** Riders rated below this (with enough ratings) are listed for coaching (docs/BUSINESS.md §5.3). */
export const COACHING_RATING = 3.5;
export const COACHING_MIN_RATINGS = 5;

/** Where each required document stands for one rider. */
export interface ChecklistItem {
  readonly type: KycDocumentType;
  readonly document: KycDocument | null;
  readonly state: "missing" | "pending" | "approved" | "rejected";
}

export type RiderReview = RiderApplication & { readonly checklist: readonly ChecklistItem[] };

export function checklistOf(rider: RiderApplication): ChecklistItem[] {
  return REQUIRED_KYC_DOCUMENTS.map((type) => {
    const document = rider.documents.find((doc) => doc.type === type) ?? null;
    return { type, document, state: document ? document.status : "missing" };
  });
}

/**
 * Rider onboarding review and rider status (docs/BUSINESS.md Appendix B, §5.3). The zone's
 * coordinator (or an admin) opens each document through a 60-second signed link (every view is
 * audited), accepts or rejects it with a reason, and approves the rider once all five pass.
 * Suspended riders go offline at once and cannot come back online.
 */
export class RiderAdminService {
  constructor(
    private readonly deps: {
      access: ConsoleAccess;
      riders: IRiderAdminRepository;
      storage: IKycStorage;
      messages: IMessageSender;
      clock: Clock;
    },
  ) {}

  async list(
    user: SessionUser | null,
    filter: "pending" | "active" | "suspended" | "coaching",
  ): Promise<Result<RiderReview[], AppError>> {
    const allowed = this.deps.access.scope(user);
    if (!allowed.ok) return allowed;
    const riders = await this.deps.riders.riders(allowed.value.scope, filter);
    return ok(riders.map((rider) => ({ ...rider, checklist: checklistOf(rider) })));
  }

  async rider(user: SessionUser | null, riderId: string): Promise<Result<RiderReview, AppError>> {
    const found = await this.load(user, riderId);
    if (!found.ok) return found;
    return ok({ ...found.value.rider, checklist: checklistOf(found.value.rider) });
  }

  /** A link to one document that stops working after 60 seconds; the view is audited. */
  async viewDocument(
    user: SessionUser | null,
    documentId: string,
  ): Promise<Result<{ readonly url: string; readonly expiresAt: Date }, AppError>> {
    const allowed = this.deps.access.scope(user);
    if (!allowed.ok) return allowed;
    const document = await this.deps.riders.document(documentId);
    if (!document) return err(new NotFoundError("Document", documentId));
    const reviewer = this.deps.access.inZone(
      allowed.value.user,
      document.zoneId,
      "Document",
      documentId,
    );
    if (!reviewer.ok) return reviewer;
    const link = await this.deps.storage.signedUrl(document.storagePath, KYC_LINK_SECONDS);
    if (!link.ok) return link;
    await this.deps.access.record(
      reviewer.value,
      "kyc.view",
      { type: "rider_kyc_documents", id: documentId },
      {
        riderId: document.riderId,
        type: document.type,
      },
    );
    return ok({
      url: link.value,
      expiresAt: new Date(this.deps.clock.now().getTime() + KYC_LINK_SECONDS * 1000),
    });
  }

  async reviewDocument(
    user: SessionUser | null,
    documentId: string,
    decision:
      { readonly decision: "approve" } | { readonly decision: "reject"; readonly reason: string },
  ): Promise<Result<{ readonly documentId: string }, AppError>> {
    const allowed = this.deps.access.scope(user);
    if (!allowed.ok) return allowed;
    const document = await this.deps.riders.document(documentId);
    if (!document) return err(new NotFoundError("Document", documentId));
    const reviewer = this.deps.access.inZone(
      allowed.value.user,
      document.zoneId,
      "Document",
      documentId,
    );
    if (!reviewer.ok) return reviewer;
    const reason = decision.decision === "reject" ? decision.reason : null;
    const reviewed = await this.deps.riders.reviewDocument({
      documentId,
      status: decision.decision === "approve" ? "approved" : "rejected",
      reason,
      reviewerId: reviewer.value.id,
    });
    if (!reviewed) return err(new ConflictError("This document was already reviewed."));
    await this.deps.access.record(
      reviewer.value,
      decision.decision === "approve" ? "kyc.approve" : "kyc.reject",
      { type: "rider_kyc_documents", id: documentId },
      { riderId: document.riderId, type: document.type, reason },
    );
    return ok({ documentId });
  }

  /** Approve (all documents accepted), suspend with a reason, or reactivate a suspended rider. */
  async setStatus(
    user: SessionUser | null,
    riderId: string,
    input: { readonly status: "active" | "suspended"; readonly reason?: string | undefined },
  ): Promise<Result<RiderReview, AppError>> {
    const found = await this.load(user, riderId);
    if (!found.ok) return found;
    const { rider, user: reviewer } = found.value;
    if (rider.status === input.status) {
      return err(
        new ConflictError(
          `This rider is already ${input.status === "active" ? "active" : "suspended"}.`,
        ),
      );
    }
    const approving = input.status === "active" && rider.status === "pending_kyc";
    if (approving) {
      const missing = checklistOf(rider).filter((item) => item.state !== "approved");
      if (missing.length > 0) {
        return err(
          new ConflictError(
            `Accept every document first (still to do: ${missing.map((item) => item.type.replace(/_/g, " ")).join(", ")}).`,
          ),
        );
      }
    }
    await this.deps.riders.setStatus(
      riderId,
      input.status,
      input.status === "suspended" ? (input.reason ?? null) : null,
    );
    const action = approving
      ? "rider.approve"
      : input.status === "suspended"
        ? "rider.suspend"
        : "rider.reactivate";
    await this.deps.access.record(
      reviewer,
      action,
      { type: "riders", id: riderId },
      {
        reason: input.reason ?? null,
      },
    );
    if (approving) {
      await this.deps.messages.notify({
        userId: rider.userId,
        template: "rider_approved",
        orderId: null,
        params: {},
      });
    }
    return this.rider(reviewer, riderId);
  }

  private async load(
    user: SessionUser | null,
    riderId: string,
  ): Promise<Result<{ rider: RiderApplication; user: SessionUser }, AppError>> {
    const allowed = this.deps.access.scope(user);
    if (!allowed.ok) return allowed;
    const rider = await this.deps.riders.rider(riderId);
    if (!rider) return err(new NotFoundError("Rider", riderId));
    const reviewer = this.deps.access.inZone(allowed.value.user, rider.zoneId, "Rider", riderId);
    if (!reviewer.ok) return reviewer;
    return ok({ rider, user: reviewer.value });
  }
}
