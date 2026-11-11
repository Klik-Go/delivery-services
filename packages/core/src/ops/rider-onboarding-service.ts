import type { KycDocumentType, VehicleType } from "@klikgo/types";
import type { SessionUser } from "../auth/session-user";
import type { Logger } from "../ports/logger";
import {
  ConflictError,
  ForbiddenError,
  UnauthorizedError,
  ValidationError,
  type AppError,
} from "../shared/errors";
import { err, ok, type Result } from "../shared/result";
import { checklistOf, type RiderReview } from "./rider-admin-service";
import type { IKycStorage, IRiderOnboardingRepository } from "./ports";

const EXTENSIONS: Readonly<Record<string, string>> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

/**
 * Applying to ride (docs/BUSINESS.md Appendix B): a signed-in person picks their zone and
 * vehicle, then uploads the five documents from the rider app. Files go to the private rider-kyc
 * bucket through the server; a rejected document can be uploaded again until the rider is approved.
 */
export class RiderOnboardingService {
  constructor(
    private readonly deps: {
      onboarding: IRiderOnboardingRepository;
      storage: IKycStorage;
      logger: Logger;
      newId?: () => string;
    },
  ) {}

  async apply(
    user: SessionUser | null,
    input: {
      readonly zoneId: string;
      readonly vehicleType: VehicleType;
      readonly plateNo?: string | undefined;
      readonly fullName: string;
      readonly payoutAccountName: string;
    },
  ): Promise<Result<{ readonly riderId: string }, AppError>> {
    if (!user) return err(new UnauthorizedError());
    if (!(await this.deps.onboarding.zoneExists(input.zoneId))) {
      return err(
        new ValidationError("Choose one of Klik Go's zones.", [
          { path: "zoneId", message: "Unknown zone" },
        ]),
      );
    }
    const riderId = await this.deps.onboarding.apply({
      userId: user.id,
      zoneId: input.zoneId,
      vehicleType: input.vehicleType,
      plateNo: input.plateNo ?? null,
      fullName: input.fullName,
      payoutAccountName: input.payoutAccountName,
    });
    if (!riderId) return err(new ConflictError("You have already applied to ride."));
    this.deps.logger.info("rider.applied", { riderId, zoneId: input.zoneId });
    return ok({ riderId });
  }

  async status(user: SessionUser | null): Promise<Result<RiderReview | null, AppError>> {
    if (!user) return err(new UnauthorizedError());
    const rider = await this.deps.onboarding.riderForUser(user.id);
    return ok(rider ? { ...rider, checklist: checklistOf(rider) } : null);
  }

  async upload(
    user: SessionUser | null,
    type: KycDocumentType,
    file: { readonly bytes: Uint8Array; readonly contentType: string },
  ): Promise<Result<{ readonly documentId: string }, AppError>> {
    if (!user) return err(new UnauthorizedError());
    const rider = await this.deps.onboarding.riderForUser(user.id);
    if (!rider) return err(new ForbiddenError("Apply to ride first."));
    if (rider.status !== "pending_kyc") {
      return err(
        new ConflictError(
          "Your documents were already reviewed. Contact your coordinator to change them.",
        ),
      );
    }
    const current = rider.documents.find((doc) => doc.type === type);
    if (current && current.status !== "rejected") {
      return err(new ConflictError("This document is already uploaded and waiting for review."));
    }
    const id = this.deps.newId?.() ?? globalThis.crypto.randomUUID();
    const path = `${rider.id}/${type}-${id}.${EXTENSIONS[file.contentType] ?? "jpg"}`;
    const stored = await this.deps.storage.upload(path, file);
    if (!stored.ok) return stored;
    const documentId = await this.deps.onboarding.addDocument({
      riderId: rider.id,
      type,
      storagePath: path,
    });
    return ok({ documentId });
  }
}
