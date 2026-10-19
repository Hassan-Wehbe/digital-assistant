// Date night and family day (docs/planners-plan.md step 2, D40): the short list (code, searchable
// spaces only), what the model is told (numbered places, roles and ages, never a name or an id),
// the checks on its answer (no invented place, nothing over a calendar event, nothing outside the
// window, no credential-like line), and the route end to end on the evaluation's pretend account
// with a scripted model and fake drive times: Pro, the AI allowance, counted once, never stored.
import { assert, assertEquals, assertFalse } from "jsr:@std/assert@1";
import type { SupabaseClient } from "@supabase/supabase-js";
import "../eval/harness.ts"; // Edge runtime stand-ins
import { IDS, World } from "../eval/world.ts";
import {
  type Busy, type Candidate, checkAnswer, MAX_STEPS, type OutingAsk, outingPrompt, type PlaceRow, shortlist, whoWords,
} from "../../supabase/functions/chat/outing_plan.ts";
import { type OutingLog, outingPlan, type OutingPlan, windowOf } from "../../supabase/functions/chat/outing.ts";
import type { ChatRequest, StreamEvent } from "../../supabase/functions/_shared/llm/index.ts";

const HOME = { lat: 33.89, lng: 35.5 };
const TODAY = "2026-10-19";
const row = (id: string, title: string, m: Record<string, unknown>): PlaceRow => ({ id, title, metadata: { lat: 33.895, lng: 35.51, ...m } });
const ROWS: PlaceRow[] = [
  row("id-fav", "Old favourite", { kind: "restaurant", status: "been", rating: 5, visited_on: "2026-07-01", price_level: 2 }),
  row("id-recent", "Been last week", { kind: "restaurant", status: "been", rating: 5, visited_on: "2026-10-15", price_level: 2 }),
  row("id-pricey", "Fancy place", { kind: "restaurant", status: "been", rating: 5, visited_on: "2026-06-01", price_level: 4 }),
  row("id-dn", "Date-night bar", { kind: "bar", status: "been", rating: 3, occasions: ["date_night"], visited_on: "2026-05-01" }),
  row("id-want", "Want to try", { kind: "restaurant", status: "want", price_level: 2 }),
  row("id-park", "Waterfront walk", { kind: "to-visit", status: "want" }),
  row("id-zoo", "Petting farm", { kind: "to-visit", status: "been", occasions: ["kids"] }),
  row("id-kidfood", "Pizza place", { kind: "restaurant", status: "been", rating: 4, price_level: 1, occasions: ["kids"] }),
  row("id-far", "Far away", { kind: "restaurant", status: "been", rating: 5, lat: 34.9, lng: 36.5 }),
  row("id-home", "Home", { kind: "home", status: "been" }),
  { id: "id-nopoint", title: "No location", metadata: { kind: "restaurant", status: "been", rating: 5 } },
];
const DATE: OutingAsk = { kind: "date", date: "2026-10-23", start: "19:00", end: "22:00", budget: 2, mood: "favourite" };
const FAMILY: OutingAsk = { kind: "family", date: "2026-10-24", start: "09:00", end: "18:00", setting: "either", who: { adults: 2, child_ages: [9, 6] } };

// ---- The short list -------------------------------------------------------------------------

Deno.test("short list: a favourite date night is been, rated well, not lately, in the budget, near home", () => {
  const ids = shortlist(ROWS, DATE, HOME, TODAY).map((c) => c.id);
  assert(ids.includes("id-fav"), ids.join());
  assert(ids.includes("id-dn"), "marked date night");
  for (const no of ["id-recent", "id-pricey", "id-want", "id-far", "id-home", "id-nopoint"]) assertFalse(ids.includes(no), no);
  // "Somewhere new": want to go.
  const fresh = shortlist(ROWS, { ...DATE, mood: "new" }, HOME, TODAY).map((c) => c.id);
  assert(fresh.includes("id-want"));
  assertFalse(fresh.includes("id-fav"));
  // Any budget: the fancy place too.
  assert(shortlist(ROWS, { ...DATE, budget: 3 }, HOME, TODAY).some((c) => c.id === "id-pricey"));
});

Deno.test("short list: a family day takes kids' and places to visit, and cheap places to eat", () => {
  const ids = shortlist(ROWS, FAMILY, HOME, TODAY).map((c) => c.id);
  for (const yes of ["id-zoo", "id-park", "id-kidfood"]) assert(ids.includes(yes), yes);
  for (const no of ["id-pricey", "id-far", "id-home", "id-dn"]) assertFalse(ids.includes(no), no);
  assertEquals(ids[0], "id-zoo", "kids' places first");
});

Deno.test("short list: Another idea leaves out the places just shown, when others fit", () => {
  const first = shortlist(ROWS, FAMILY, HOME, TODAY).map((c) => c.id);
  const again = shortlist(ROWS, { ...FAMILY, avoid: ["id-zoo"] }, HOME, TODAY).map((c) => c.id);
  assertFalse(again.includes("id-zoo"));
  assert(again.length >= 2);
  // Too few others: the list stays.
  assertEquals(shortlist(ROWS.slice(0, 1), { ...DATE, avoid: ["id-fav"] }, HOME, TODAY).map((c) => c.id), ["id-fav"]);
  assert(first.length > again.length - 1);
});

// ---- What the model is told ----------------------------------------------------------------

Deno.test("prompt: numbered places and facts, roles and ages, never an id", () => {
  const cands = shortlist(ROWS, FAMILY, HOME, TODAY);
  const p = outingPrompt(FAMILY, cands, [], [{ at: "2026-10-24T14:00", rain_pct: 70 }], TODAY);
  assert(p.includes("1. Petting farm"), p);
  assert(p.includes("2 adults, children aged 6 and 9"));
  assert(p.includes("14:00 70%"));
  for (const c of cands) assertFalse(p.includes(c.id), "no ids");
  assertEquals(whoWords({ adults: 1, child_ages: [4] }), "1 adult, a child aged 4");
  assertEquals(whoWords(undefined), "not said");
});

// ---- The checks on the answer --------------------------------------------------------------

const CANDS: Candidate[] = shortlist(ROWS, FAMILY, HOME, TODAY);
const SOCCER: Busy = { key: "e1", title: "Soccer practice", start: "2026-10-24T11:00", end: "2026-10-24T12:00" };

Deno.test("answer: places only from the list, events kept at their own time, nothing over them", () => {
  const answer = JSON.stringify({
    title: "Farm and pizza",
    steps: [
      { place: 1, start: "09:30", minutes: 90, line: "The animals in the morning." },
      { event: "e1", start: "10:00", minutes: 30 },
      { place: 99, start: "12:15", minutes: 60, line: "Invented." },
      { place: 2, start: "11:30", minutes: 60, line: "Over the practice." },
      { place: 3, start: "12:30", minutes: 60, line: "Lunch." },
      { home: true, start: "15:00", minutes: 120, line: "Movie at home for the rain." },
      { place: 1, start: "17:00", minutes: 30, line: "Twice." },
    ],
    alternative: { place: 2, line: "Or the walk." },
  });
  const d = checkAnswer(`Here: ${answer}`, FAMILY, CANDS, [SOCCER])!;
  assertEquals(d.steps.map((s) => [s.start, s.end, s.place?.id ?? s.event?.key ?? "home"]), [
    ["09:30", "11:00", CANDS[0].id], ["11:00", "12:00", "e1"], ["12:30", "13:30", CANDS[2].id], ["15:00", "17:00", "home"],
  ]);
  assertEquals(d.dropped, 3);
  assertEquals(d.steps[1].line, "From your calendar, kept as it is.");
  assertEquals(d.alternative?.place.id, CANDS[1].id);
  assertEquals(d.title, "Farm and pizza");
});

Deno.test("answer: outside the window, a credential-like line, too many steps, no place at all", () => {
  const steps = (s: unknown[]) => JSON.stringify({ title: "x", steps: s });
  // Outside 09:00-18:00.
  assertEquals(checkAnswer(steps([{ place: 1, start: "08:00", minutes: 60, line: "a" }]), FAMILY, CANDS, []), null);
  assertEquals(checkAnswer(steps([{ place: 1, start: "17:30", minutes: 60, line: "a" }]), FAMILY, CANDS, []), null);
  // A line that looks like a credential is blanked, the step kept.
  const d = checkAnswer(steps([{ place: 1, start: "10:00", minutes: 60, line: "The gate code is 4831, password hunter2" }]), FAMILY, CANDS, [])!;
  assertEquals(d.steps[0].line, "");
  // At most MAX_STEPS.
  const many = Array.from({ length: 10 }, (_, i) => ({ home: true, start: `${String(9 + i % 9).padStart(2, "0")}:00`, minutes: 30, line: "h" }));
  const lots = checkAnswer(steps([{ place: 1, start: "09:00", minutes: 30, line: "p" }, ...many]), FAMILY, CANDS, [])!;
  assert(lots.steps.length <= MAX_STEPS);
  // Only home or events: no plan. Not JSON: no plan. Home only on a family day.
  assertEquals(checkAnswer(steps([{ home: true, start: "10:00", minutes: 60, line: "h" }]), FAMILY, CANDS, []), null);
  assertEquals(checkAnswer("Sorry, I can't.", FAMILY, CANDS, []), null);
  assertEquals(checkAnswer(steps([{ home: true, start: "19:30", minutes: 60 }, { place: 1, start: "20:00", minutes: 60 }]), DATE, CANDS, [])!.steps.length, 1);
});

// ---- The route --------------------------------------------------------------------------------

const MY_HOME = "00000000-0000-4000-8000-000000000301";

class Account {
  world = new World();
  rpcs: string[] = [];
  allowance = 0.1;
  constructor() {
    this.world.plan = "pro";
    this.world.homes = [{ id: MY_HOME, label: "Home", lat: 33.89, lng: 35.5, is_default: true }];
  }
  client(): SupabaseClient {
    const base = this.world.client() as unknown as { rpc: (n: string, p?: Record<string, unknown>) => Promise<unknown> };
    return {
      ...base,
      rpc: (name: string, params: Record<string, unknown> = {}) => {
        this.rpcs.push(name);
        if (name === "my_ai_allowance") return Promise.resolve({ data: { month: "2026-10-01", used_fraction: this.allowance }, error: null });
        if (name === "record_ai_usage") return Promise.resolve({ data: { used_fraction: 0.11 }, error: null });
        return base.rpc(name, params);
      },
    } as unknown as SupabaseClient;
  }
}

function setup(answer: string) {
  const account = new Account();
  const prompts: ChatRequest[] = [];
  const logs: OutingLog[] = [];
  const legs: string[] = [];
  const deps = {
    clientFor: () => account.client(),
    llm: () => ({
      async *stream(_route: string, req: ChatRequest): AsyncGenerator<StreamEvent> {
        prompts.push(req);
        yield {
          type: "done", turn: { role: "assistant", text: answer, toolCalls: [] }, stop: "end",
          usage: { inputTokens: 800, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 120, costCents: 0.2 },
        } as StreamEvent;
      },
    }),
    drives: () => ({
      leg: (_a: unknown, _b: unknown, at: string) => {
        legs.push(at);
        return Promise.resolve({ minutes: 20 });
      },
    }),
    log: (e: OutingLog) => logs.push(e),
    now: () => Date.parse(`${TODAY}T16:00:00Z`),
  };
  return { account, prompts, logs, legs, deps };
}

const BODY = { mode: "outing", kind: "date", date: "2026-10-23", tz: "Asia/Beirut", budget: 3, mood: "favourite", events: [] };
const ANSWER = JSON.stringify({
  title: "Dinner at Tawlet",
  steps: [{ place: 1, start: "19:30", minutes: 90, line: "Your 5-star farmers' kitchen." }, { place: 2, start: "21:20", minutes: 40, line: "A drink after." }],
  alternative: { place: 3, line: "Or the café." },
});

Deno.test("route: a date night from the saved places, timed, with drives; one AI request, counted once", async () => {
  const s = setup(ANSWER);
  const before = JSON.stringify(s.account.world.items);
  const out = await outingPlan(s.deps, "t", "eval-user", BODY);
  assertEquals(out.status, 200);
  const plan = (out.body as { plan: OutingPlan }).plan;
  assertEquals(plan.title, "Dinner at Tawlet");
  assertEquals(plan.from, "Home");
  assertEquals(plan.steps.length, 2);
  assert(plan.steps.every((st) => st.place && typeof st.place.lat === "number"));
  assertEquals(plan.leave_at, "19:10", "20 minutes before the first stop");
  assertEquals(plan.back_home_min, 20);
  assertEquals(s.account.world.dayPlansUsed, 1, "counted once, as a plan");
  assert(s.account.rpcs.includes("record_ai_usage"), "the AI request is counted");
  assertEquals(s.prompts.length, 1);
  assertEquals(JSON.stringify(s.account.world.items), before, "nothing written");
  assertEquals(s.logs[0].outcome, "ok");
  assertFalse(JSON.stringify(s.logs).includes("Tawlet"), "the log has no titles");
});

Deno.test("route: a place in a restricted space never reaches the model or the plan (rule 3)", async () => {
  const s = setup(ANSWER);
  await outingPlan(s.deps, "t", "eval-user", { ...BODY, mood: "new" });
  const said = s.prompts.map((p) => p.messages.map((m) => (m.role === "user" ? m.content : "")).join()).join();
  assertFalse(said.includes("Hidden courtyard bar"), said);
  assertFalse(said.includes(IDS.hiddenBar));
});

Deno.test("route: names never: the body takes roles and ages only", async () => {
  const s = setup(ANSWER);
  const bad = await outingPlan(s.deps, "t", "eval-user", { ...BODY, kind: "family", who: { adults: 2, child_ages: [6], names: ["Sam"] } });
  assertEquals(bad.status, 400);
  const extra = await outingPlan(s.deps, "t", "eval-user", { ...BODY, household: [{ label: "Sam" }] });
  assertEquals(extra.status, 400);
  assertEquals(s.prompts.length, 0, "no model call for a refused body");
});

Deno.test("route: not Pro, no home, nothing saved, AI allowance used, an answer with no place", async () => {
  const free = setup(ANSWER);
  free.account.world.plan = "free";
  assertEquals((await outingPlan(free.deps, "t", "u", BODY)).status, 403);
  assertEquals(free.prompts.length, 0);

  const noHome = setup(ANSWER);
  noHome.account.world.homes = [];
  assertEquals((await outingPlan(noHome.deps, "t", "u", BODY)).body, { plan: null, reason: "no_home" });

  const nothing = setup(ANSWER);
  nothing.account.world.items = nothing.account.world.items.filter((i) => i.item_type !== "place");
  assertEquals((await outingPlan(nothing.deps, "t", "u", BODY)).body, { plan: null, reason: "no_places" });
  assertEquals(nothing.account.world.dayPlansUsed, 0, "not counted when there is nothing to plan with");

  const used = setup(ANSWER);
  used.account.allowance = 1;
  assertEquals((await outingPlan(used.deps, "t", "u", BODY)).status, 429);
  assertEquals(used.prompts.length, 0);

  const odd = setup("I would suggest the moon.");
  const out = await outingPlan(odd.deps, "t", "u", BODY);
  assertEquals((out.body as { reason: string }).reason, "no_plan");
  assert(odd.account.rpcs.includes("record_ai_usage"), "the request was made, so it is counted");
});

Deno.test("route: the window: date night three hours from 7 pm, family day 9 to 6, at least an hour", () => {
  assertEquals(windowOf({ kind: "date" }), { start: "19:00", end: "22:00" });
  assertEquals(windowOf({ kind: "date", start: "22:30" }), { start: "22:30", end: "23:59" });
  assertEquals(windowOf({ kind: "family" }), { start: "09:00", end: "18:00" });
  assertEquals(windowOf({ kind: "family", start: "10:00", end: "10:30" }), null);
});

// ---- In the chat: plan_outing (step 4) --------------------------------------------------------

import { outingForChat } from "../../supabase/functions/chat/outing.ts";

const FAMILY_ANSWER = JSON.stringify({ title: "Out and about", steps: [{ place: 1, start: "10:00", minutes: 120, line: "A morning out." }] });

Deno.test("plan_outing: the household goes as ages only; a name field is refused; the card only when the app shows it", async () => {
  const s = setup(FAMILY_ANSWER);
  s.account.world.household = [
    { label: "Me", kind: "adult", birth_year: null },
    { label: "Rania", kind: "adult", birth_year: null },
    { label: "Lea", kind: "child", birth_year: 2019 },
  ];
  const ctx = { db: s.account.client(), userId: "u", tz: "Asia/Beirut", can: true };
  const out = await outingForChat(s.deps, ctx, { kind: "family", date: "2026-10-24", setting: "outdoor" });
  assertFalse(out.isError, out.text);
  const said = s.prompts.map((p) => JSON.stringify(p.messages)).join();
  assert(said.includes("2 adults, a child aged 7"), said);
  assertFalse(/Rania|Lea/.test(said), "no household name reaches the model");
  assertEquals(out.events.length, 1);
  assertEquals((out.events[0] as { type: string }).type, "outing_plan");
  assert(out.costCents > 0, "its AI request is added to the chat message's cost");
  assertFalse(s.account.rpcs.includes("record_ai_usage"), "not recorded twice: the chat message records it");
  const told = JSON.parse(out.text);
  assertEquals(told.status, "shown");
  assertEquals(told.calendar_checked, false);
  assert(told.message.includes("never add a place"));

  // A name the model tries to pass is refused before anything runs.
  const bad = await outingForChat(s.deps, ctx, { kind: "family", date: "2026-10-24", names: ["Lea"] });
  assert(bad.isError);
  // An older app: the model words the plan, no card.
  const old = await outingForChat(setup(ANSWER).deps, { ...ctx, can: false }, { kind: "date", date: "2026-10-23" });
  assertEquals(old.events, []);
});

Deno.test("plan_outing: the day's calendar from the chat is used for that day only", async () => {
  const s = setup(ANSWER);
  const events = {
    date: "2026-10-23",
    list: [{ key: "e0", title: "Parents evening", start: "2026-10-23T19:00", end: "2026-10-23T20:00", all_day: false, calendar: "Family" }],
  };
  const ctx = { db: s.account.client(), userId: "u", tz: "Asia/Beirut", can: true, events };
  const out = await outingForChat(s.deps, ctx, { kind: "date", date: "2026-10-23" });
  assertEquals(JSON.parse(out.text).calendar_checked, true);
  assert(JSON.stringify(s.prompts.at(-1)!.messages).includes("Parents evening"));
  const other = setup(ANSWER);
  const out2 = await outingForChat(other.deps, { ...ctx, db: other.account.client() }, { kind: "date", date: "2026-10-30" });
  assertEquals(JSON.parse(out2.text).calendar_checked, false);
  assertFalse(JSON.stringify(other.prompts.at(-1)!.messages).includes("Parents evening"));
});

Deno.test("plan_outing: not Pro and no places are said plainly, with nothing made", async () => {
  const s = setup(ANSWER);
  s.account.world.plan = "free";
  const out = await outingForChat(s.deps, { db: s.account.client(), userId: "u", tz: "Asia/Beirut", can: true }, { kind: "date", date: "2026-10-23" });
  assertEquals(JSON.parse(out.text).status, "pro_required");
  assertEquals(out.events, []);
  assertEquals(s.prompts.length, 0);
});
