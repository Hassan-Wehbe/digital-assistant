// Supabase client that acts as the signed-in user: every query carries the
// user's access token, so Row Level Security applies (CLAUDE.md rule 5).
// The service-role key is never used here.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export function supabaseUrl(): string {
  const url = Deno.env.get("SUPABASE_URL");
  if (!url) throw new Error("SUPABASE_URL is not set");
  return url.replace(/\/$/, "");
}

function publishableKey(): string {
  const legacy = Deno.env.get("SUPABASE_ANON_KEY");
  if (legacy) return legacy;
  const keys = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") ?? "{}");
  if (typeof keys.default === "string") return keys.default;
  throw new Error("no publishable (anon) key is available");
}

export function userClient(accessToken: string): SupabaseClient {
  return createClient(supabaseUrl(), publishableKey(), {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/** Returns the user id if the token is a valid, unexpired session for this project. */
export async function verifyAccessToken(accessToken: string): Promise<string | null> {
  const { data, error } = await userClient(accessToken).auth.getUser(accessToken);
  if (error || !data.user) return null;
  return data.user.id;
}
