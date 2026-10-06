// Places (docs/places-plan.md): the server checks a place's fields, adds them to search, keeps
// visits newest first, and still refuses credentials in any of them (rule 9).
import { assert, assertEquals, assertThrows } from "jsr:@std/assert@1";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  addVisit, isMapsLink, normalizePlace, PlaceError, placeText, withPlace,
} from "../../supabase/functions/mcp/lib/places.ts";
import { registerSaveItem } from "../../supabase/functions/mcp/tools/save_item.ts";
import { registerUpdateItem } from "../../supabase/functions/mcp/tools/update_item.ts";
import { registerSearchItems } from "../../supabase/functions/mcp/tools/search_items.ts";

const TODAY = new Date("2026-10-06T12:00:00Z");

// ---- normalizePlace ----------------------------------------------------------------------------

Deno.test("a place with only a name is 'want to go'", () => {
  assertEquals(normalizePlace({}, TODAY), { status: "want" });
  assertEquals(normalizePlace(undefined, TODAY), { status: "want" });
});

Deno.test("fields are tidied: kinds, occasions, cuisine, dishes", () => {
  const p = normalizePlace({
    address: "  Armenia St,   Mar Mikhael ",
    kind: "Café",
    cuisine: ["Lebanese", "lebanese", " Mezze "],
    occasions: ["Date night", "quick-lunch"],
    dishes_liked: "Fattoush, Kibbeh nayeh",
    price_level: "2",
  }, TODAY);
  assertEquals(p, {
    status: "want",
    address: "Armenia St, Mar Mikhael",
    kind: "cafe",
    cuisine: ["lebanese", "mezze"],
    occasions: ["date_night", "quick_lunch"],
    dishes_liked: ["fattoush", "kibbeh nayeh"],
    price_level: 2,
  });
  assertEquals(normalizePlace({ kind: "to visit" }, TODAY).kind, "to-visit");
});

Deno.test("a rating or a visit makes it 'been'; the latest visit sets visited_on", () => {
  assertEquals(normalizePlace({ rating: 4 }, TODAY), { status: "been", rating: 4 });
  const p = normalizePlace({
    visits: [{ on: "2026-03-01", with: "Sam" }, { on: "2026-09-20", note: "anniversary" }],
    visited_on: "2026-05-01",
  }, TODAY);
  assertEquals(p.status, "been");
  assertEquals(p.visited_on, "2026-09-20");
  assertEquals(p.visits?.map((v) => v.on), ["2026-09-20", "2026-03-01"]);
});

Deno.test("wrong fields are refused with a reason the model can act on", () => {
  const bad: [Record<string, unknown>, RegExp][] = [
    [{ phone: "123" }, /unknown place field "phone"/],
    [{ kind: "nightclub" }, /kind must be one of/],
    [{ status: "maybe" }, /status must be/],
    [{ status: "want", rating: 4 }, /has status "been"/],
    [{ rating: 6 }, /rating must be a whole number from 1 to 5/],
    [{ rating: 4.5 }, /whole number/],
    [{ price_level: 0 }, /price_level/],
    [{ occasions: ["romantic"] }, /occasions must come from/],
    [{ visited_on: "12/10/2026" }, /date like/],
    [{ visited_on: "2026-02-30" }, /not a real date/],
    [{ visited_on: "2027-01-01" }, /in the future/],
    [{ visits: [{ with: "Sam" }] }, /must have a date/],
    [{ visits: [{ on: "2026-09-01", price: 40 }] }, /unknown field "price"/],
    [{ lat: 33.9 }, /lat and lng go together/],
    [{ lat: 95, lng: 35 }, /lat must be/],
    [{ would_return: "yes" }, /true or false/],
    [{ address: "x".repeat(301) }, /longer than 300/],
    [{ cuisine: Array.from({ length: 11 }, (_, i) => `c${i}`) }, /more than 10/],
    [{ visits: Array.from({ length: 51 }, () => ({ on: "2026-01-01" })) }, /more than 50/],
    [{ google_place_id: "abc def" }, /unexpected characters/],
  ];
  for (const [m, re] of bad) {
    const e = assertThrows(() => normalizePlace(m, TODAY), PlaceError);
    assert(re.test(e.message), `${JSON.stringify(m)}: ${e.message}`);
    assert(e.message.startsWith("Place not saved:"));
  }
});

Deno.test("only Google Maps and geo: links are accepted", () => {
  for (const ok of [
    "https://maps.app.goo.gl/AbC123",
    "https://goo.gl/maps/xyz",
    "https://www.google.com/maps/place/Tawlet/@33.89,35.52,17z",
    "https://google.com/maps/search/?api=1&query=Tawlet",
    "https://maps.google.com/?q=Tawlet",
    "https://www.google.co.uk/maps/place/X",
    "https://maps.google.com.lb/?q=x",
    "geo:33.8938,35.5018",
    "geo:33.8938,35.5018?q=Tawlet",
  ]) assert(isMapsLink(ok), ok);
  for (const bad of [
    "http://maps.app.goo.gl/AbC123",
    "https://goo.gl/abc",
    "https://www.google.com/search?q=tawlet",
    "https://maps.google.com.evil.example/?q=x",
    "https://evil.example/maps.app.goo.gl",
    "https://user:pw@maps.app.goo.gl/x",
    "https://maps.app.goo.gl:8443/x",
    "javascript:alert(1)",
    "geo:somewhere",
    "intent://maps",
  ]) assert(!isMapsLink(bad), bad);
  assertThrows(() => normalizePlace({ maps_url: "https://tripadvisor.com/x" }, TODAY), PlaceError, "Google Maps link");
});

Deno.test("addVisit puts the visit first, keeps the other fields, and can set the rating", () => {
  const before = { kind: "restaurant", status: "want", cuisine: ["italian"], visits: [{ on: "2026-05-01" }] };
  const p = addVisit(before, { on: "2026-10-03", with: "Sarah", note: "anniversary", rating: 5 }, TODAY);
  assertEquals(p.status, "been");
  assertEquals(p.rating, 5);
  assertEquals(p.cuisine, ["italian"]);
  assertEquals(p.visited_on, "2026-10-03");
  assertEquals(p.visits, [{ on: "2026-10-03", with: "Sarah", note: "anniversary" }, { on: "2026-05-01" }]);
  const full = { visits: Array.from({ length: 50 }, () => ({ on: "2026-01-01" })) };
  assertEquals(addVisit(full, { on: "2026-10-01" }, TODAY).visits?.length, 50);
});

Deno.test("placeText reads like a sentence list, for meaning search", () => {
  const t = placeText(normalizePlace({
    kind: "restaurant", address: "Mar Mikhael", cuisine: ["lebanese"], price_level: 2, rating: 5,
    would_return: true, dishes_liked: ["fattoush"], occasions: ["date_night", "kids"],
    visits: [{ on: "2026-09-20", with: "Sarah", note: "anniversary" }],
  }, TODAY));
  assertEquals(t.split("\n"), [
    "Kind: restaurant",
    "Address: Mar Mikhael",
    "Cuisine: lebanese",
    "Price: $$",
    "Been there, rated 5/5",
    "Would go back",
    "Dishes liked: fattoush",
    "Good for: date night, with kids",
    "Visit 2026-09-20 with Sarah: anniversary",
  ]);
  assertEquals(withPlace("Try it.", null), "Try it.");
  assertEquals(withPlace("", normalizePlace({}, TODAY)), "Want to go");
});

// ---- Through the tools -------------------------------------------------------------------------

const g = globalThis as Record<string, unknown>;
g.Supabase ??= { ai: { Session: class { run() { return Promise.resolve(new Array(384).fill(0.05)); } } } };
g.EdgeRuntime ??= { waitUntil: (p: Promise<unknown>) => void p.catch(() => {}) };

const SPACE = "22222222-2222-4222-8222-222222222222";
const ITEM = "11111111-1111-4111-8111-111111111111";

function fakeDb(current?: Record<string, unknown>) {
  const rpcs: { name: string; params: Record<string, unknown> }[] = [];
  const db = {
    from: () => ({
      select: () => Promise.resolve({ data: [{ id: SPACE, name: "Restaurants", description: null, parent_id: null, is_restricted: false }], error: null }),
    }),
    rpc: (name: string, params: Record<string, unknown>) => {
      rpcs.push({ name, params });
      if (name === "get_item") return Promise.resolve({ data: current ?? null, error: null });
      if (name === "save_item") return Promise.resolve({ data: ITEM, error: null });
      if (name === "search_items") {
        return Promise.resolve({
          data: [
            { item_id: ITEM, title: "Tawlet", item_type: "place", space_id: SPACE, snippet: "s", tags: [], updated_at: "t", place: { status: "want" } },
            { item_id: SPACE, title: "Soup", item_type: "recipe", space_id: SPACE, snippet: "s", tags: [], updated_at: "t", place: null },
          ],
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    },
  } as unknown as SupabaseClient;
  return { db, rpcs };
}

async function call(db: SupabaseClient, name: string, args: Record<string, unknown>) {
  const server = new McpServer({ name: "test", version: "0" });
  const ctx = { db, userId: "u", accessToken: "t", assistantName: "Wilma" };
  for (const r of [registerSaveItem, registerUpdateItem, registerSearchItems]) r(server, ctx);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  const res = await transport.handleRequest(new Request("http://localhost/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  }));
  const out = await res.json();
  return { isError: !!out.result.isError, text: out.result.content[0].text as string };
}

const chunkText = (params: Record<string, unknown>) =>
  (params.p_chunks as { content: string }[]).map((c) => c.content).join("\n");

Deno.test("save_item stores a checked place and makes its fields searchable", async () => {
  const { db, rpcs } = fakeDb();
  const out = await call(db, "save_item", {
    space: "Restaurants", title: "Tawlet", body: "Try the fattoush.", item_type: "Place",
    metadata: { address: "Mar Mikhael, Beirut", kind: "Restaurant", cuisine: ["Lebanese"], occasions: ["date night"] },
  });
  assertEquals(out.isError, false, out.text);
  const save = rpcs.find((r) => r.name === "save_item")!;
  assertEquals(save.params.p_metadata, {
    status: "want", address: "Mar Mikhael, Beirut", kind: "restaurant", cuisine: ["lebanese"], occasions: ["date_night"],
  });
  assertEquals(save.params.p_body, "Try the fattoush.", "the note's own text is unchanged");
  const text = chunkText(save.params);
  assert(text.includes("Address: Mar Mikhael, Beirut") && text.includes("Good for: date night"), text);
});

Deno.test("save_item refuses a bad place before anything is written", async () => {
  const { db, rpcs } = fakeDb();
  const out = await call(db, "save_item", {
    space: "Restaurants", title: "Tawlet", body: "", item_type: "place",
    metadata: { maps_url: "https://evil.example/maps", kind: "restaurant" },
  });
  assertEquals(out.isError, true);
  assert(out.text.includes("Google Maps link"), out.text);
  assertEquals(rpcs.filter((r) => r.name === "save_item").length, 0);
});

Deno.test("save_item: other item types keep their metadata as before", async () => {
  const { db, rpcs } = fakeDb();
  const out = await call(db, "save_item", {
    space: "Restaurants", title: "Note", body: "Hi", item_type: "note", metadata: { anything: 1 },
  });
  assertEquals(out.isError, false, out.text);
  assertEquals(rpcs.find((r) => r.name === "save_item")!.params.p_metadata, { anything: 1 });
});

Deno.test("a door code in a place visit note is refused and pointed to the vault (rule 9)", async () => {
  const { db, rpcs } = fakeDb();
  const out = await call(db, "save_item", {
    space: "Restaurants", title: "Chalet", body: "", item_type: "place",
    metadata: { kind: "hotel", visits: [{ on: "2026-09-01", note: "the door code is 4821" }] },
  });
  assertEquals(out.isError, true);
  assert(/vault/i.test(out.text), out.text);
  assertEquals(rpcs.filter((r) => r.name === "save_item").length, 0);

  const current = { title: "Tawlet", summary: null, body_markdown: "", item_type: "place", metadata: { status: "want" } };
  const { db: db2, rpcs: rpcs2 } = fakeDb(current);
  const up = await call(db2, "update_item", { item_id: ITEM, add_visit: { on: "2026-10-01", note: "wifi password is Sunflower2024!" } });
  assertEquals(up.isError, true);
  assert(/vault/i.test(up.text), up.text);
  assertEquals(rpcs2.filter((r) => r.name === "update_item").length, 0);
});

Deno.test("update_item add_visit keeps the place's fields, adds the visit and re-indexes", async () => {
  const current = {
    title: "Tawlet", summary: null, body_markdown: "Try the fattoush.", item_type: "place",
    metadata: { status: "want", kind: "restaurant", cuisine: ["lebanese"] },
  };
  const { db, rpcs } = fakeDb(current);
  const today = new Date().toISOString().slice(0, 10);
  const out = await call(db, "update_item", { item_id: ITEM, add_visit: { on: today, with: "Sarah", rating: 5 } });
  assertEquals(out.isError, false, out.text);
  const up = rpcs.find((r) => r.name === "update_item")!;
  assertEquals(up.params.p_metadata, {
    status: "been", rating: 5, visited_on: today, kind: "restaurant", cuisine: ["lebanese"], visits: [{ on: today, with: "Sarah" }],
  });
  assertEquals(up.params.p_body, null, "the text is not touched");
  assert(chunkText(up.params).includes(`Visit ${today} with Sarah`));
  assertEquals(JSON.parse(out.text).place.status, "been");
});

Deno.test("update_item checks new place metadata, and refuses add_visit on other types", async () => {
  const place = { title: "Tawlet", summary: null, body_markdown: "", item_type: "place", metadata: {} };
  const { db, rpcs } = fakeDb(place);
  const bad = await call(db, "update_item", { item_id: ITEM, metadata: { rating: 9 } });
  assertEquals(bad.isError, true);
  assert(bad.text.includes("rating"), bad.text);
  assertEquals(rpcs.filter((r) => r.name === "update_item").length, 0);

  const note = { title: "Note", summary: null, body_markdown: "", item_type: "note", metadata: {} };
  const { db: db2 } = fakeDb(note);
  const visit = await call(db2, "update_item", { item_id: ITEM, add_visit: { on: "2026-10-01" } });
  assertEquals(visit.isError, true);
  assert(visit.text.includes("only for places"), visit.text);
});

Deno.test("update_item: a note becoming a place gets its metadata checked", async () => {
  const note = { title: "Tawlet", summary: null, body_markdown: "", item_type: "note", metadata: { address: "Beirut" } };
  const { db, rpcs } = fakeDb(note);
  const out = await call(db, "update_item", { item_id: ITEM, item_type: "place" });
  assertEquals(out.isError, false, out.text);
  assertEquals(rpcs.find((r) => r.name === "update_item")!.params.p_metadata, { status: "want", address: "Beirut" });
});

Deno.test("update_item: a text edit on a place with old, unchecked fields still works", async () => {
  const legacy = { title: "Old place", summary: null, body_markdown: "x", item_type: "place", metadata: { phone: "123" } };
  const { db, rpcs } = fakeDb(legacy);
  const out = await call(db, "update_item", { item_id: ITEM, body: "new text" });
  assertEquals(out.isError, false, out.text);
  const up = rpcs.find((r) => r.name === "update_item")!;
  assertEquals(up.params.p_metadata, null, "metadata untouched");
  assertEquals(chunkText(up.params), "Old place\n\nnew text");
});

Deno.test("search_items returns a place's fields, and none for other items", async () => {
  const { db } = fakeDb();
  const out = await call(db, "search_items", { item_type: "place" });
  const results = JSON.parse(out.text).results;
  assertEquals(results[0].place, { status: "want" });
  assertEquals("place" in results[1], false);
});
