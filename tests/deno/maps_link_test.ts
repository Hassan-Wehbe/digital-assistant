// Coordinates from a Google Maps link (docs/places-plan.md step 8, Q15). The server follows a short
// link with a fake fetch here: only Google Maps hosts, https, at most 5 redirects, 5 seconds, the
// body never read, nothing logged, and a failure never stops the save.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  coordinatesInLink, isShortMapsLink, linkLogLine, locationFromMapsLink as withTrace, MAX_PAGE_BYTES,
  MAX_REDIRECTS, pageCoordinates, withLinkLocation as withLog,
} from "../../supabase/functions/mcp/lib/maps_link.ts";
import { registerSaveItem } from "../../supabase/functions/mcp/tools/save_item.ts";
import { registerUpdateItem } from "../../supabase/functions/mcp/tools/update_item.ts";

// The outcomes without their log details (checked on their own below).
const locationFromMapsLink = async (...a: Parameters<typeof withTrace>) => {
  const { trace: _t, ...r } = await withTrace(...a);
  return r;
};
const withLinkLocation = async (...a: Parameters<typeof withLog>) => {
  const { log: _l, ...r } = await withLog(...a);
  return r;
};

const SHORT = "https://maps.app.goo.gl/AbCdEf123";
const PIN_URL =
  "https://www.google.com/maps/place/Hinode+Sushi/@28.5401,-81.3801,17z/data=!3m1!4b1!4m6!3m5!1s0x88e77b:0x1!8m2!3d28.5383351!4d-81.3792371!16s%2Fg%2F11";
const VIEW_URL = "https://www.google.com/maps/place/Hinode+Sushi/@28.5401,-81.3801,17z?entry=tts";

interface Hop {
  status: number;
  location?: string;
}

/** A fetch that answers from a table, records what was requested and with which options. */
function fakeFetch(table: Record<string, Hop | "hang" | "throw">) {
  const requested: { url: string; init?: RequestInit }[] = [];
  let bodyRead = false;
  const fn = ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    requested.push({ url, init });
    const hop = table[url];
    if (hop === "throw") return Promise.reject(new TypeError("connection refused"));
    if (hop === "hang") {
      return new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
    }
    const body = new ReadableStream({ pull(c) { bodyRead = true; c.enqueue(new TextEncoder().encode("<html>secret page</html>")); c.close(); } }, { highWaterMark: 0 });
    const h = hop ?? { status: 404 };
    return Promise.resolve(new Response(body, { status: h.status, headers: h.location ? { location: h.location } : {} }));
  }) as typeof fetch;
  return { fn, requested, bodyRead: () => bodyRead };
}

// ---- Reading a link without any request ------------------------------------------------------

Deno.test("coordinates are read from a long link: the pin first, else the map's centre", () => {
  assertEquals(coordinatesInLink(PIN_URL), { lat: 28.538335, lng: -81.379237 });
  assertEquals(coordinatesInLink(VIEW_URL), { lat: 28.5401, lng: -81.3801 });
  assertEquals(coordinatesInLink("geo:33.8938,35.5018?q=Tawlet"), { lat: 33.8938, lng: 35.5018 });
  assertEquals(coordinatesInLink("https://www.google.com/maps/place/x/data=%213d33.9%214d35.5"), { lat: 33.9, lng: 35.5 });
  assertEquals(coordinatesInLink(SHORT), null);
  assertEquals(coordinatesInLink("https://maps.google.com/?q=Tawlet"), null);
  // Out of range, or not a Maps link: nothing.
  assertEquals(coordinatesInLink("https://www.google.com/maps/@95.1,35.5,17z"), null);
  assertEquals(coordinatesInLink("https://www.google.com/maps/data=!3d33.9!4d185.2"), null);
  assertEquals(coordinatesInLink("https://evil.example/maps/@33.9,35.5,17z"), null);
});

Deno.test("a long link with coordinates needs no request", async () => {
  const f = fakeFetch({});
  assertEquals(await locationFromMapsLink(PIN_URL, f.fn), { point: { lat: 28.538335, lng: -81.379237 } });
  assertEquals(f.requested.length, 0);
});

Deno.test("only short Maps links start a request; other hosts and http are never requested", async () => {
  assert(isShortMapsLink(SHORT));
  assert(isShortMapsLink("https://goo.gl/maps/xyz"));
  for (const url of [
    "http://maps.app.goo.gl/AbC", // http
    "https://goo.gl/abc", // goo.gl outside /maps
    "https://evil.example/maps", // not Google
    "https://maps.app.goo.gl:8443/x", // a port
    "https://u:p@maps.app.goo.gl/x", // credentials
    "https://maps.google.com/?q=Tawlet", // long link without coordinates: nothing to follow
    "https://www.google.co.uk/maps/place/X",
  ]) {
    const f = fakeFetch({});
    assertEquals(await locationFromMapsLink(url, f.fn), { code: "not_a_short_link" }, url);
    assertEquals(f.requested.length, 0, url);
  }
});

// ---- Following a short link ---------------------------------------------------------------------

Deno.test("a short link resolving to !3d!4d gives the pin; no cookies or credentials, manual redirects", async () => {
  const f = fakeFetch({ [SHORT]: { status: 302, location: PIN_URL } });
  assertEquals(await locationFromMapsLink(SHORT, f.fn), { point: { lat: 28.538335, lng: -81.379237 } });
  assertEquals(f.requested.map((r) => r.url), [SHORT], "the final address is read, not requested");
  const init = f.requested[0].init!;
  assertEquals(init.redirect, "manual");
  assertEquals(init.credentials, "omit");
  assertEquals(init.headers, undefined, "no headers: no cookie, no authorization");
  assertEquals(f.bodyRead(), false);
});

Deno.test("a short link resolving to @lat,lng, through a Google Maps hop", async () => {
  const hop = "https://maps.google.com/?q=Hinode+Sushi&ftid=0x88e77b:0x1";
  const f = fakeFetch({ [SHORT]: { status: 301, location: hop }, [hop]: { status: 302, location: VIEW_URL } });
  assertEquals(await locationFromMapsLink(SHORT, f.fn), { point: { lat: 28.5401, lng: -81.3801 } });
  assertEquals(f.requested.map((r) => r.url), [SHORT, hop]);
});

Deno.test("a redirect off Google Maps is refused and never requested", async () => {
  for (const away of [
    "https://evil.example/maps/@33.9,35.5,17z",
    "http://www.google.com/maps/@33.9,35.5,17z", // http
    "https://www.google.com/search?q=x", // google.com outside /maps
    "https://www.google.com.evil.example/maps/x",
    "https://www.google.co.uk/maps/@33.9,35.5,17z", // country domains are not listed
    "https://169.254.169.254/latest/meta-data",
  ]) {
    const f = fakeFetch({ [SHORT]: { status: 302, location: away } });
    assertEquals(await locationFromMapsLink(SHORT, f.fn), { code: "off_google" }, away);
    assertEquals(f.requested.map((r) => r.url), [SHORT], away);
  }
});

Deno.test("Google's consent page is read for its Maps address, never requested", async () => {
  const consent = `https://consent.google.com/m?continue=${encodeURIComponent(PIN_URL)}&gl=DE`;
  const f = fakeFetch({ [SHORT]: { status: 302, location: consent } });
  assertEquals(await locationFromMapsLink(SHORT, f.fn), { point: { lat: 28.538335, lng: -81.379237 } });
  assertEquals(f.requested.length, 1);
  const bad = `https://consent.google.com/m?continue=${encodeURIComponent("https://evil.example/@1,2")}`;
  const g = fakeFetch({ [SHORT]: { status: 302, location: bad } });
  assertEquals(await locationFromMapsLink(SHORT, g.fn), { code: "off_google" });
  assertEquals(g.requested.length, 1);
});

Deno.test("too many redirects: at most 5 are followed", async () => {
  const table: Record<string, Hop> = {};
  const hop = (n: number) => n === 0 ? SHORT : `https://maps.google.com/?q=x&n=${n}`;
  for (let n = 0; n < 10; n++) table[hop(n)] = { status: 302, location: hop(n + 1) };
  const f = fakeFetch(table);
  assertEquals(await locationFromMapsLink(SHORT, f.fn), { code: "too_many_redirects" });
  assertEquals(f.requested.length, MAX_REDIRECTS + 1);

  // Exactly 5 redirects, the fifth leading to the coordinates: fine.
  const ok: Record<string, Hop> = {};
  for (let n = 0; n < 4; n++) ok[hop(n)] = { status: 302, location: hop(n + 1) };
  ok[hop(4)] = { status: 302, location: PIN_URL };
  assert("point" in await locationFromMapsLink(SHORT, fakeFetch(ok).fn));
});

Deno.test("a timeout, a network error, an error status or a non-HTML page: a code, no point, nothing read", async () => {
  const t0 = Date.now();
  assertEquals(await locationFromMapsLink(SHORT, fakeFetch({ [SHORT]: "hang" }).fn, 50), { code: "timeout" });
  assert(Date.now() - t0 < 2000);
  // A fetch that ignores the abort signal is still cut off.
  const deaf = (() => new Promise(() => {})) as typeof fetch;
  assertEquals(await locationFromMapsLink(SHORT, deaf, 50), { code: "timeout" });
  assertEquals(await locationFromMapsLink(SHORT, fakeFetch({ [SHORT]: "throw" }).fn), { code: "network" });
  assertEquals(await locationFromMapsLink(SHORT, fakeFetch({ [SHORT]: { status: 404 } }).fn), { code: "http_status" });
  assertEquals(await locationFromMapsLink(SHORT, fakeFetch({ [SHORT]: { status: 302 } }).fn), { code: "http_status" });
  const page = fakeFetch({ [SHORT]: { status: 200 } });
  assertEquals(await locationFromMapsLink(SHORT, page.fn), { code: "no_coordinates" });
  assertEquals(page.bodyRead(), false, "only an HTML page is read");
});

Deno.test("a bad coordinate in the final address is refused", async () => {
  const bad = "https://www.google.com/maps/place/X/data=!3d91.5!4d35.5";
  // Not taken as a location: the address is opened as one more hop, which has no other coordinates.
  const f = fakeFetch({ [SHORT]: { status: 302, location: bad }, [bad]: { status: 200 } });
  assertEquals(await locationFromMapsLink(SHORT, f.fn), { code: "no_coordinates" });
});

Deno.test("withLinkLocation keeps a location the place already has, and needs a link", async () => {
  const f = fakeFetch({ [SHORT]: { status: 302, location: PIN_URL } });
  const kept = await withLinkLocation({ status: "want", maps_url: SHORT, lat: 1.5, lng: 2.5 }, f.fn);
  assertEquals(kept, { place: { status: "want", maps_url: SHORT, lat: 1.5, lng: 2.5 }, filled: false });
  assertEquals((await withLinkLocation({ status: "want" }, f.fn)).filled, false);
  assertEquals(f.requested.length, 0);
  const filled = await withLinkLocation({ status: "want", maps_url: SHORT }, f.fn);
  assertEquals(filled, { place: { status: "want", maps_url: SHORT, lat: 28.538335, lng: -81.379237 }, filled: true });
});

// ---- Google's place page (current share links: the address has no coordinates) -------------

// Today's share links lead to an address that names the place by id, with no coordinates.
const PLACE_PAGE = "https://www.google.com/maps/place/Hinode+Sushi/data=!4m2!3m1!1s0x88e77b:0x1?entry=gps";

/** A fetch whose last hop answers with an HTML page, optionally slowly. */
function pageFetch(html: string, opts: { contentType?: string; slowMs?: number } = {}) {
  const requested: string[] = [];
  let pulled = 0;
  const bytes = new TextEncoder().encode(html);
  const fn = ((input: string | URL | Request) => {
    const url = String(input);
    requested.push(url);
    if (url === SHORT) return Promise.resolve(new Response(null, { status: 302, headers: { location: PLACE_PAGE } }));
    if (url !== PLACE_PAGE) return Promise.resolve(new Response(null, { status: 404 }));
    const body = new ReadableStream<Uint8Array>({
      async pull(c) {
        if (opts.slowMs) await new Promise((r) => setTimeout(r, opts.slowMs));
        if (pulled >= bytes.length) return c.close();
        const part = bytes.subarray(pulled, pulled + 64 * 1024);
        pulled += part.length;
        c.enqueue(part);
      },
    }, { highWaterMark: 0 });
    return Promise.resolve(new Response(body, { status: 200, headers: { "content-type": opts.contentType ?? "text/html; charset=UTF-8" } }));
  }) as typeof fetch;
  return { fn, requested, pulled: () => pulled };
}

const page = (inner: string) => `<!DOCTYPE html><html><head><title>Hinode Sushi</title>${inner}</head><body></body></html>`;

Deno.test("the place page: coordinates by the pin, the preview image, a map address, or the starting view", async () => {
  const cases: [string, string, { lat: number; lng: number }][] = [
    ["page_pin", 'x="/maps/place/Hinode/data=!4m5!3m4!1s0x1:0x2!8m2!3d28.5383351!4d-81.3792371"', { lat: 28.538335, lng: -81.379237 }],
    ["page_image", '<meta content="https://maps.google.com/maps/api/staticmap?center=28.5383351%2C-81.3792371&amp;zoom=16&amp;size=900x900" property="og:image">', { lat: 28.538335, lng: -81.379237 }],
    ["page_view", '<link href="https://www.google.com/maps/place/Hinode/@28.5383,-81.3792,17z" rel="canonical">', { lat: 28.5383, lng: -81.3792 }],
    ["page_state", "<script>window.APP_INITIALIZATION_STATE=[[[3456.78,-81.3792371,28.5383351],[0,0,0],[1024,768],13.1]]</script>", { lat: 28.538335, lng: -81.379237 }],
  ];
  for (const [found, inner, point] of cases) {
    const f = pageFetch(page(inner));
    const out = await withTrace(SHORT, f.fn);
    assertEquals("point" in out && out.point, point, found);
    assertEquals(out.trace?.found, found);
    assertEquals(f.requested, [SHORT, PLACE_PAGE]);
  }
  // The pin wins over the map's centre when both are there.
  assertEquals(pageCoordinates(page('/@1.5,2.5,17z !3d28.5!4d-81.3'))?.point, { lat: 28.5, lng: -81.3 });
});

Deno.test("the place page: none, out of range, too big, too slow, or not HTML gives no point", async () => {
  assertEquals(await locationFromMapsLink(SHORT, pageFetch(page("<p>no coordinates here</p>")).fn), { code: "no_coordinates" });
  assertEquals(pageCoordinates(page('center=95.1%2C35.5 /@95.1,35.5,17z')), null);
  // Only the first MAX_PAGE_BYTES are read: coordinates after that are never seen.
  const big = pageFetch("a".repeat(MAX_PAGE_BYTES + 200_000) + "!3d28.5!4d-81.3");
  const out = await withTrace(SHORT, big.fn);
  assertEquals("code" in out && out.code, "no_coordinates");
  assertEquals(out.trace?.page_bytes, MAX_PAGE_BYTES);
  assert(big.pulled() <= MAX_PAGE_BYTES + 64 * 1024, "reading stops at the limit");
  // A page that trickles in is cut off by the same time limit.
  const slow = pageFetch(page("x".repeat(500_000)), { slowMs: 30 });
  assertEquals(await locationFromMapsLink(SHORT, slow.fn, 200), { code: "timeout" });
  // A page that is not HTML is not read.
  const json = pageFetch('{"x":"!3d28.5!4d-81.3"}', { contentType: "application/json" });
  assertEquals(await locationFromMapsLink(SHORT, json.fn), { code: "no_coordinates" });
  assertEquals(json.pulled(), 0);
});

Deno.test("the log line holds only the outcome code, the requests made and the last status", async () => {
  const none = page("<p>Hinode Sushi</p>");
  const line = linkLogLine(await withTrace(SHORT, pageFetch(none).fn));
  const bytes = new TextEncoder().encode(none).length;
  assertEquals(JSON.parse(line), { event: "maps_link", code: "no_coordinates", requests: 2, status: 200, page_bytes: bytes, found: null });
  const inPage = linkLogLine(await withTrace(SHORT, pageFetch(page("staticmap?center=28.5383351%2C-81.3792371")).fn));
  assertEquals(JSON.parse(inPage).found, "page_image");
  const ok = linkLogLine(await withTrace(SHORT, fakeFetch({ [SHORT]: { status: 302, location: PIN_URL } }).fn));
  assertEquals(JSON.parse(ok), { event: "maps_link", code: "ok", requests: 1, status: 302, page_bytes: 0, found: "link" });
  for (const leak of ["goo.gl", "google", "Hinode", "28.5", "81.3"]) {
    assert(!line.includes(leak) && !ok.includes(leak) && !inPage.includes(leak), leak);
  }
  const f = fakeFetch({});
  assertEquals(JSON.parse(linkLogLine(await withTrace(PIN_URL, f.fn))), { event: "maps_link", code: "ok", requests: 0, status: 0, page_bytes: 0, found: "link" });
});

// ---- Through save_item and update_item -------------------------------------------------------

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

/** Calls a tool with globalThis.fetch replaced, and every console method watched. */
async function call(db: SupabaseClient, name: string, args: Record<string, unknown>, fetchFn: typeof fetch) {
  const logged: unknown[][] = [];
  const realFetch = globalThis.fetch;
  const methods = ["log", "info", "warn", "error", "debug"] as const;
  const real = methods.map((m) => console[m]);
  globalThis.fetch = fetchFn;
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
    return { isError: !!out.result.isError, text: out.result.content[0].text as string, logged };
  } finally {
    globalThis.fetch = realFetch;
    methods.forEach((m, i) => console[m] = real[i]);
  }
}

const savePlace = (metadata: Record<string, unknown>) =>
  ({ space: "Restaurants", title: "Hinode Sushi", body: "", item_type: "place", metadata });

/** Every console line, checked to be only the maps_link line (never the link or the point). */
function onlyCodes(logged: unknown[][]) {
  for (const args of logged) {
    assertEquals(args.length, 1);
    const line = JSON.parse(String(args[0]));
    assertEquals(Object.keys(line).sort(), ["code", "event", "found", "page_bytes", "requests", "status"]);
    for (const leak of ["goo.gl", "maps.", "evil", "http", "28.5", "81.3"]) assert(!String(args[0]).includes(leak), leak);
  }
  return logged.map((a) => JSON.parse(String(a[0])).code);
}

Deno.test("save_item: a place shared from Google Maps gets its location from the link; only a code logged", async () => {
  const f = fakeFetch({ [SHORT]: { status: 302, location: PIN_URL } });
  const { db, rpcs } = fakeDb();
  const out = await call(db, "save_item", savePlace({ maps_url: SHORT, kind: "restaurant" }), f.fn);
  assertEquals(out.isError, false, out.text);
  assertEquals(rpcs.find((r) => r.name === "save_item")!.params.p_metadata, {
    status: "want", maps_url: SHORT, kind: "restaurant", lat: 28.538335, lng: -81.379237,
  });
  assertEquals(JSON.parse(out.text).location, "read from the Google Maps link");
  assertEquals(f.requested.length, 1);
  assertEquals(onlyCodes(out.logged), ["ok"]);
});

Deno.test("save_item: a location the user set is kept and the link is not opened", async () => {
  const f = fakeFetch({ [SHORT]: { status: 302, location: PIN_URL } });
  const { db, rpcs } = fakeDb();
  const out = await call(db, "save_item", savePlace({ maps_url: SHORT, lat: 33.9, lng: 35.5 }), f.fn);
  assertEquals(out.isError, false, out.text);
  const m = rpcs.find((r) => r.name === "save_item")!.params.p_metadata as Record<string, unknown>;
  assertEquals([m.lat, m.lng], [33.9, 35.5]);
  assertEquals(f.requested.length, 0);
  assertEquals("location" in JSON.parse(out.text), false);
});

Deno.test("save_item: when the link leads nowhere useful the place is saved as it was", async () => {
  for (const table of [{ [SHORT]: "throw" as const }, { [SHORT]: { status: 302, location: "https://evil.example/@1,2" } }]) {
    const { db, rpcs } = fakeDb();
    const out = await call(db, "save_item", savePlace({ maps_url: SHORT }), fakeFetch(table).fn);
    assertEquals(out.isError, false, out.text);
    assertEquals(rpcs.find((r) => r.name === "save_item")!.params.p_metadata, { status: "want", maps_url: SHORT });
    assertEquals(onlyCodes(out.logged).length, 1);
  }
});

Deno.test("update_item: making a note a place, or editing a place without a location, reads the link", async () => {
  const f = fakeFetch({ [SHORT]: { status: 302, location: PIN_URL } });
  const note = { title: "Hinode Sushi", summary: null, body_markdown: "", item_type: "note", metadata: {} };
  const { db, rpcs } = fakeDb(note);
  const out = await call(db, "update_item", { item_id: ITEM, item_type: "place", metadata: { maps_url: SHORT } }, f.fn);
  assertEquals(out.isError, false, out.text);
  const m = rpcs.find((r) => r.name === "update_item")!.params.p_metadata as Record<string, unknown>;
  assertEquals([m.lat, m.lng], [28.538335, -81.379237]);

  const place = { title: "Hinode Sushi", summary: null, body_markdown: "", item_type: "place", metadata: { status: "want", maps_url: SHORT } };
  const { db: db2, rpcs: rpcs2 } = fakeDb(place);
  const visit = await call(db2, "update_item", { item_id: ITEM, add_visit: { on: "2026-10-01" } }, f.fn);
  assertEquals(visit.isError, false, visit.text);
  const m2 = rpcs2.find((r) => r.name === "update_item")!.params.p_metadata as Record<string, unknown>;
  assertEquals([m2.lat, m2.lng], [28.538335, -81.379237]);
});

Deno.test("update_item: a location the user removed is not put back from the same link", async () => {
  const f = fakeFetch({ [SHORT]: { status: 302, location: PIN_URL } });
  const place = { title: "Hinode Sushi", summary: null, body_markdown: "", item_type: "place", metadata: { status: "want", maps_url: SHORT, lat: 1, lng: 2 } };
  const { db, rpcs } = fakeDb(place);
  const out = await call(db, "update_item", { item_id: ITEM, metadata: { status: "want", maps_url: SHORT } }, f.fn);
  assertEquals(out.isError, false, out.text);
  assertEquals(rpcs.find((r) => r.name === "update_item")!.params.p_metadata, { status: "want", maps_url: SHORT });
  assertEquals(f.requested.length, 0);

  // A text-only edit never opens the link.
  const { db: db2 } = fakeDb({ ...place, metadata: { status: "want", maps_url: SHORT } });
  await call(db2, "update_item", { item_id: ITEM, body: "new text" }, f.fn);
  assertEquals(f.requested.length, 0);
});
