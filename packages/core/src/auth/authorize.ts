import { ForbiddenError, UnauthorizedError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";
import type { Action, AuthorizationService } from "./authorization-service";
import type { SessionUser } from "./session-user";

/**
 * Service-side authorization (defence in depth behind the route guards): the user when allowed,
 * otherwise 401 (not signed in) or 403 (wrong role, wrong store, or second factor missing).
 */
export function authorize(
  authz: AuthorizationService,
  user: SessionUser | null,
  action: Action,
): Result<SessionUser, UnauthorizedError | ForbiddenError> {
  const decision = authz.decide(user, action);
  if (decision.allowed && user) return ok(user);
  if (!decision.allowed && decision.reason === "unauthenticated")
    return err(new UnauthorizedError());
  if (!decision.allowed && decision.reason === "mfa_required")
    return err(new ForbiddenError("Verify your authenticator code first."));
  return err(new ForbiddenError());
}
