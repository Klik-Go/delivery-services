import "server-only";
import { supabaseSettings } from "../supabase/config";
import { createSupabaseServerClient } from "../supabase/server-client";
import { getSessionUser } from "./session";

/** What the browser needs to listen on private Realtime channels (never to call Auth). */
export interface RealtimeAccess {
  readonly url: string;
  readonly anonKey: string;
  readonly accessToken: string;
  /** Unix seconds; the client asks again shortly before. */
  readonly expiresAt: number | null;
}

/**
 * The signed-in person's current access token for Supabase Realtime. Realtime checks the token
 * itself and the realtime.messages policies decide which topics it may hear; the browser still
 * reads and writes everything else through the BFF.
 */
export async function realtimeAccess(): Promise<RealtimeAccess | null> {
  const settings = supabaseSettings();
  if (!settings || !(await getSessionUser())) return null;
  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return null;
  return {
    url: settings.url,
    anonKey: settings.anonKey,
    accessToken: session.access_token,
    expiresAt: session.expires_at ?? null,
  };
}
