import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null | undefined;

/** True when the Supabase project URL and public key are configured. */
export function isSupabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

/**
 * The browser's Supabase client, or null if the project is not configured.
 * Only the public (anon) key is ever used here.
 */
export function getSupabase(): SupabaseClient | null {
  if (client !== undefined) return client;
  if (!isSupabaseConfigured()) {
    client = null;
    return client;
  }
  client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  return client;
}
