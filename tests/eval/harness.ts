// Runs one evaluation case: a fresh pretend account (world.ts), Wilma's real MCP tools on top
// of it (same descriptions, same server-side checks such as rule 9), connected in memory, and
// the conversation loop the chat function will use: model -> tool calls -> results -> model,
// until the model answers. The chat-only actions (chat/actions.ts: show_places, ask_for_location)
// run here exactly as in the chat function. Records every tool call, event and reply for grading.
// The phone's calendar (chat/agenda.ts): when the model calls get_day_agenda, the harness plays the
// app: it reads the case's calendar for those days and sends the question again with it, as the
// chat function receives it, with the day planner's numbers for one day (chat/day.ts planForChat;
// Pro cases only, with fake drive times and weather: no Mapbox or NWS request is made).
import { ACTION_NAMES, ACTION_SPECS, ChatActions } from "../../supabase/functions/chat/actions.ts";
import {
  type Agenda, type AgendaEvent, AGENDA_TOOL, agendaCall, agendaSchema, withAgenda,
} from "../../supabase/functions/chat/agenda.ts";
import { connectTools } from "../../supabase/functions/chat/tools.ts";
import { type ChatPlan, planForChat } from "../../supabase/functions/chat/day.ts";
import type { DriveTimes } from "../../supabase/functions/_shared/dayplan/plan.ts";
import type { Weather } from "../../supabase/functions/_shared/dayplan/nws.ts";
import type { ToolContext } from "../../supabase/functions/mcp/tools/_shared.ts";
import { ALL_TOOLS } from "../../supabase/functions/mcp/tools/all.ts";
import {
  type LlmAdapter, LlmError, type Message, type ModelConfig, type StopReason, type StreamEvent,
  type ToolResult, type ToolSpec,
} from "../../supabase/functions/_shared/llm/index.ts";
import { World } from "./world.ts";
import { type SharedPoint, systemPrompt } from "../../supabase/functions/_shared/assistant_prompt.ts";

export { ALL_TOOLS };

// The tools run outside the Edge runtime here: stand in for its globals. Embeddings are not
// what the evaluation measures (world.ts searches by keyword), so any vector will do.
const g = globalThis as Record<string, unknown>;
g.Supabase ??= {
  ai: {
    Session: class {
      run() {
        return Promise.resolve(new Array(384).fill(0.05));
      }
    },
  },
};
g.EdgeRuntime ??= { waitUntil: (p: Promise<unknown>) => void p.catch(() => {}) };
if (!Deno.env.get("SUPABASE_URL")) Deno.env.set("SUPABASE_URL", "http://eval.invalid");
// Background "embed pending" requests go nowhere; every other request (the model APIs) is untouched.
const realFetch = globalThis.fetch;
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url = input instanceof Request ? input.url : String(input);
  if (url.startsWith("http://eval.invalid/")) return Promise.resolve(new Response(null, { status: 202 }));
  return realFetch(input, init);
}) as typeof fetch;

export interface ToolCallRecord {
  name: string;
  args: Record<string, unknown>;
  /** false: the server accepted it (and acted); true: refused or failed, nothing changed. */
  isError: boolean;
  result: string;
}

export interface TurnRecord {
  user: string;
  /** Everything the model said to the user during this turn. */
  reply: string;
  toolCalls: ToolCallRecord[];
  /** What the chat function would have sent the app from the actions (place cards, 📍 card). */
  events: Record<string, unknown>[];
  stop: StopReason;
}

export interface RunRecord {
  turns: TurnRecord[];
  world: World;
  costCents: number;
  modelCalls: number;
  ms: number;
  /** A failed model call (network, rate limit, bad configuration): not a model mistake. */
  error?: string;
  /** LlmError.code and HTTP status of that failure, e.g. quota_exceeded. */
  errorCode?: string;
  errorStatus?: number;
}

export interface Session {
  world: World;
  tools: ToolSpec[];
  system: string;
  call(name: string, args: Record<string, unknown>): Promise<{ isError: boolean; text: string }>;
  /** The chat-only actions for one user message, as the chat function makes them. */
  actions(): ChatActions;
  close(): Promise<void>;
}

/** A fresh pretend account with Wilma's tools connected to it, exactly as the chat function connects them. */
export async function openSession(world = new World(), here?: SharedPoint, timeZone?: string): Promise<Session> {
  const ctx: ToolContext = {
    db: world.client(), userId: "eval-user", accessToken: "eval-token", assistantName: world.assistantName,
    distanceUnit: world.distanceUnit,
    log: () => {}, // the pretend account's tool log lines would only clutter the run's output
  };
  const tools = await connectTools(ctx, "eval");
  return {
    world,
    // As the chat function: the MCP tools plus the chat-only actions.
    tools: [...tools.specs, ...ACTION_SPECS],
    // `here`: the 📍 location the chat function adds to a message's instructions (places step 7).
    system: systemPrompt(ctx.assistantName, tools.instructions, new Date(), here, timeZone),
    call: tools.call,
    actions: () => new ChatActions({ db: ctx.db, distanceUnit: ctx.distanceUnit ?? "mi", here }),
    close: tools.close,
  };
}

export interface RunOptions {
  /** Model calls allowed per user turn before giving up (a runaway loop fails the case). */
  maxStepsPerTurn?: number;
  setup?: (w: World) => void;
  /** The phone's location shared with the messages (📍), as the chat function passes it. */
  here?: SharedPoint;
  /** The phone's calendar (the ticked calendars, already trimmed by the app) and time zone. Without
   * it the app is an older one that cannot read the calendar. */
  calendar?: PhoneCalendar;
  /** Fake drive times and weather for the day planner (a Pro case sets world.plan in setup). */
  planner?: { drives?: DriveTimes; weather?: Weather };
}

export interface PhoneCalendar {
  time_zone: string;
  /** How many calendars are ticked; 0 reads as "nothing chosen". */
  calendars?: number;
  events: AgendaEvent[];
}

/** What the app sends back for an agenda_request: the events that touch those days. */
export function readCalendar(cal: PhoneCalendar, from: string, to: string): Agenda {
  const events = cal.events.filter((e) => e.start.slice(0, 10) <= to && e.end.slice(0, 10) >= from);
  // Checked as the chat function checks what the app sends.
  return agendaSchema.parse({ from, to, time_zone: cal.time_zone, calendars: cal.calendars ?? 1, events });
}

/** Play the user's messages to the model, running its tool calls, and record everything. */
export async function runConversation(
  adapter: LlmAdapter,
  model: ModelConfig,
  userTurns: string[],
  opts: RunOptions = {},
): Promise<RunRecord> {
  const world = new World();
  opts.setup?.(world);
  const session = await openSession(world, opts.here, opts.calendar?.time_zone);
  const started = performance.now();
  const record: RunRecord = { turns: [], world, costCents: 0, modelCalls: 0, ms: 0 };
  const messages: Message[] = [];
  try {
    for (const user of userTurns) {
      messages.push({ role: "user", content: user });
      const turn: TurnRecord = { user, reply: "", toolCalls: [], events: [], stop: "other" };
      record.turns.push(turn);
      const actions = session.actions();
      const asked = messages.length; // the conversation as the app sends it, ending with this message
      let agenda: Agenda | undefined;
      let plan: ChatPlan | undefined;
      for (let step = 0; ; step++) {
        if (step >= (opts.maxStepsPerTurn ?? 8)) {
          turn.stop = "other";
          turn.reply += "\n[evaluation: too many tool rounds, stopped]";
          break;
        }
        let done: Extract<StreamEvent, { type: "done" }> | undefined;
        for await (const ev of adapter.stream(model, { system: session.system, messages, tools: session.tools })) {
          if (ev.type === "done") done = ev;
        }
        record.modelCalls += 1;
        if (!done) throw new Error("the model stream ended without a final turn");
        record.costCents += done.usage.costCents;
        messages.push(done.turn);
        if (done.turn.text) turn.reply += (turn.reply ? "\n" : "") + done.turn.text;
        turn.stop = done.stop;
        if (done.stop !== "tool_calls") break;

        const results: ToolResult[] = [];
        let request: { from: string; to: string } | undefined;
        for (const c of done.turn.toolCalls) {
          let out: { isError: boolean; text: string };
          if (c.invalidInput) {
            out = { isError: true, text: "The tool arguments were not a JSON object." };
          } else if (c.name === AGENDA_TOOL) {
            const a = agendaCall(c.input, !!opts.calendar, agenda, plan);
            if (a.request && !request) {
              turn.events.push(a.request);
              request = a.request;
            }
            out = { isError: !!a.result.isError, text: a.result.content };
          } else if (ACTION_NAMES.has(c.name)) {
            const a = await actions.run(c.name, c.input);
            turn.events.push(...a.events);
            out = a;
          } else {
            out = await session.call(c.name, c.input);
          }
          turn.toolCalls.push({ name: c.name, args: c.input, isError: out.isError, result: out.text });
          results.push({ callId: c.id, content: out.text, isError: out.isError });
        }
        messages.push({ role: "tool", results });
        if (request && opts.calendar) {
          // The app reads those days and sends the same conversation again, with the calendar.
          agenda = readCalendar(opts.calendar, request.from, request.to);
          // As the chat function: the planner for one day (Pro), its numbers with the calendar.
          plan = await planForChat({
            clientFor: () => world.client(),
            drives: () => opts.planner?.drives ?? null,
            weather: () => opts.planner?.weather ?? null,
            log: () => {},
          }, world.client(), "eval-user", agenda);
          if (plan.made) turn.events.push({ type: "day_plan", date: agenda.from });
          messages.splice(asked, messages.length - asked, ...withAgenda([], agenda, plan));
        }
      }
    }
  } catch (e) {
    record.error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    if (e instanceof LlmError) {
      record.errorCode = e.code;
      record.errorStatus = e.status;
    }
  } finally {
    record.ms = performance.now() - started;
    await session.close();
  }
  return record;
}
