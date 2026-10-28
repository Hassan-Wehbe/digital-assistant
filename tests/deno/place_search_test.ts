// Find a place by name (supabase/functions/place-search, D45 Q9): sign-in first, no key means "not
// set up", at most DAILY_REQUESTS a day, every request counted, nothing that looks like a password
// sent to Google, and only checked suggestions back.
import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  type AutocompleteRequest,
  createHandler,
  DAILY_REQUESTS,
  kindFromTypes,
  readSuggestions,
  type SearchDeps,
  type UsageRow,
} from "../../supabase/functions/place-search/handler.ts";

const GOOGLE = {
  suggestions: [
    {
      placePrediction: {
        placeId: "ChIJ-library_1",
        text: { text: "Coral Gables Branch Library, 3443 Segovia St, Coral Gables, FL" },
        structuredFormat: { mainText: { text: "Coral Gables Branch Library" }, secondaryText: { text: "3443 Segovia St, Coral Gables, FL" } },
        types: ["library", "point_of_interest", "establishment"],
      },
    },
    { queryPrediction: { text: { text: "coral gables libraries" } } },
    { placePrediction: { placeId: "bad id!", structuredFormat: { mainText: { text: "Bad" } } } },
  ],
};

function world(over: Partial<SearchDeps> = {}) {
  const rows: UsageRow[][] = [];
  const sent: AutocompleteRequest[] = [];
  const logs: unknown[] = [];
  const deps: SearchDeps = {
    verifyToken: (t) => Promise.resolve(t === "good" ? "user-1" : null),
    apiKey: () => "key",
    usedToday: () => Promise.resolve(0),
    record: (_t, r) => {
      rows.push(r);
      return Promise.resolve();
    },
    autocomplete: (_k, req) => {
      sent.push(req);
      return Promise.resolve(GOOGLE);
    },
    log: (e) => logs.push(e),
    ...over,
  };
  return { handler: createHandler(deps), rows, sent, logs };
}

const post = (body: unknown, token = "good") =>
  new Request("http://localhost/place-search", {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });

const ASK = { text: "coral gables lib", session: "session-123", near: { lat: 25.75, lng: -80.27 } };

Deno.test("place-search: sign-in first", async () => {
  const w = world();
  assertEquals((await w.handler(post(ASK, ""))).status, 401);
  assertEquals((await w.handler(post(ASK, "fake"))).status, 401);
  assertEquals(w.sent.length, 0);
});

Deno.test("place-search: suggestions back, checked, with a kind guessed; the request counted", async () => {
  const w = world();
  const res = await w.handler(post(ASK));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), {
    available: true,
    suggestions: [{ place_id: "ChIJ-library_1", name: "Coral Gables Branch Library", address: "3443 Segovia St, Coral Gables, FL", kind: "library" }],
  });
  assertEquals(w.sent, [ASK]);
  assertEquals(w.rows, [[{ kind: "google_places", detail: "autocomplete", count: 1, cost_cents: 0.283 }]]);
  // The log line holds no text.
  assert(!JSON.stringify(w.logs).includes("coral"));
});

Deno.test("place-search: no key yet, the app is told it is not set up (nothing sent, nothing counted)", async () => {
  const w = world({ apiKey: () => undefined });
  assertEquals(await (await w.handler(post(ASK))).json(), { available: false, reason: "not_set_up" });
  assertEquals([w.sent.length, w.rows.length], [0, 0]);
});

Deno.test("place-search: the daily limit", async () => {
  const w = world({ usedToday: () => Promise.resolve(DAILY_REQUESTS) });
  assertEquals(await (await w.handler(post(ASK))).json(), { available: false, reason: "daily_limit" });
  assertEquals(w.sent.length, 0);
  assertEquals(w.rows, [[{ kind: "fair_use_hit", detail: "google_places", count: 1 }]]);
});

Deno.test("place-search: nothing that looks like a password goes to Google", async () => {
  const w = world();
  const res = await w.handler(post({ ...ASK, text: "my password is hunter2!" }));
  assertEquals(res.status, 400);
  assertEquals(w.sent.length, 0);
});

Deno.test("place-search: bad input is refused before Google", async () => {
  const w = world();
  for (const body of [{ ...ASK, text: "ab" }, { ...ASK, text: "x".repeat(121) }, { ...ASK, session: "no" }, { ...ASK, near: { lat: 200, lng: 0 } }]) {
    assertEquals((await w.handler(post(body))).status, 400);
  }
  assertEquals(w.sent.length, 0);
});

Deno.test("place-search: Google failing is a short message, counted as a failure", async () => {
  const w = world({ autocomplete: () => Promise.reject(new Error("google 500")) });
  const res = await w.handler(post(ASK));
  assertEquals(res.status, 502);
  assertEquals(w.rows[0][0].failures, 1);
});

Deno.test("kindFromTypes and readSuggestions", () => {
  assertEquals(kindFromTypes(["swimming_pool", "establishment"]), "sports");
  assertEquals(kindFromTypes(["italian_restaurant"]), "restaurant");
  assertEquals(kindFromTypes(["dentist"]), "health");
  assertEquals(kindFromTypes(["point_of_interest"]), undefined);
  assertEquals(readSuggestions(null), []);
  assertEquals(readSuggestions({ suggestions: Array(9).fill(GOOGLE.suggestions[0]) }).length, 5);
});
