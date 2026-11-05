import "server-only";
import { AppError } from "@klikgo/core";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { supabaseSettings } from "./config";

/**
 * Supabase client acting for the current request's browser session (cookies). Route handlers can
 * write cookies; Server Components cannot, which is fine because the proxy already refreshed them.
 */
export async function createSupabaseServerClient(): Promise<SupabaseClient> {
  const settings = supabaseSettings();
  if (!settings) throw new AppError("INTERNAL", "Sign-in is not configured.");
  const store = await cookies();
  return createServerClient(settings.url, settings.anonKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (cookiesToSet) => {
        try {
          for (const { name, value, options } of cookiesToSet) store.set(name, value, options);
        } catch {
          // Called from a Server Component: cookies are read-only there; the proxy refreshes them.
        }
      },
    },
  });
}
