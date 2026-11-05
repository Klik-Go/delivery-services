import type {
  ApproveApplicationInput,
  MerchantApplicationInput,
  MerchantApplicationStatus,
} from "@klikgo/types";
import type { AuthorizationService } from "../auth/authorization-service";
import { authorize } from "../auth/authorize";
import { inviteExpiry, invitePathFor } from "../auth/invite-service";
import { normalizePhilippineMobile } from "../auth/phone";
import type { IRateLimiter, IStaffAccountGateway, RateLimitRule } from "../auth/ports";
import type { SessionUser } from "../auth/session-user";
import type { Clock } from "../ports/clock";
import type { Logger } from "../ports/logger";
import { ConflictError, NotFoundError, RateLimitedError, type AppError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";
import { foundingPeriodEnd } from "./commission";
import type { IMerchantApplicationRepository, IZoneLocator, MerchantApplication } from "./ports";
import { slugify } from "./slug";

/** The public partner form: at most 5 applications per network per hour. */
export const APPLICATIONS_PER_IP: RateLimitRule = { limit: 5, windowSeconds: 3600 };

/** What the applicant is told after submitting. */
export interface ApplicationReceipt {
  readonly applicationId: string | null;
  /** False when no zone covers the pin ("We're not in your area yet"). */
  readonly inArea: boolean;
  readonly zoneName: string | null;
}

/** What an admin gets back after approving. */
export interface ApprovedMerchant {
  readonly merchantId: string;
  readonly slug: string;
  readonly invitePath: string;
}

/**
 * Partner applications → admin review → a live store with an invited owner (docs/BUSINESS.md
 * §5.4, Appendix A). Owns the application lifecycle only; menus and settings live elsewhere.
 */
export class MerchantOnboardingService {
  constructor(
    private readonly deps: {
      applications: IMerchantApplicationRepository;
      zones: IZoneLocator;
      accounts: IStaffAccountGateway;
      rateLimiter: IRateLimiter;
      authz: AuthorizationService;
      clock: Clock;
      logger: Logger;
    },
  ) {}

  /** Records an application from the public partner page. */
  async apply(
    input: MerchantApplicationInput,
    context: { readonly clientIp: string },
  ): Promise<Result<ApplicationReceipt, AppError>> {
    const limit = await this.deps.rateLimiter.hit(
      `partner-apply:ip:${context.clientIp}`,
      APPLICATIONS_PER_IP,
    );
    if (!limit.allowed) {
      return err(
        new RateLimitedError(
          "Too many applications from this network. Please try again later.",
          limit.retryAfterSeconds,
        ),
      );
    }
    if (input.website) {
      // Honeypot filled in: answer like a success so bots learn nothing, but store nothing.
      this.deps.logger.warn("merchant.application_honeypot", { clientIp: context.clientIp });
      return ok({ applicationId: null, inArea: true, zoneName: null });
    }
    const phone = normalizePhilippineMobile(input.phone);
    if (!phone.ok) return phone;

    const zone = await this.deps.zones.zoneAt(input.location);
    const { id } = await this.deps.applications.create({
      businessName: input.businessName,
      ownerName: input.ownerName,
      phone: phone.value,
      email: input.email.trim().toLowerCase(),
      category: input.category,
      barangay: input.barangay,
      city: input.city,
      addressLine: input.addressLine || null,
      location: input.location,
      zoneId: zone?.id ?? null,
    });
    this.deps.logger.info("merchant.application_received", {
      applicationId: id,
      zoneId: zone?.id ?? null,
    });
    return ok({ applicationId: id, inArea: zone !== null, zoneName: zone?.name ?? null });
  }

  /** Applications for reviewers: admins see every zone, coordinators their own. */
  async listApplications(
    user: SessionUser | null,
    status: MerchantApplicationStatus = "pending",
  ): Promise<Result<MerchantApplication[], AppError>> {
    const allowed = authorize(this.deps.authz, user, { type: "merchant.applications.view" });
    if (!allowed.ok) return allowed;
    const isAdmin = allowed.value.roles.some((grant) => grant.role === "admin");
    return ok(
      await this.deps.applications.list({
        status,
        zoneIds: isAdmin ? null : this.deps.authz.zoneIdsOf(allowed.value),
      }),
    );
  }

  /**
   * Approves an application: creates the owner's staff account, then (in one transaction) the
   * store, the owner role and the invite. Returns the invite link for the admin to share.
   */
  async approve(
    user: SessionUser | null,
    applicationId: string,
    terms: ApproveApplicationInput,
  ): Promise<Result<ApprovedMerchant, AppError>> {
    const allowed = authorize(this.deps.authz, user, { type: "merchant.applications.review" });
    if (!allowed.ok) return allowed;
    const application = await this.deps.applications.findById(applicationId);
    if (!application) return err(new NotFoundError("Application", applicationId));
    if (application.status !== "pending")
      return err(new ConflictError("This application was already reviewed."));
    if (!application.zoneId) {
      return err(
        new ConflictError(
          "We're not in this store's area yet. Add a zone that covers its pin before approving.",
        ),
      );
    }

    const account = await this.deps.accounts.createInvite(application.email);
    if (!account.ok) return account;
    const now = this.deps.clock.now();
    const approved = await this.deps.applications.approve({
      applicationId,
      reviewerId: allowed.value.id,
      ownerId: account.value.userId,
      slug: slugify(application.businessName),
      commissionBps: terms.commissionBps,
      foundingCommissionUntil: terms.foundingPartner ? foundingPeriodEnd(now) : null,
      invite: {
        email: application.email,
        tokenHash: account.value.tokenHash,
        expiresAt: inviteExpiry(now),
      },
    });
    if (!approved) return err(new ConflictError("This application was already reviewed."));
    this.deps.logger.info("merchant.application_approved", {
      applicationId,
      merchantId: approved.merchantId,
      reviewerId: allowed.value.id,
    });
    return ok({ ...approved, invitePath: invitePathFor(account.value.tokenHash) });
  }

  /** Rejects a pending application with a reason the team can read later. */
  async reject(
    user: SessionUser | null,
    applicationId: string,
    reason: string,
  ): Promise<Result<void, AppError>> {
    const allowed = authorize(this.deps.authz, user, { type: "merchant.applications.review" });
    if (!allowed.ok) return allowed;
    const application = await this.deps.applications.findById(applicationId);
    if (!application) return err(new NotFoundError("Application", applicationId));
    if (!(await this.deps.applications.reject(applicationId, allowed.value.id, reason)))
      return err(new ConflictError("This application was already reviewed."));
    this.deps.logger.info("merchant.application_rejected", {
      applicationId,
      reviewerId: allowed.value.id,
    });
    return ok(undefined);
  }
}
