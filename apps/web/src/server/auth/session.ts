import "server-only";
import type { SessionUser } from "@klikgo/core";
import { cache } from "react";
import { getContainer } from "../container";
import { assuranceLevelOf } from "./access-token";
import { supabaseSettings } from "../supabase/config";
import { createSupabaseServerClient } from "../supabase/server-client";

/**
 * The signed-in user for this request, or null. Identity is verified by Supabase Auth
 * (getUser on the cookie's token, not the unverified cookie contents); roles come from user_roles in the database, never from the
 * browser or JWT claims. Cached per request.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  if (!supabaseSettings()) return null;
  const supabase = await createSupabaseServerClient();
  // Only the raw token is read from the cookie session; getUser(token) then verifies that exact
  // token with Supabase Auth (revoked sessions fail), so its aal claim can be trusted.
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return null;
  const { data, error } = await supabase.auth.getUser(session.access_token);
  if (error || !data.user) return null;
  const roles = await getContainer().userRoles.rolesFor(data.user.id);
  const phone = data.user.phone ? `+${data.user.phone.replace(/^\+/, "")}` : null;
  return {
    id: data.user.id,
    phone,
    email: data.user.email ?? null,
    roles,
    aal: assuranceLevelOf(session.access_token),
  };
});
