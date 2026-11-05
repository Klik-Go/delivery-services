import { getServerEnv } from "../env";

/** Supabase connection settings, or null when Supabase is not configured (e.g. unit tests). */
export function supabaseSettings(): { url: string; anonKey: string } | null {
  const env = getServerEnv();
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return null;
  return { url: env.NEXT_PUBLIC_SUPABASE_URL, anonKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY };
}
