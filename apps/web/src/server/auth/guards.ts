import "server-only";
import {
  ForbiddenError,
  UnauthorizedError,
  type Action,
  type SessionUser,
  type Surface,
} from "@klikgo/core";
import { forbidden, redirect } from "next/navigation";
import { getContainer } from "../container";
import { safeNextPath } from "../http/safe-next";
import { getSessionUser } from "./session";

const STAFF_SURFACES: readonly Surface[] = ["merchant", "admin"];

/**
 * Layout guard for a surface (route group). Not signed in → sign-in page; staff without the second
 * factor → /auth/mfa; wrong role → 403 (forbidden()). Returns the user when allowed.
 */
export async function requireSurface(surface: Surface, path: string): Promise<SessionUser> {
  const user = await getSessionUser();
  const decision = getContainer().authz.decide(user, { type: "surface.open", surface });
  if (decision.allowed && user) return user;
  const next = encodeURIComponent(safeNextPath(path));
  if (!decision.allowed && decision.reason === "unauthenticated") {
    redirect(
      STAFF_SURFACES.includes(surface) ? `/auth/staff?next=${next}` : `/auth/sign-in?next=${next}`,
    );
  }
  if (!decision.allowed && decision.reason === "mfa_required") redirect(`/auth/mfa?next=${next}`);
  forbidden();
}

/** API guard: the signed-in user, or the AppError to return (401/403). */
export async function requireUser(): Promise<
  { ok: true; value: SessionUser } | { ok: false; error: UnauthorizedError }
> {
  const user = await getSessionUser();
  return user ? { ok: true, value: user } : { ok: false, error: new UnauthorizedError() };
}

/** API guard for an action, mapping refusals to 401 (sign in) or 403 (role / second factor). */
export async function requireAction(
  action: Action,
): Promise<
  { ok: true; value: SessionUser } | { ok: false; error: UnauthorizedError | ForbiddenError }
> {
  const user = await getSessionUser();
  const decision = getContainer().authz.decide(user, action);
  if (decision.allowed && user) return { ok: true, value: user };
  if (!decision.allowed && decision.reason === "unauthenticated")
    return { ok: false, error: new UnauthorizedError() };
  return {
    ok: false,
    error: new ForbiddenError(
      !decision.allowed && decision.reason === "mfa_required"
        ? "Verify your authenticator code first."
        : undefined,
    ),
  };
}
