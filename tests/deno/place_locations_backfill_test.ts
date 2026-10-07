// The one-off pass for places saved before the server read locations from Maps links
// (docs/places-plan.md step 8, Q15): a dry run counts and never requests or writes; a run fills
// only places without a location, from their own link, and reports counts only.
import { assertEquals } from "jsr:@std/assert@1";
import { backfillPlaceLocations, MAX_PER_RUN, type PlaceRow } from "../../supabase/functions/place-locations/backfill.ts";

const SHORT = "https://maps.app.goo.gl/AbCdEf123";
const PIN_URL = "https://www.google.com/maps/place/X/data=!3d28.5383351!4d-81.3792371";

const row = (id: string, owner: string, metadata: Record<string, unknown> | null): PlaceRow =>
  ({ id, space_id: `space-${owner}`, owner_user_id: owner, updated_at: "2026-10-07T10:00:00Z", metadata });

function fakeStore(rows: PlaceRow[], writable = true) {
  const writes: { row: PlaceRow; metadata: Record<string, unknown> }[] = [];
  return {
    writes,
    store: {
      listPlaces: () => Promise.resolve(rows),
      saveLocation: (r: PlaceRow, metadata: Record<string, unknown>) => {
        writes.push({ row: r, metadata });
        return Promise.resolve(writable);
      },
    },
  };
}

function fakeFetch(table: Record<string, { status: number; location?: string }>) {
  const requested: string[] = [];
  const fn = ((input: string | URL | Request) => {
    const url = String(input);
    requested.push(url);
    const h = table[url] ?? { status: 404 };
    return Promise.resolve(new Response(null, { status: h.status, headers: h.location ? { location: h.location } : {} }));
  }) as typeof fetch;
  return { fn, requested };
}

const ROWS = [
  row("a", "u1", { status: "want", maps_url: SHORT, kind: "restaurant" }),
  row("b", "u1", { status: "want", maps_url: "https://www.google.com/maps/place/Y/@33.9,35.5,17z" }),
  row("c", "u2", { status: "want", maps_url: SHORT, lat: 1, lng: 2 }),
  row("d", "u2", { status: "want" }),
  row("e", "u2", { status: "want", maps_url: "https://maps.google.com/?q=Z" }),
];

Deno.test("a dry run counts, makes no request and writes nothing", async () => {
  const { store, writes } = fakeStore(ROWS);
  const f = fakeFetch({ [SHORT]: { status: 302, location: PIN_URL } });
  const counts = await backfillPlaceLocations(store, { fetchFn: f.fn });
  assertEquals(counts, {
    dry_run: true, users: 2, places: 5, already_located: 1, without_link: 1, link_has_coordinates: 1,
    short_links: 1, other_links: 1, filled: 0, not_written: 0, failed: {}, left_for_next_run: 0,
  });
  assertEquals(f.requested, []);
  assertEquals(writes, []);
});

Deno.test("a run fills each place from its own link and keeps its other fields; a located place is untouched", async () => {
  const { store, writes } = fakeStore(ROWS);
  const f = fakeFetch({ [SHORT]: { status: 302, location: PIN_URL } });
  const counts = await backfillPlaceLocations(store, { apply: true, fetchFn: f.fn });
  assertEquals(counts.filled, 2);
  assertEquals(counts.dry_run, false);
  assertEquals(f.requested, [SHORT], "one request, for the one short link; the long link is read as is");
  assertEquals(writes.map((w) => [w.row.id, w.metadata]), [
    ["a", { status: "want", maps_url: SHORT, kind: "restaurant", lat: 28.538335, lng: -81.379237 }],
    ["b", { status: "want", maps_url: "https://www.google.com/maps/place/Y/@33.9,35.5,17z", lat: 33.9, lng: 35.5 }],
  ]);
  // Only counts come back: nothing that names a place, a link or a point.
  const text = JSON.stringify(counts);
  for (const leak of ["maps", "goo.gl", "28.5", "33.9", '"a"', "u1"]) assertEquals(text.includes(leak), false, leak);
});

Deno.test("failures are counted by code and leave the place as it was", async () => {
  const { store, writes } = fakeStore([row("a", "u1", { maps_url: SHORT })]);
  const f = fakeFetch({ [SHORT]: { status: 302, location: "https://evil.example/@1,2" } });
  const counts = await backfillPlaceLocations(store, { apply: true, fetchFn: f.fn });
  assertEquals(counts.failed, { off_google: 1 });
  assertEquals(counts.filled, 0);
  assertEquals(writes, []);
});

Deno.test("a place changed meanwhile is not written; at most MAX_PER_RUN links are opened per run", async () => {
  const { store } = fakeStore([row("a", "u1", { maps_url: SHORT })], false);
  const f = fakeFetch({ [SHORT]: { status: 302, location: PIN_URL } });
  assertEquals((await backfillPlaceLocations(store, { apply: true, fetchFn: f.fn })).not_written, 1);

  const many = Array.from({ length: MAX_PER_RUN + 3 }, (_, i) => row(`p${i}`, "u1", { maps_url: SHORT }));
  const g = fakeFetch({ [SHORT]: { status: 302, location: PIN_URL } });
  const counts = await backfillPlaceLocations(fakeStore(many).store, { apply: true, fetchFn: g.fn });
  assertEquals([counts.filled, counts.left_for_next_run, g.requested.length], [MAX_PER_RUN, 3, MAX_PER_RUN]);
});
