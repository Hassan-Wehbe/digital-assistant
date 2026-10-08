// The day planner (supabase/functions/_shared/dayplan/plan.ts; docs/phase6-day-planner-step2-plan.md):
// leave-by times with the parking buffer, overlaps and Take both, going home between events or not,
// free gaps, tasks placed or not, task options, and a plan that still comes out without drive times.
// Drive times here are a fake: fixed minutes per pair of places, so every number can be checked.
import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  BUFFER_MIN, type DriveTimes, freeGaps, fromMin, type PlanEvent, type PlanPlace, planDay, type Row, toMin,
} from "../../supabase/functions/_shared/dayplan/plan.ts";

const DATE = "2026-10-09";
const TZ = "America/New_York";
const HOME: PlanPlace = { label: "Home", lat: 28.6500, lng: -81.2000 };
const POOL: PlanPlace = { label: "Aquatic Center", lat: 28.6700, lng: -81.2300 };
const SUSHI: PlanPlace = { label: "Hinode Sushi", lat: 28.6000, lng: -81.2500 };
const CLEANERS: PlanPlace = { label: "Bright Cleaners", lat: 28.6720, lng: -81.2280 };

/** Fixed minutes by destination label pair; a request a test did not expect fails loudly. */
function fakeDrives(table: Record<string, number>, calls: string[] = []): DriveTimes {
  const name = (p: { lat: number; lng: number }) =>
    [HOME, POOL, SUSHI, CLEANERS].find((x) => x.lat === p.lat && x.lng === p.lng)?.label ?? "?";
  return {
    leg(from, to, departLocal) {
      const k = `${name(from)}>${name(to)}`;
      calls.push(`${k}@${departLocal}`);
      if (!(k in table)) throw new Error(`no fake drive for ${k}`);
      return Promise.resolve({ minutes: table[k], typical_minutes: k === "Home>Aquatic Center" ? 10 : table[k] });
    },
  };
}

const ev = (key: string, title: string, start: string, end: string, place?: PlanPlace, more: Partial<PlanEvent> = {}): PlanEvent =>
  ({ key, title, start: `${DATE}T${start}`, end: `${DATE}T${end}`, all_day: false, place, ...more });

const of = <K extends Row["kind"]>(rows: Row[], kind: K) => rows.filter((r): r is Extract<Row, { kind: K }> => r.kind === kind);

const DRIVES = {
  "Home>Aquatic Center": 15, "Aquatic Center>Home": 12, "Home>Hinode Sushi": 18, "Hinode Sushi>Home": 18,
  "Home>Bright Cleaners": 14, "Bright Cleaners>Home": 14, "Aquatic Center>Bright Cleaners": 3, "Bright Cleaners>Aquatic Center": 3,
  "Bright Cleaners>Hinode Sushi": 20,
};

Deno.test("toMin / fromMin: local times as minutes from the day's midnight, across midnight too", () => {
  assertEquals(toMin(DATE, `${DATE}T16:30`), 990);
  assertEquals(toMin(DATE, "2026-10-10T00:30"), 1470);
  assertEquals(toMin(DATE, "2026-10-08T23:00"), -60);
  assertEquals(toMin(DATE, DATE), 0);
  assertEquals(toMin(DATE, "4:30 pm"), null);
  assertEquals(fromMin(DATE, 990), `${DATE}T16:30`);
  assertEquals(fromMin(DATE, 1470), "2026-10-10T00:30");
});

Deno.test("freeGaps: only gaps of 30 minutes or more, busy times merged", () => {
  assertEquals(freeGaps([[480, 540], [530, 600], [620, 700]], 420, 800), [[420, 480], [700, 800]]);
  assertEquals(freeGaps([], 420, 440), []);
});

Deno.test("the swim example: leave at 4:10 for 4:30 (15 min with traffic + 5 to park), the overlap offers Take both", async () => {
  const plan = await planDay({
    date: DATE, tz: TZ, home: HOME, tasks: [], drives: fakeDrives(DRIVES),
    events: [
      ev("sara", "Swim: Sara", "16:30", "18:30", POOL),
      ev("adam", "Swim: Adam", "17:00", "19:00", POOL),
    ],
  });
  const drives = of(plan.rows, "drive");
  assertEquals(drives[0], {
    kind: "drive", from: "Home", to: "Aquatic Center", for_keys: ["sara"], leave_at: `${DATE}T16:10`, arrive_by: `${DATE}T16:30`,
    minutes: 15, typical_minutes: 10, buffer_min: BUFFER_MIN,
  });
  // Adam's swim is at the same pool: no second drive there, and home at the end.
  assertEquals(drives.map((d) => `${d.from}>${d.to}`), ["Home>Aquatic Center", "Aquatic Center>Home"]);
  assertEquals(drives[1].leave_at, `${DATE}T19:00`);
  const [overlap] = of(plan.rows, "overlap");
  assertEquals(overlap, {
    kind: "overlap", keys: ["sara", "adam"], start: `${DATE}T17:00`, end: `${DATE}T18:30`, minutes: 90, same_place: true, suggestion: "take_both",
  });
  assertEquals(plan.drive_times, "available");
});

Deno.test("Take both: one trip for the earliest start, no overlap left, both events say who they go with", async () => {
  const plan = await planDay({
    date: DATE, tz: TZ, home: HOME, tasks: [], drives: fakeDrives(DRIVES), choices: { together: [["sara", "adam"]] },
    events: [ev("sara", "Swim: Sara", "16:30", "18:30", POOL), ev("adam", "Swim: Adam", "17:00", "19:00", POOL)],
  });
  assertEquals(of(plan.rows, "overlap"), []);
  const drives = of(plan.rows, "drive");
  assertEquals(drives[0].for_keys, ["sara", "adam"]);
  assertEquals(drives[0].leave_at, `${DATE}T16:10`);
  assertEquals(drives[1].leave_at, `${DATE}T19:00`, "pick up both at the later end");
  assertEquals(of(plan.rows, "event").map((e) => e.together_with), [["adam"], ["sara"]]);
});

Deno.test("overlap at two different places: flagged, no fix offered", async () => {
  const plan = await planDay({
    date: DATE, tz: TZ, home: HOME, tasks: [], drives: fakeDrives(DRIVES),
    events: [ev("a", "Lunch with Sam", "12:30", "13:30", SUSHI), ev("b", "Swim", "13:00", "14:00", POOL)],
  });
  const [o] = of(plan.rows, "overlap");
  assertEquals(o.same_place, false);
  assertEquals(o.suggestion, undefined);
});

Deno.test("between two events: home when there is time for it, straight on (and tight) when not", async () => {
  const long = await planDay({
    date: DATE, tz: TZ, home: HOME, tasks: [], drives: fakeDrives(DRIVES),
    events: [ev("lunch", "Lunch", "12:30", "13:30", SUSHI), ev("swim", "Swim", "16:30", "17:30", POOL)],
  });
  assertEquals(of(long.rows, "drive").map((d) => `${d.from}>${d.to}@${d.leave_at?.slice(11)}`), [
    "Home>Hinode Sushi@12:07", "Hinode Sushi>Home@13:30", "Home>Aquatic Center@16:10", "Aquatic Center>Home@17:30",
  ]);
  const short = await planDay({
    date: DATE, tz: TZ, home: HOME, tasks: [], drives: fakeDrives({ ...DRIVES, "Hinode Sushi>Aquatic Center": 25 }),
    events: [ev("lunch", "Lunch", "12:30", "13:30", SUSHI), ev("swim", "Swim", "13:45", "14:30", POOL)],
  });
  const drives = of(short.rows, "drive");
  assertEquals(drives.map((d) => `${d.from}>${d.to}`), ["Home>Hinode Sushi", "Hinode Sushi>Aquatic Center", "Aquatic Center>Home"]);
  assertEquals(drives[1].leave_at, `${DATE}T13:15`);
  assertEquals(drives[1].tight, true, "leaving before lunch ends");
});

Deno.test("no drive: video calls, Not a trip, Not driving, private events; a place to ask for when only text", async () => {
  const calls: string[] = [];
  const plan = await planDay({
    date: DATE, tz: TZ, home: HOME, tasks: [], drives: fakeDrives(DRIVES, calls), choices: { not_driving: ["swim"] },
    events: [
      ev("call", "Design review", "10:00", "11:00"),
      ev("dentist", "Dentist", "14:00", "14:45", undefined, { location: "Dr. Lee" }),
      ev("home", "Plumber", "09:00", "10:00", undefined, { location: "at home", not_a_trip: true }),
      ev("swim", "Swim", "16:30", "17:30", POOL),
      ev("therapy", "Therapy", "18:00", "19:00", SUSHI, { busy_only: true }),
    ],
  });
  assertEquals(of(plan.rows, "drive"), []);
  assertEquals(calls, [], "no drive time asked for");
  const events = of(plan.rows, "event");
  assertEquals(events.find((e) => e.key === "dentist")?.needs_place, true);
  assertEquals(events.find((e) => e.key === "home")?.needs_place, undefined);
  const therapy = events.find((e) => e.key === "therapy")!;
  assertEquals([therapy.title, therapy.private, therapy.place], ["Busy", true, undefined], "a private event: no title, no place");
});

Deno.test("declined and all-day events: not driven to, all-day listed apart", async () => {
  const plan = await planDay({
    date: DATE, tz: TZ, home: HOME, tasks: [], drives: fakeDrives(DRIVES),
    events: [
      ev("x", "Swim", "16:30", "17:30", POOL, { declined: true }),
      { key: "bday", title: "Mum's birthday", start: DATE, end: DATE, all_day: true },
    ],
  });
  assertEquals(of(plan.rows, "event"), []);
  assertEquals(plan.all_day, [{ key: "bday", title: "Mum's birthday" }]);
});

Deno.test("without drive times (until step 3) or without Home, the plan still comes out and says why", async () => {
  const noTimes = await planDay({ date: DATE, tz: TZ, home: HOME, tasks: [], drives: null, events: [ev("s", "Swim", "16:30", "17:30", POOL)] });
  assertEquals(noTimes.drive_times, "unavailable");
  assertEquals(of(noTimes.rows, "drive")[0].unavailable, "no_drive_times");
  assertEquals(of(noTimes.rows, "drive")[0].arrive_by, `${DATE}T16:30`);
  const noHome = await planDay({ date: DATE, tz: TZ, home: null, tasks: [], drives: fakeDrives(DRIVES), events: [ev("s", "Swim", "16:30", "17:30", POOL)] });
  assertEquals(noHome.home, { set: false });
  assertEquals(of(noHome.rows, "drive")[0].unavailable, "no_home");
  // A provider that fails: that drive says unavailable, the rest of the plan stands.
  const broken = await planDay({
    date: DATE, tz: TZ, home: HOME, tasks: [], events: [ev("s", "Swim", "16:30", "17:30", POOL)],
    drives: { leg: () => Promise.reject(new Error("down")) },
  });
  assertEquals(of(broken.rows, "drive")[0].unavailable, "no_drive_times");
});

Deno.test("free gaps start from now, and drives and events are not free", async () => {
  const plan = await planDay({
    date: DATE, tz: TZ, home: HOME, tasks: [], drives: fakeDrives(DRIVES), now: `${DATE}T13:00`,
    events: [ev("s", "Swim", "16:30", "17:30", POOL)],
  });
  assertEquals(of(plan.rows, "free").map((f) => `${f.start.slice(11)}-${f.end.slice(11)}`), ["13:00-16:10", "17:42-22:00"]);
});

Deno.test("tasks: one planned at its time, others not placed (overdue marked)", async () => {
  const plan = await planDay({
    date: DATE, tz: TZ, home: HOME, drives: fakeDrives(DRIVES), events: [],
    tasks: [
      { id: "t1", title: "Pick up dry cleaning", priority: "normal", duration_min: 20, planned_at: `${DATE}T17:05`, place: CLEANERS },
      { id: "t2", title: "Pay the water bill", priority: "important", due_on: "2026-10-07" },
      { id: "t3", title: "Call the insurance", priority: "normal", planned_at: "2026-10-10T09:00" },
    ],
  });
  assertEquals(of(plan.rows, "task"), [{
    kind: "task", id: "t1", title: "Pick up dry cleaning", start: `${DATE}T17:05`, end: `${DATE}T17:25`, place: "Bright Cleaners",
  }]);
  assertEquals(plan.tasks_not_placed, [
    { id: "t2", title: "Pay the water bill", priority: "important", due_on: "2026-10-07", overdue: true },
    { id: "t3", title: "Call the insurance", priority: "normal" },
  ]);
});

Deno.test("task options: on the way to swim first (least extra driving), then free time, at most three", async () => {
  const plan = await planDay({
    date: DATE, tz: TZ, home: HOME, drives: fakeDrives(DRIVES), now: `${DATE}T12:00`, optionsFor: "t1",
    events: [ev("sara", "Swim: Sara", "16:30", "18:30", POOL)],
    tasks: [{ id: "t1", title: "Pick up dry cleaning", priority: "normal", duration_min: 20, place: CLEANERS }],
  });
  const opts = plan.options!.options;
  assert(opts.length > 0 && opts.length <= 3);
  // Home → cleaners (14) → pool (3) instead of home → pool (15): 2 extra minutes of driving, 20 at the cleaners.
  assertEquals(opts[0], {
    kind: "on_the_way", start: `${DATE}T16:02`, end: `${DATE}T16:22`, extra_drive_min: 2,
    for_keys: ["sara"], leave_at: `${DATE}T15:48`, was_leave_at: `${DATE}T16:10`,
  });
  assert(opts.slice(1).every((o) => o.extra_drive_min >= opts[0].extra_drive_min), "ranked by extra driving");
  assert(opts.every((o) => o.start >= `${DATE}T12:00`), "nothing before now");
});

Deno.test("task options without a place: any free gap that holds it; none fits: a note", async () => {
  const plan = await planDay({
    date: DATE, tz: TZ, home: HOME, drives: null, now: `${DATE}T21:50`, optionsFor: "t",
    events: [], tasks: [{ id: "t", title: "Call the insurance", priority: "normal", duration_min: 15 }],
  });
  assertEquals(plan.options?.options, []);
  assertEquals(plan.options?.note, "No free time today that fits it.");
  const morning = await planDay({
    date: DATE, tz: TZ, home: HOME, drives: null, now: `${DATE}T08:00`, optionsFor: "t",
    events: [], tasks: [{ id: "t", title: "Call the insurance", priority: "normal", duration_min: 15 }],
  });
  assertEquals(morning.options?.options[0], { kind: "free_time", start: `${DATE}T08:00`, end: `${DATE}T08:15`, extra_drive_min: 0 });
});

Deno.test("a drive-time provider only ever gets points and a time, never a title", async () => {
  const seen: unknown[] = [];
  await planDay({
    date: DATE, tz: TZ, home: HOME, tasks: [], events: [ev("s", "Swim: Sara (secret meet-up)", "16:30", "17:30", POOL)],
    drives: { leg: (...args) => (seen.push(args), Promise.resolve({ minutes: 10 })) },
  });
  assert(seen.length > 0);
  assert(!JSON.stringify(seen).includes("Swim"), JSON.stringify(seen));
  assert(!JSON.stringify(seen).includes("Aquatic"), "not even the place's label");
});
