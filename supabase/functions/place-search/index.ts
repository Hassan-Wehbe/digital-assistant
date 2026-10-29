// Find a place by name: the handler is in handler.ts; this wires it to Supabase and Google.
// Every database read and write runs as the signed-in caller (CLAUDE.md rule 5): their own usage
// rows only. The Google key is the Supabase secret GOOGLE_PLACES_API_KEY (the owner sets it; until
// then the app is told the search is not set up and offers the address box).
import { userClient, verifyAccessToken } from "../mcp/lib/db.ts";
import { type AutocompleteRequest, createHandler } from "./handler.ts";

const AUTOCOMPLETE = "https://places.googleapis.com/v1/places:autocomplete";
/** Google's widest bias circle, 50 km: suggestions near the user first, never only near them. */
const BIAS_METERS = 50_000;

async function autocomplete(key: string, req: AutocompleteRequest): Promise<unknown> {
  const res = await fetch(AUTOCOMPLETE, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      input: req.text,
      sessionToken: req.session,
      ...(req.near
        ? { locationBias: { circle: { center: { latitude: req.near.lat, longitude: req.near.lng }, radius: BIAS_METERS } } }
        : {}),
    }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) {
    await res.body?.cancel();
    throw new Error(`google ${res.status}`);
  }
  return await res.json();
}

Deno.serve(createHandler({
  verifyToken: verifyAccessToken,
  apiKey: () => Deno.env.get("GOOGLE_PLACES_API_KEY")?.trim() || undefined,
  async usedToday(token) {
    const today = new Date().toISOString().slice(0, 10);
    const { data, error } = await userClient(token)
      .from("usage_day")
      .select("count")
      .eq("day", today)
      .eq("kind", "google_places")
      .eq("detail", "autocomplete");
    if (error) throw new Error(error.code ?? "usage");
    return (data ?? []).reduce((n, r) => n + (Number((r as { count: unknown }).count) || 0), 0);
  },
  async record(token, rows) {
    // As _shared/usage.ts recordRows: the caller's own rows, checked again by record_usage().
    const { error } = await userClient(token).rpc("record_usage", { p_rows: rows });
    if (error) console.log(JSON.stringify({ event: "place_search_usage", ok: false, code: `db:${error.code ?? "error"}` }));
  },
  autocomplete,
  log: (entry) => console.log(JSON.stringify(entry)),
}));
