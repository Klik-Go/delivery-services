import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getServerEnv } from "../env";

let admin: SupabaseClient | null | undefined;

/**
 * Service-role client (bypasses RLS). Server-only: used by the composition root for privileged
 * account operations such as staff invites. Null when SUPABASE_SERVICE_ROLE_KEY is not set.
 */
export function supabaseAdminClient(): SupabaseClient | null {
  if (admin !== undefined) return admin;
  const env = getServerEnv();
  admin =
    env.NEXT_PUBLIC_SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY
      ? createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
          auth: { persistSession: false, autoRefreshToken: false },
        })
      : null;
  return admin;
}
