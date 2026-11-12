import type { AppRole } from "@klikgo/types";
import type { Action, AuthorizationService } from "../auth/authorization-service";
import type { SessionUser } from "../auth/session-user";
import { ForbiddenError, NotFoundError, UnauthorizedError, type AppError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";
import type { AuditEntry, IAuditLog, ZoneScope } from "./ports";

/** The role a console user acts in: admin when they are one, otherwise coordinator. */
export function actingRole(user: SessionUser): AppRole {
  return user.roles.some((grant) => grant.role === "admin") ? "admin" : "coordinator";
}

/** Shared checks for the console services: who may open it, which zones, and the audit trail. */
export class ConsoleAccess {
  constructor(
    private readonly authz: AuthorizationService,
    private readonly audit: IAuditLog,
  ) {}

  /** Zones this person runs; refused unless they may open the console (admin/coordinator + TOTP). */
  scope(user: SessionUser | null): Result<{ user: SessionUser; scope: ZoneScope }, AppError> {
    const decision = this.authz.decide(user, { type: "surface.open", surface: "admin" });
    if (!user) return err(new UnauthorizedError());
    if (!decision.allowed) {
      return err(
        decision.reason === "mfa_required"
          ? new ForbiddenError("Verify with your authenticator app to open the console.")
          : new ForbiddenError(),
      );
    }
    const scope = this.authz.can(user, { type: "ops.platform" })
      ? "all"
      : this.authz.zoneIdsOf(user);
    return ok({ user, scope });
  }

  /** Something in a zone this person does not run reads as missing, so ids cannot be probed. */
  inZone(
    user: SessionUser | null,
    zoneId: string,
    what: string,
    id: string,
  ): Result<SessionUser, AppError> {
    if (!user) return err(new UnauthorizedError());
    if (!this.authz.can(user, { type: "ops.zone", zoneId }))
      return err(new NotFoundError(what, id));
    return ok(user);
  }

  /** Admin-only actions (platform settings, zones, stores, staff). */
  platform(user: SessionUser | null): Result<SessionUser, AppError> {
    return this.require(user, { type: "ops.platform" });
  }

  require(user: SessionUser | null, action: Action): Result<SessionUser, AppError> {
    if (!user) return err(new UnauthorizedError());
    const decision = this.authz.decide(user, action);
    if (decision.allowed) return ok(user);
    return err(
      decision.reason === "mfa_required"
        ? new ForbiddenError("Verify with your authenticator app first.")
        : new ForbiddenError(),
    );
  }

  /** Writes the audit row for a change that already happened. */
  record(
    user: SessionUser,
    action: string,
    entity: { readonly type: string; readonly id: string | null },
    meta: AuditEntry["meta"] = {},
  ): Promise<void> {
    return this.audit.record({
      actorId: user.id,
      actorRole: actingRole(user),
      action,
      entityType: entity.type,
      entityId: entity.id,
      meta,
    });
  }
}

/** True when the zone is inside the scope. */
export function inScope(scope: ZoneScope, zoneId: string): boolean {
  return scope === "all" || scope.includes(zoneId);
}
