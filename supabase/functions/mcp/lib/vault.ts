// Vault helpers for the MCP tools. The server only ever handles secret
// metadata and short-lived links; values are typed and read on the vault
// pages (docs/vault/), encrypted in the owner's browser (CLAUDE.md rule 1).
// Nothing here selects payload_enc (users are not granted it anyway).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Space } from "./spaces.ts";

export const SECRET_TYPES = ["login", "api_key", "wifi", "recovery_codes", "note"] as const;

/** Where the vault pages are served (GitHub Pages); override with VAULT_PAGE_URL. */
export function vaultPageUrl(): string {
  const url = Deno.env.get("VAULT_PAGE_URL") ?? "https://hassan-wehbe.github.io/digital-assistant/vault";
  return url.replace(/\/$/, "");
}

// The token goes in the fragment (#t=...), which browsers never send to a server.
export const entryLink = (token: string) => `${vaultPageUrl()}/enter#t=${token}`;
export const revealLink = (token: string) => `${vaultPageUrl()}/reveal#t=${token}`;
export const setupLink = () => `${vaultPageUrl()}/setup`;

export const NEVER_VALUES =
  "Never ask the user to type a password, key or code into the chat, and never accept one: " +
  "the value is typed and shown only on the vault page.";

export const SECRET_COLUMNS = "id, name, url, secret_type, space_id, created_at, updated_at, last_accessed_at";

export interface SecretMeta {
  id: string;
  name: string;
  url: string | null;
  secret_type: string;
  space: string | undefined;
  space_restricted: boolean;
  created_at: string;
  updated_at: string;
  last_accessed_at: string | null;
}

/** Shape a secret row (from the table or find_secrets) for a tool result. */
export function describeSecret(row: Record<string, unknown>, spaces: Space[]): SecretMeta {
  const space = spaces.find((s) => s.id === row.space_id);
  return {
    id: (row.id ?? row.secret_id) as string,
    name: row.name as string,
    url: (row.url as string | null) ?? null,
    secret_type: row.secret_type as string,
    space: space?.path,
    space_restricted: space?.is_restricted ?? false,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
    last_accessed_at: (row.last_accessed_at as string | null) ?? null,
  };
}

export async function requireVault(db: SupabaseClient): Promise<void> {
  const { data, error } = await db.rpc("vault_status");
  if (error) throw new Error(`Could not check the vault: ${error.message}`);
  if (!data?.set_up) {
    throw new Error(
      `The user's vault is not set up yet. Ask them to open ${setupLink()} once (it takes a minute: ` +
        "they choose an unlock passphrase and save a recovery key), then try again.",
    );
  }
}

/** Load one secret's metadata by id. Works in restricted spaces too (as get_item does). */
export async function secretById(db: SupabaseClient, id: string): Promise<Record<string, unknown>> {
  const { data, error } = await db.from("secret").select(SECRET_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new Error(`Could not load the secret: ${error.message}`);
  if (!data) throw new Error("Secret not found. Use find_secret to look it up by name.");
  return data;
}
