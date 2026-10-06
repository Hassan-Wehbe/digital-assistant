// Public configuration, the same values as docs/oauth/config.js on the web pages.
// The publishable key is designed to be public (it ships in every Supabase client
// app); by itself it grants nothing beyond what Row Level Security allows. The
// service-role key and any AI key must never appear in the app (CLAUDE.md rule 6).
export const SUPABASE_URL = 'https://motvckmpusxiuelpwqxy.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_fUOMLFoWl6Avh7NqvhKBNQ_swuHkZGd';

/** Wilma's tools: the existing MCP server (supabase/functions/mcp/). */
export const MCP_URL = `${SUPABASE_URL}/functions/v1/mcp`;

/** Chat with Wilma: the `chat` function (supabase/functions/chat/), streamed answers. */
export const CHAT_URL = `${SUPABASE_URL}/functions/v1/chat`;

/** The web vault pages (setup until the app can set up the vault itself). */
export const VAULT_PAGES_URL = 'https://hassan-wehbe.github.io/digital-assistant/vault';

/** "Version 0.1.0 (build 1)" for the about line; either part may be missing. */
export function versionLabel(version?: string | null, build?: string | number | null): string {
  if (!version) return 'Version unknown';
  return build ? `Version ${version} (build ${build})` : `Version ${version}`;
}

/**
 * Dictation in the message boxes (A5e). False until the mic button exists (step 3), so the
 * speech package can be built and started on a phone first without any screen using it.
 */
export const VOICE_ENABLED = false;
