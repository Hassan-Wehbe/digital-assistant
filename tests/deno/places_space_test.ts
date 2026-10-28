// The Places space through the tools (docs/places-space-plan.md step 2, D45): a place is kept in
// Places, a plain note in Places is a place, the new kinds, cuisine and price only for somewhere to
// eat or drink; restricted and shared spaces keep their places (rules 3, D32).
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { eateryFieldsOnly, normalizePlace, placeTarget } from "../../supabase/functions/mcp/lib/places.ts";
import type { Space } from "../../supabase/functions/mcp/lib/spaces.ts";
import { registerSaveItem } from "../../supabase/functions/mcp/tools/save_item.ts";
import { registerUpdateItem } from "../../supabase/functions/mcp/tools/update_item.ts";

const g = globalThis as Record<string, unknown>;
g.Supabase ??= { ai: { Session: class { run() { return Promise.resolve(new Array(384).fill(0.05)); } } } };
g.EdgeRuntime ??= { waitUntil: (p: Promise<unknown>) => void p.catch(() => {}) };

const PLACES = "00000000-0000-4000-8000-0000000000b1";
const KIDS = "00000000-0000-4000-8000-0000000000b2";
const RESTAURANTS = "00000000-0000-4000-8000-0000000000b3";
const WORK = "00000000-0000-4000-8000-0000000000b4";
const PRIVATE = "00000000-0000-4000-8000-0000000000b5";
const PLACES_LUNCH = "00000000-0000-4000-8000-0000000000b6";
const ITEM = "11111111-1111-4111-8111-111111111111";

const row = (id: string, name: string, parent_id: string | null = null, extra: Record<string, unknown> = {}) =>
  ({ id, name, description: null, parent_id, is_restricted: false, built_in: null, ...extra });

const SPACES = [
  row(PLACES, "Places", null, { built_in: "places" }),
  row(KIDS, "Kids", PLACES),
  row(PLACES_LUNCH, "Lunch", PLACES),
  row(RESTAURANTS, "Restaurants"),
  row(WORK, "Work"),
  row(PRIVATE, "Private", null, { is_restricted: true }),
];

function fakeDb(opts: { current?: Record<string, unknown>; spaces?: Record<string, unknown>[] } = {}) {
  const rpcs: { name: string; params: Record<string, unknown> }[] = [];
  const chain = (data: unknown[]) => {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is", "in", "limit"]) q[m] = () => q;
    q.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data, error: null }).then(ok);
    return q;
  };
  const db = {
    from: (table: string) => chain(table === "space" ? (opts.spaces ?? SPACES) : []),
    rpc: (name: string, params: Record<string, unknown>) => {
      rpcs.push({ name, params });
      if (name === "get_item") return Promise.resolve({ data: opts.current ?? null, error: null });
      if (name === "save_item") return Promise.resolve({ data: ITEM, error: null });
      if (name === "shared_with_me") return Promise.resolve({ data: [], error: null });
      return Promise.resolve({ data: null, error: null });
    },
  } as unknown as SupabaseClient;
  return { db, rpcs, saved: () => rpcs.find((r) => r.name === "save_item")?.params, updated: () => rpcs.find((r) => r.name === "update_item")?.params };
}

async function call(db: SupabaseClient, name: string, args: Record<string, unknown>) {
  const server = new McpServer({ name: "test", version: "0" });
  const ctx = { db, userId: "u", accessToken: "t", assistantName: "Wilma" };
  for (const r of [registerSaveItem, registerUpdateItem]) r(server, ctx);
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

// ---- Kinds and eatery-only fields ---------------------------------------------------------------

Deno.test("the new kinds, and everyday words for them", () => {
  for (const k of ["park", "library", "sports", "school", "health"]) assertEquals(normalizePlace({ kind: k }).kind, k);
  assertEquals(normalizePlace({ kind: "Swimming pool" }).kind, "sports");
  assertEquals(normalizePlace({ kind: "gym" }).kind, "sports");
  assertEquals(normalizePlace({ kind: "dentist" }).kind, "health");
  assertEquals(normalizePlace({ kind: "playground" }).kind, "park");
});

Deno.test("cuisine, price and dishes only for a restaurant, cafe or bar (or a place with no kind yet)", () => {
  const all = { cuisine: ["lebanese"], price_level: 2, dishes_liked: ["fattoush"], rating: 4 };
  for (const kind of ["restaurant", "cafe", "bar", undefined]) {
    const { place, dropped } = eateryFieldsOnly(normalizePlace({ ...all, kind }));
    assertEquals(dropped, []);
    assertEquals(place.price_level, 2);
  }
  const { place, dropped } = eateryFieldsOnly(normalizePlace({ ...all, kind: "library" }));
  assertEquals(dropped, ["cuisine", "price_level", "dishes_liked"]);
  assertEquals([place.cuisine, place.price_level, place.dishes_liked, place.rating], [undefined, undefined, undefined, 4]);
});

Deno.test("placeTarget: Places, its sub-spaces, restricted and shared spaces", () => {
  const spaces = SPACES.map((s) => ({ ...s, path: s.parent_id ? `Places/${s.name}` : s.name })) as Space[];
  const by = (id: string) => spaces.find((s) => s.id === id)!;
  assertEquals(placeTarget(spaces, undefined), { space: by(PLACES), redirected: false });
  assertEquals(placeTarget(spaces, by(KIDS)), { space: by(KIDS), redirected: false });
  assertEquals(placeTarget(spaces, by(PRIVATE)), { space: by(PRIVATE), redirected: false });
  assertEquals(placeTarget(spaces, by(WORK)), { space: by(PLACES), redirected: true });
  const lunch = { ...row("00000000-0000-4000-8000-0000000000c1", "Lunch"), path: "Lunch" } as Space;
  assertEquals(placeTarget([...spaces, lunch], lunch), { space: by(PLACES_LUNCH), redirected: true });
  const shared = { ...row("00000000-0000-4000-8000-0000000000c2", "Family"), path: "Family (shared by Sam)", shared: { share_id: "s", from: "Sam", permission: "edit" } } as Space;
  assertEquals(placeTarget([...spaces, shared], shared), { space: shared, redirected: false });
  // No Places space (an older database): the space asked for, as before.
  const old = spaces.filter((s) => s.id !== PLACES);
  assertEquals(placeTarget(old, by(WORK)), { space: by(WORK), redirected: false });
});

// ---- save_item ----------------------------------------------------------------------------------

Deno.test("save_item: a place with no space goes to Places", async () => {
  const { db, saved } = fakeDb();
  const out = await call(db, "save_item", { title: "Coral Gables library", body: "", item_type: "place", metadata: { kind: "library" } });
  assert(!out.isError, out.text);
  assertEquals(saved()!.p_space_id, PLACES);
  assertEquals(JSON.parse(out.text).space, "Places");
});

Deno.test("save_item: a place asked for in Restaurants goes to Places, and the reply says so", async () => {
  const { db, saved } = fakeDb();
  const out = await call(db, "save_item", { space: "Restaurants", title: "Tawlet", body: "", item_type: "place", metadata: { kind: "restaurant" } });
  assert(!out.isError, out.text);
  assertEquals(saved()!.p_space_id, PLACES);
  assertStringIncludes(JSON.parse(out.text).places, "Places are kept in Places");
});

Deno.test("save_item: a sub-space of Places, a same-named one, and a restricted space are kept", async () => {
  for (const [space, want] of [["Places/Kids", KIDS], ["Kids", KIDS], ["Private", PRIVATE]] as const) {
    const { db, saved } = fakeDb();
    const out = await call(db, "save_item", { space, title: "Pool", body: "", item_type: "place", metadata: { kind: "sports" } });
    assert(!out.isError, out.text);
    assertEquals(saved()!.p_space_id, want, space);
  }
});

Deno.test("save_item: a plain note in Places is kept as a place of kind other", async () => {
  const { db, saved } = fakeDb();
  const out = await call(db, "save_item", { space: "Places", title: "The library on Main St", body: "Open till 8", item_type: "note" });
  assert(!out.isError, out.text);
  assertEquals(saved()!.p_item_type, "place");
  assertEquals((saved()!.p_metadata as Record<string, unknown>).kind, "other");
  assertStringIncludes(JSON.parse(out.text).saved_as, "every note in Places is a place");
});

Deno.test("save_item: a recipe or a task in Places is refused, not turned into a place", async () => {
  for (const item_type of ["recipe", "task"]) {
    const { db, saved } = fakeDb();
    const out = await call(db, "save_item", { space: "Places", title: "Soup", body: "x", item_type });
    assert(out.isError, item_type);
    assertStringIncludes(out.text, "Places holds only places");
    assertEquals(saved(), undefined);
  }
});

Deno.test("save_item: a library's cuisine and price are not kept, and the reply says so", async () => {
  const { db, saved } = fakeDb();
  const out = await call(db, "save_item", {
    title: "Library", body: "", item_type: "place", metadata: { kind: "library", cuisine: ["cafe food"], price_level: 1 },
  });
  assert(!out.isError, out.text);
  const m = saved()!.p_metadata as Record<string, unknown>;
  assertEquals([m.cuisine, m.price_level], [undefined, undefined]);
  assertStringIncludes(JSON.parse(out.text).place_fields, "not kept: cuisine, price_level");
});

Deno.test("save_item: without a Places space a place still needs a space (an older database)", async () => {
  const { db } = fakeDb({ spaces: SPACES.filter((s) => s.id !== PLACES && s.parent_id !== PLACES) });
  const out = await call(db, "save_item", { title: "Tawlet", body: "", item_type: "place" });
  assert(out.isError);
  assertStringIncludes(out.text, "Say which space");
  const ok = fakeDb({ spaces: SPACES.filter((s) => s.id !== PLACES && s.parent_id !== PLACES) });
  const out2 = await call(ok.db, "save_item", { space: "Restaurants", title: "Tawlet", body: "", item_type: "place" });
  assert(!out2.isError, out2.text);
  assertEquals(ok.saved()!.p_space_id, RESTAURANTS);
});

// ---- update_item --------------------------------------------------------------------------------

const current = (item_type: string, space: string, metadata: Record<string, unknown> = {}) => ({
  title: "Tawlet", summary: null, body_markdown: "", item_type, metadata, access: "owner", space: { id: space },
});

Deno.test("update_item: a place can't move out of Places; into a sub-space or a restricted space it can", async () => {
  const out = await call(fakeDb({ current: current("place", PLACES) }).db, "update_item", { item_id: ITEM, space: "Work" });
  assert(out.isError);
  assertStringIncludes(out.text, "A place is kept in Places");
  for (const [space, want] of [["Places/Kids", KIDS], ["Private", PRIVATE]] as const) {
    const w = fakeDb({ current: current("place", PLACES) });
    const res = await call(w.db, "update_item", { item_id: ITEM, space });
    assert(!res.isError, res.text);
    assertEquals(w.updated()!.p_space_id, want);
  }
});

Deno.test("update_item: a note made a place moves into Places", async () => {
  const w = fakeDb({ current: current("note", WORK) });
  const out = await call(w.db, "update_item", { item_id: ITEM, item_type: "place", metadata: { kind: "park" } });
  assert(!out.isError, out.text);
  assertEquals(w.updated()!.p_space_id, PLACES);
  assertEquals(JSON.parse(out.text).space, "Places");
});

Deno.test("update_item: a plain note moved into Places becomes a place; a place there can't become a plain note", async () => {
  const w = fakeDb({ current: current("note", WORK, { anything: 1 }) });
  const out = await call(w.db, "update_item", { item_id: ITEM, space: "Places" });
  assert(!out.isError, out.text);
  assertEquals(w.updated()!.p_item_type, "place");
  assertEquals((w.updated()!.p_metadata as Record<string, unknown>).kind, "other");

  const back = await call(fakeDb({ current: current("place", PLACES) }).db, "update_item", { item_id: ITEM, item_type: "note" });
  assert(back.isError);
  assertStringIncludes(back.text, "Every note in Places is a place");
  // Made a plain note and moved out together: fine.
  const both = fakeDb({ current: current("place", PLACES) });
  const ok = await call(both.db, "update_item", { item_id: ITEM, item_type: "note", space: "Work" });
  assert(!ok.isError, ok.text);
  assertEquals(both.updated()!.p_space_id, WORK);
});

Deno.test("update_item: text-only edits and a place in a restricted space stay where they are", async () => {
  const w = fakeDb({ current: current("place", RESTAURANTS, { kind: "restaurant" }) });
  const out = await call(w.db, "update_item", { item_id: ITEM, body: "Try the fattoush" });
  assert(!out.isError, out.text);
  assertEquals(w.updated()!.p_space_id, null);
  const r = fakeDb({ current: current("note", PRIVATE) });
  const out2 = await call(r.db, "update_item", { item_id: ITEM, item_type: "place" });
  assert(!out2.isError, out2.text);
  assertEquals(r.updated()!.p_space_id, null);
});
