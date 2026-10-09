// Delete my account: the handler is in handler.ts; this wires it to Supabase.
// The service-role key (set by Supabase in every Edge Function) is used here only, for the
// caller's own id, after their sign-in and password are checked (CLAUDE.md rule 5).
import { createClient } from "@supabase/supabase-js";
import { anonClient, supabaseUrl, userClient } from "../mcp/lib/db.ts";
import { createHandler } from "./handler.ts";

const BUCKET = "attachments";
const NO_SESSION = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };

function serviceKey(): string {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
  if (typeof keys.default === "string") return keys.default;
  throw new Error("no service key is available");
}

const admin = () => createClient(supabaseUrl(), serviceKey(), { auth: NO_SESSION });

Deno.serve(createHandler({
  async verifyToken(token) {
    const { data, error } = await userClient(token).auth.getUser(token);
    if (error || !data.user?.email) return null;
    return { id: data.user.id, email: data.user.email };
  },
  async checkPassword(email, password) {
    // A throwaway client: the session it gets is never kept, and the account is about to go.
    const { error } = await anonClient().auth.signInWithPassword({ email, password });
    return !error;
  },
  async listFiles(userId) {
    // Files are kept as <user>/<attachment>/<file>.
    const storage = admin().storage.from(BUCKET);
    const paths: string[] = [];
    const list = async (prefix: string) => {
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await storage.list(prefix, { limit: 1000, offset });
        if (error) throw error;
        for (const entry of data ?? []) {
          const path = `${prefix}/${entry.name}`;
          // Folders have no id in a listing.
          if (entry.id) paths.push(path);
          else await list(path);
        }
        if ((data?.length ?? 0) < 1000) return;
      }
    };
    await list(userId);
    return paths;
  },
  async removeFiles(paths) {
    const { error } = await admin().storage.from(BUCKET).remove(paths);
    if (error) throw error;
  },
  async deleteUser(userId) {
    const { error } = await admin().auth.admin.deleteUser(userId);
    if (error) throw error;
  },
  log: (entry) => console.log(JSON.stringify(entry)),
}));
