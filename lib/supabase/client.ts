import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let browserClient: SupabaseClient | null = null;
const defaultUrl = "https://lpfoxpqezcfdvdecfdos.supabase.co";
// The publishable key is safe to ship to browsers. Environment variables take
// precedence, while this fallback keeps self-hosted deployments operational.
const defaultPublishableKey = "sb_publishable_tET9MkiH1_6ZqAuF4XtOuA_9qRfkaQA";

export function isSupabaseConfigured() {
  return Boolean(
    (process.env.NEXT_PUBLIC_SUPABASE_URL || defaultUrl) &&
    (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || defaultPublishableKey)
  );
}

export function getSupabaseBrowserClient() {
  if (browserClient) return browserClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || defaultUrl;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || defaultPublishableKey;
  if (!url || !key) throw new Error("Supabase ainda não configurado.");
  browserClient = createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  return browserClient;
}
