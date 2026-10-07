// Coordinates from a Google Maps link (docs/places-plan.md step 8, Q15): read only from a long
// link (or geo: link) that carries them, never by a request. Short share links are not followed
// (tried live 2026-10-07: they gave a location about 800 miles off; owner's decision (b)).
import { assert, assertEquals } from "jsr:@std/assert@1";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { coordinatesInLink, withLinkLocation } from "../../supabase/functions/mcp/lib/maps_link.ts";
import { registerSaveItem } from "../../supabase/functions/mcp/tools/save_item.ts";
import { registerUpdateItem } from "../../supabase/functions/mcp/tools/update_item.ts";

const SHORT = "https://maps.app.goo.gl/AbCdEf123";
const PIN_URL =
  "https://www.google.com/maps/place/Hinode+Sushi/@28.6701,-81.2101,17z/data=!3m1!4b1!4m6!3m5!1s0x88e77b:0x1!8m2!3d28.6703351!4d-81.2092371!16s%2Fg%2F11";
const VIEW_URL = "https://www.google.com/maps/place/Hinode+Sushi/@28.6701,-81.2101,17z?entry=tts";

Deno.test("coordinates are read from a long link: the pin first, else the map's centre", () => {
  assertEquals(coordinatesInLink(PIN_URL), { lat: 28.670335, lng: -81.209237 });
  assertEquals(coordinatesInLink(VIEW_URL), { lat: 28.6701, lng: -81.2101 });
  assertEquals(coordinatesInLink("geo:33.8938,35.5018?q=Tawlet"), { lat: 33.8938, lng: 35.5018 });
  assertEquals(coordinatesInLink("https://www.google.com/maps/place/x/data=%213d33.9%214d35.5"), { lat: 33.9, lng: 35.5 });
  assertEquals(coordinatesInLink(SHORT), null);
  assertEquals(coordinatesInLink("https://maps.google.com/?q=Tawlet"), null);
  // Out of range, or not a Maps link: nothing.
  assertEquals(coordinatesInLink("https://www.google.com/maps/@95.1,35.5,17z"), null);
  assertEquals(coordinatesInLink("https://www.google.com/maps/data=!3d33.9!4d185.2"), null);
  assertEquals(coordinatesInLink("https://evil.example/maps/@33.9,35.5,17z"), null);
});

Deno.test("withLinkLocation fills from a long link, never replaces a location, ignores short links", () => {
  assertEquals(withLinkLocation({ status: "want", maps_url: PIN_URL }), {
    place: { status: "want", maps_url: PIN_URL, lat: 28.670335, lng: -81.209237 }, filled: true,
  });
  const kept = { status: "want" as const, maps_url: PIN_URL, lat: 1.5, lng: 2.5 };
  assertEquals(withLinkLocation(kept), { place: kept, filled: false });
  assertEquals(withLinkLocation({ status: "want", maps_url: SHORT }).filled, false);
  assertEquals(withLinkLocation({ status: "want" }).filled, false);
});

// ---- Through save_item and update_item: no request, ever -----------------------------------

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
      return Promise.resolve({ data: null, error: null });
    },
  } as unknown as SupabaseClient;
  return { db, rpcs };
}

/** Calls a tool with every fetch recorded and every console method watched. */
async function call(db: SupabaseClient, name: string, args: Record<string, unknown>) {
  const requested: string[] = [];
  const logged: unknown[][] = [];
  const realFetch = globalThis.fetch;
  const methods = ["log", "info", "warn", "error", "debug"] as const;
  const real = methods.map((m) => console[m]);
  globalThis.fetch = ((input: string | URL | Request) => {
    requested.push(String(input));
    return Promise.reject(new TypeError("no network in this test"));
  }) as typeof fetch;
  for (const m of methods) console[m] = (...a: unknown[]) => void logged.push(a);
  try {
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
    return { isError: !!out.result.isError, text: out.result.content[0].text as string, requested, logged };
  } finally {
    globalThis.fetch = realFetch;
    methods.forEach((m, i) => console[m] = real[i]);
  }
}

const savePlace = (metadata: Record<string, unknown>) =>
  ({ space: "Restaurants", title: "Hinode Sushi", body: "", item_type: "place", metadata });

Deno.test("save_item: a long link with coordinates gives the location, with no request and no log", async () => {
  const { db, rpcs } = fakeDb();
  const out = await call(db, "save_item", savePlace({ maps_url: PIN_URL, kind: "restaurant" }));
  assertEquals(out.isError, false, out.text);
  assertEquals(rpcs.find((r) => r.name === "save_item")!.params.p_metadata, {
    status: "want", maps_url: PIN_URL, kind: "restaurant", lat: 28.670335, lng: -81.209237,
  });
  assertEquals(JSON.parse(out.text).location, "read from the Google Maps link");
  assertEquals(out.requested, []);
  assertEquals(out.logged, []);
});

Deno.test("save_item: a short share link is kept as it is and never opened", async () => {
  const { db, rpcs } = fakeDb();
  const out = await call(db, "save_item", savePlace({ maps_url: SHORT }));
  assertEquals(out.isError, false, out.text);
  assertEquals(rpcs.find((r) => r.name === "save_item")!.params.p_metadata, { status: "want", maps_url: SHORT });
  assertEquals("location" in JSON.parse(out.text), false);
  assertEquals(out.requested, []);
  assertEquals(out.logged, []);
});

Deno.test("save_item: a location the user set is kept", async () => {
  const { db, rpcs } = fakeDb();
  const out = await call(db, "save_item", savePlace({ maps_url: PIN_URL, lat: 33.9, lng: 35.5 }));
  assertEquals(out.isError, false, out.text);
  const m = rpcs.find((r) => r.name === "save_item")!.params.p_metadata as Record<string, unknown>;
  assertEquals([m.lat, m.lng], [33.9, 35.5]);
});

Deno.test("update_item: a long link fills a place without a location; short links never open", async () => {
  const note = { title: "Hinode Sushi", summary: null, body_markdown: "", item_type: "note", metadata: {} };
  const { db, rpcs } = fakeDb(note);
  const out = await call(db, "update_item", { item_id: ITEM, item_type: "place", metadata: { maps_url: PIN_URL } });
  assertEquals(out.isError, false, out.text);
  const m = rpcs.find((r) => r.name === "update_item")!.params.p_metadata as Record<string, unknown>;
  assertEquals([m.lat, m.lng], [28.670335, -81.209237]);

  const place = { title: "Hinode Sushi", summary: null, body_markdown: "", item_type: "place", metadata: { status: "want", maps_url: SHORT } };
  const { db: db2, rpcs: rpcs2 } = fakeDb(place);
  const visit = await call(db2, "update_item", { item_id: ITEM, add_visit: { on: "2026-10-01" } });
  assertEquals(visit.isError, false, visit.text);
  const m2 = rpcs2.find((r) => r.name === "update_item")!.params.p_metadata as Record<string, unknown>;
  assert(!("lat" in m2) && !("lng" in m2));
  assertEquals(visit.requested, []);
});

Deno.test("update_item: a location the user removed is not put back from the same link", async () => {
  const place = { title: "Hinode Sushi", summary: null, body_markdown: "", item_type: "place", metadata: { status: "want", maps_url: PIN_URL, lat: 1, lng: 2 } };
  const { db, rpcs } = fakeDb(place);
  const out = await call(db, "update_item", { item_id: ITEM, metadata: { status: "want", maps_url: PIN_URL } });
  assertEquals(out.isError, false, out.text);
  assertEquals(rpcs.find((r) => r.name === "update_item")!.params.p_metadata, { status: "want", maps_url: PIN_URL });
});
