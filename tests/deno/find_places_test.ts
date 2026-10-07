// "Places near here" (docs/places-plan.md step 5b, step 8 part 2): the straight-line distance, and
// find_places, which sorts the user's own saved places by distance from a point in the user's unit
// (miles by default), counts "near" as 10 miles unless told otherwise, offers the nearest place when
// none is that close, names places without a saved location (never with a distance), and never
// reads a restricted space (rule 3) or someone else's place (rule 5).
import { assert, assertAlmostEquals, assertEquals } from "jsr:@std/assert@1";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { distanceKm, placePoint } from "../../supabase/functions/mcp/lib/places.ts";
import { MAX_WITHOUT_LOCATION, registerFindPlaces } from "../../supabase/functions/mcp/tools/find_places.ts";
import { IDS, World } from "../eval/world.ts";

// ---- distanceKm, placePoint --------------------------------------------------------------------

Deno.test("distanceKm: known distances, symmetric, zero for the same point", () => {
  const paris = { lat: 48.8566, lng: 2.3522 };
  const london = { lat: 51.5074, lng: -0.1278 };
  assertAlmostEquals(distanceKm(paris, london), 343.6, 0.5);
  assertEquals(distanceKm(paris, london), distanceKm(london, paris));
  assertEquals(distanceKm(paris, paris), 0);
  assertAlmostEquals(distanceKm({ lat: 0, lng: 0 }, { lat: 1, lng: 0 }), 111.19, 0.01, "one degree of latitude");
  assertAlmostEquals(distanceKm({ lat: 0, lng: 0 }, { lat: 0, lng: 180 }), 20015.1, 0.1, "half way round");
  assertAlmostEquals(distanceKm({ lat: 10, lng: 179.9 }, { lat: 10, lng: -179.9 }), 21.9, 0.1, "across the date line");
});

Deno.test("placePoint: only a real lat/lng pair counts", () => {
  assertEquals(placePoint({ lat: 33.8959, lng: 35.5249, kind: "restaurant" }), { lat: 33.8959, lng: 35.5249 });
  assertEquals(placePoint({ lat: 0, lng: 0 }), { lat: 0, lng: 0 });
  for (const m of [
    null, undefined, [], "33,35", {}, { lat: 33.9 }, { lng: 35.5 }, { lat: "33.9", lng: "35.5" },
    { lat: 95, lng: 35 }, { lat: 33, lng: 181 }, { lat: NaN, lng: 35 }, { lat: 33, lng: Infinity },
    { address: "Mar Mikhael, Beirut" },
  ]) {
    assertEquals(placePoint(m), null, JSON.stringify(m));
  }
});

// ---- find_places on the pretend account (tests/eval/world.ts) -----------------------------------
// Restaurants: Tawlet (Mar Mikhael), Trattoria Sud (Gemmayze, ~0.8 km away), Café Younes (Hamra,
// ~3.9 km) with locations; Kampai sushi bar with an address only. Private (restricted): Hidden
// courtyard bar, a few metres from Tawlet.

const TAWLET = { lat: 33.8959, lng: 35.5249 };

async function call(db: SupabaseClient, args: Record<string, unknown>, distanceUnit?: "mi" | "km") {
  const server = new McpServer({ name: "test", version: "0" });
  registerFindPlaces(server, { db, userId: "u", accessToken: "t", assistantName: "Wilma", distanceUnit });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  const res = await transport.handleRequest(new Request("http://localhost/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "find_places", arguments: args } }),
  }));
  const out = await res.json();
  if (out.error) return { isError: true, text: String(out.error.message), json: null };
  const text = out.result.content[0].text as string;
  return { isError: !!out.result.isError, text, json: out.result.isError ? null : JSON.parse(text) };
}

const world = () => new World().client();
const titles = (rows: { title: string }[]) => rows.map((r) => r.title);
/** Nothing from the restricted place, in any form: name, id, note, position. */
const assertNoHidden = (text: string) => {
  for (const s of ["Hidden courtyard", IDS.hiddenBar, "Only for us", "35.5251", "33.896,"]) {
    assert(!text.includes(s), `restricted place leaked (${s}): ${text}`);
  }
};

Deno.test("find_places: nearest first, with a distance in miles, from a point the user gave", async () => {
  const out = await call(world(), { ...TAWLET });
  assertEquals(out.isError, false, out.text);
  assertEquals(titles(out.json.results), ["Tawlet", "Trattoria Sud", "Café Younes"]);
  const [tawlet, trattoria, younes] = out.json.results;
  assertEquals([tawlet.distance, tawlet.unit], [0, "mi"]);
  assertAlmostEquals(trattoria.distance, 0.5, 0.1, "about 0.8 km");
  assertAlmostEquals(younes.distance, 2.4, 0.15, "about 3.9 km");
  assertEquals("distance_km" in trattoria, false);
  assertEquals(trattoria.space, "Restaurants");
  assertEquals(trattoria.place.cuisine, ["italian"], "the place's fields come along");
  assertEquals(out.json.from, TAWLET);
  assertEquals(out.json.within, { distance: 10, unit: "mi" }, "near means 10 miles by default");
  assertEquals("nearest_outside" in out.json, false);
  assertEquals(titles(out.json.without_location), ["Kampai sushi bar"], "Kampai has no location: named, not measured");
  assertNoHidden(out.text);
});

Deno.test("find_places: in km for a user who chose km", async () => {
  const out = await call(world(), { ...TAWLET }, "km");
  const [, trattoria, younes] = out.json.results;
  assertEquals(trattoria.unit, "km");
  assertAlmostEquals(trattoria.distance, 0.8, 0.1);
  assertAlmostEquals(younes.distance, 3.9, 0.2);
  assertEquals(out.json.within, { distance: 16.1, unit: "km" }, "the same 10 miles, about 16 km");
});

Deno.test("find_places: nothing within 10 miles gives the nearest one further away", async () => {
  // About 20 miles (32 km) south of Tawlet: further than "near".
  const out = await call(world(), { lat: 33.61, lng: 35.45 });
  assertEquals(out.isError, false, out.text);
  assertEquals(out.json.results, []);
  assertEquals(out.json.nearest_outside.title, "Café Younes");
  assert(out.json.nearest_outside.distance > 10, String(out.json.nearest_outside.distance));
  assertEquals(out.json.nearest_outside.unit, "mi");
  assertEquals(titles(out.json.without_location), ["Kampai sushi bar"], "still named, with no distance");
  assertNoHidden(out.text);
});

Deno.test("find_places: a distance the user named, in their unit or the one they said", async () => {
  const half = await call(world(), { ...TAWLET, within: 1 });
  assertEquals(titles(half.json.results), ["Tawlet", "Trattoria Sud"], "within 1 mile");
  assertEquals(half.json.within, { distance: 1, unit: "mi" });
  const km = await call(world(), { ...TAWLET, within: 1, unit: "km" });
  assertEquals(titles(km.json.results), ["Tawlet", "Trattoria Sud"]);
  assertEquals(km.json.within, { distance: 0.6, unit: "mi" }, "reported in the user's unit");
  const tiny = await call(world(), { ...TAWLET, within: 0.1, unit: "km" });
  assertEquals(titles(tiny.json.results), ["Tawlet"]);
  assertEquals("nearest_outside" in tiny.json, false, "something is within: no offer needed");
});

Deno.test("find_places: restricted spaces stay out completely (rule 3)", async () => {
  // Measured from right next to the restricted place, with every filter that matches it.
  const near = await call(world(), { lat: 33.89601, lng: 35.52508, kind: "bar" });
  assertEquals(near.isError, false, near.text);
  assertEquals(near.json.results, []);
  assertEquals(near.json.without_location, []);
  assertNoHidden(near.text);

  // Naming the restricted space, or a place in it, finds nothing and hints at nothing.
  const inPrivate = await call(world(), { ...TAWLET, space: "Private" });
  assertEquals(inPrivate.isError, false, inPrivate.text);
  assertEquals(inPrivate.json.results, []);
  assertEquals(inPrivate.json.without_location, []);
  assertNoHidden(inPrivate.text);

  const fromHidden = await call(world(), { near_place: "Hidden courtyard bar" });
  assertEquals(fromHidden.isError, true);
  assert(fromHidden.text.includes("No saved place"), fromHidden.text);
  const byId = await call(world(), { near_place: IDS.hiddenBar });
  assertEquals(byId.isError, true);
  assert(!byId.text.includes("35.5251") && !byId.text.includes("Only for us"), byId.text);
});

Deno.test("find_places: from a saved place, which is left out of its own list", async () => {
  const out = await call(world(), { near_place: "tawlet", within_km: 2 });
  assertEquals(out.isError, false, out.text);
  assertEquals(out.json.from, { place: "Tawlet", id: IDS.tawlet });
  assertEquals(titles(out.json.results), ["Trattoria Sud"], "Café Younes is further than 2 km (the older within_km)");
  assertNoHidden(out.text);
});

Deno.test("find_places: a place without a location never gets a distance", async () => {
  const listed = await call(world(), { ...TAWLET });
  assertEquals(listed.isError, false, listed.text);
  assertEquals(listed.json.without_location.length, 1);
  const kampai = listed.json.without_location[0];
  assertEquals([kampai.title, kampai.address], ["Kampai sushi bar", "Badaro, Beirut"]);
  assertEquals(Object.keys(kampai).sort(), ["address", "id", "space", "title"], "no distance, no position");
  assertEquals(titles(listed.json.results).includes("Kampai sushi bar"), false);

  // As the starting point: refused, with its address, and no made-up position.
  const from = await call(world(), { near_place: "Kampai" });
  assertEquals(from.isError, true);
  assert(from.text.includes("no saved location") && from.text.includes("Badaro, Beirut"), from.text);
  assert(!/"distance"|\d\s*(?:km|mi)\b/.test(from.text), from.text);

  // Not even a stored position that is not a real pair of numbers.
  const w = new World();
  w.items.find((i) => i.id === IDS.trattoria)!.metadata.lat = "33.89";
  const odd = await call(w.client(), { ...TAWLET });
  assertEquals(titles(odd.json.results), ["Tawlet", "Café Younes"]);
  assertEquals(titles(odd.json.without_location).sort(), ["Kampai sushi bar", "Trattoria Sud"]);
});

Deno.test("find_places: filters are read the way places are stored", async () => {
  const italian = await call(world(), { ...TAWLET, cuisine: "Italian", occasion: "Date night" });
  assertEquals(titles(italian.json.results), ["Trattoria Sud"]);
  const cafe = await call(world(), { ...TAWLET, kind: "Café", status: "been" });
  assertEquals(titles(cafe.json.results), ["Café Younes"]);
  const want = await call(world(), { ...TAWLET, status: "want" });
  assertEquals(titles(want.json.results), []);
  assertEquals(titles(want.json.without_location), ["Kampai sushi bar"]);
  const limited = await call(world(), { ...TAWLET, limit: 1 });
  assertEquals(titles(limited.json.results), ["Tawlet"]);
  const bad = await call(world(), { ...TAWLET, occasion: "romantic" });
  assertEquals(bad.isError, true);
  assert(bad.text.includes("Filter not understood") && bad.text.includes("occasions must come from"), bad.text);
});

Deno.test("find_places: exactly one starting point; coordinates are never guessed", async () => {
  for (const args of [{}, { lat: 33.9 }, { lng: 35.5 }, { ...TAWLET, near_place: "Tawlet" }, { space: "Restaurants" }]) {
    const out = await call(world(), args);
    assertEquals(out.isError, true, JSON.stringify(args));
  }
  const none = await call(world(), {});
  assert(none.text.includes("Never guess coordinates"), none.text);
  const outOfRange = await call(world(), { lat: 95, lng: 35 });
  assertEquals(outOfRange.isError, true);
});

Deno.test("find_places: only the user's own, searchable spaces are read, and checked again", async () => {
  // A database stand-in that ignores the space filter and hands back everything it has: a place
  // in a restricted space and a place in someone else's space (an item shared with the user).
  const OPEN = "00000000-0000-4000-8000-00000000aa01";
  const LOCKED = "00000000-0000-4000-8000-00000000aa02";
  const THEIRS = "00000000-0000-4000-8000-00000000aa03";
  const sent: { in?: [string, unknown[]]; eq: [string, unknown][]; is: [string, unknown][] } = { eq: [], is: [] };
  const rows = [
    { id: "p1", title: "Mine", space_id: OPEN, metadata: { status: "want", lat: 33.9, lng: 35.5 }, updated_at: "t" },
    { id: "p2", title: "Locked away", space_id: LOCKED, metadata: { status: "want", lat: 33.9, lng: 35.5 }, updated_at: "t" },
    { id: "p3", title: "Someone else's", space_id: THEIRS, metadata: { status: "want", lat: 33.9, lng: 35.5 }, updated_at: "t" },
  ];
  const query = {
    select: () => query,
    eq: (c: string, v: unknown) => (sent.eq.push([c, v]), query),
    is: (c: string, v: unknown) => (sent.is.push([c, v]), query),
    in: (c: string, v: unknown[]) => ((sent.in = [c, v]), query),
    order: () => query,
    limit: () => Promise.resolve({ data: rows, error: null }),
  };
  const db = {
    from: (table: string) => table === "space"
      ? {
        select: () => Promise.resolve({
          data: [
            { id: OPEN, name: "Restaurants", description: null, parent_id: null, is_restricted: false },
            { id: LOCKED, name: "Private", description: null, parent_id: null, is_restricted: true },
          ],
          error: null,
        }),
      }
      : query,
    rpc: (name: string) =>
      Promise.resolve(name === "searchable_space_ids" ? { data: [OPEN, THEIRS], error: null } : { data: null, error: { message: name } }),
  } as unknown as SupabaseClient;

  const out = await call(db, { lat: 33.9, lng: 35.5 });
  assertEquals(out.isError, false, out.text);
  assertEquals(titles(out.json.results), ["Mine"]);
  assertEquals(sent.in, ["space_id", [OPEN]], "only the user's own searchable spaces are asked for");
  assertEquals(sent.eq, [["item_type", "place"]]);
  assertEquals(sent.is, [["deleted_at", null]]);
  assert(!out.text.includes("Locked away") && !out.text.includes("Someone else"), out.text);
});

Deno.test("find_places: no searchable spaces means no query and no results", async () => {
  const w = new World();
  for (const s of w.spaces) s.is_restricted = true;
  const out = await call(w.client(), { ...TAWLET });
  assertEquals(out.isError, false, out.text);
  assertEquals(out.json.results, []);
  assertEquals(out.json.without_location, []);
});

Deno.test("find_places: at most 10 places without a location are named, and the rest counted", async () => {
  const w = new World();
  const kampai = w.items.find((i) => i.id === IDS.sushiBar)!;
  for (let n = 0; n < 12; n++) {
    w.items.push({ ...structuredClone(kampai), id: `00000000-0000-4000-8000-0000000c${String(n).padStart(4, "0")}`, title: `Unlocated ${n}` });
  }
  const out = await call(w.client(), { ...TAWLET });
  assertEquals(out.json.without_location.length, MAX_WITHOUT_LOCATION);
  assertEquals(out.json.without_location_more, 13 - MAX_WITHOUT_LOCATION);
});
