// One-off, owner-run: fill in the locations of places saved from a Google Maps link before the
// server did this on save (docs/places-plan.md step 8, Q15). Delete this function after the run.
//
//   POST /functions/v1/place-locations            dry run: counts only, no request, no write
//   POST /functions/v1/place-locations {"apply": true}   opens each short link once and saves
//
// Admin only: the caller must send the project's service-role (secret) key, which the owner does
// from the Supabase dashboard (Edge Functions -> place-locations -> Test, role "service role"), so
// the key never passes through chat. No user request reaches this function, so it reads with the
// service role; each write is checked against the row it read (same id and space, so the same
// owner, and not edited since) and carries only that row's own metadata plus the point
// (CLAUDE.md rule 5). Item history is kept by the item_before_update trigger (rule 7). Logs and
// the answer hold counts only.
import { createClient } from "@supabase/supabase-js";
import { backfillPlaceLocations, type BackfillStore, type PlaceRow } from "./backfill.ts";

function adminKeys(): string[] {
  const keys = [Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""];
  try {
    keys.push(...Object.values(JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}")).map(String));
  } catch {
    // not set
  }
  return keys.filter((k) => k.length > 20);
}

async function digest(s: string): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(h), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The presented key equals one of the project's admin keys (compared by hash, not by prefix). */
async function isAdmin(req: Request): Promise<string | null> {
  const presented = req.headers.get("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1] ?? req.headers.get("apikey") ?? "";
  if (!presented) return null;
  const mine = await digest(presented);
  for (const key of adminKeys()) if ((await digest(key)) === mine) return key;
  return null;
}

function store(key: string): BackfillStore {
  const url = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/$/, "");
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return {
    async listPlaces() {
      const { data, error } = await db
        .from("item")
        .select("id, space_id, updated_at, metadata, space!inner(owner_user_id)")
        .eq("item_type", "place")
        .is("deleted_at", null);
      if (error) throw new Error("list_failed");
      return (data ?? []).map((r: Record<string, unknown>): PlaceRow => ({
        id: r.id as string,
        space_id: r.space_id as string,
        updated_at: r.updated_at as string,
        owner_user_id: (r.space as { owner_user_id: string }).owner_user_id,
        metadata: r.metadata as Record<string, unknown> | null,
      }));
    },
    async saveLocation(row, metadata) {
      const { data, error } = await db
        .from("item")
        .update({ metadata })
        .eq("id", row.id)
        .eq("space_id", row.space_id)
        .eq("updated_at", row.updated_at)
        .eq("item_type", "place")
        .is("deleted_at", null)
        .is("metadata->lat", null)
        .is("metadata->lng", null)
        .select("id");
      if (error) throw new Error("update_failed");
      return (data ?? []).length === 1;
    },
  };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return Response.json({ error: "POST only" }, { status: 405 });
  const key = await isAdmin(req);
  if (!key) return Response.json({ error: "admin only" }, { status: 401 });
  let apply = false;
  try {
    apply = (await req.json())?.apply === true;
  } catch {
    // no body: a dry run
  }
  try {
    const counts = await backfillPlaceLocations(store(key), { apply });
    console.log(JSON.stringify({ event: "place_locations", ...counts }));
    return Response.json(counts);
  } catch (err) {
    const code = err instanceof Error && /^[a-z_]+$/.test(err.message) ? err.message : "failed";
    console.error(JSON.stringify({ event: "place_locations", error: code }));
    return Response.json({ error: code }, { status: 500 });
  }
});
