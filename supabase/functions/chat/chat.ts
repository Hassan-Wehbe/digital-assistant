// The chat function's logic (docs/phase5-a5b-chat-function-plan.md, "How it works"). index.ts
// wires it to Supabase and the configured model; the tests (tests/deno/chat_test.ts) wire it to
// the evaluation's pretend account and a scripted model.
//
// Request:  POST, Authorization: Bearer <the user's Supabase access token>,
//           {"messages": [{"role": "user" | "assistant", "content": "..."}, ...]}
//           The app keeps the thread and sends the recent part, ending with the new user message.
//           Nothing about the conversation is stored on the server.
// Response: 401 without a valid sign-in, 400 for a malformed body, otherwise a stream of
//           newline-delimited JSON events (application/x-ndjson):
//             {"type":"notice","code":"allowance_low","message":...}   heads-up at 80%
//             {"type":"status","tool":...,"text":"Searching your notes…"}
//             {"type":"text","text":...}                              reply, as it is written
//             {"type":"confirm",...}                                  delete card (confirm.ts)
//             {"type":"vault","action":"reveal"|"enter","secret_id":...,"name":...,"secret_type":...,
//              "new_secret":bool,"link":...}
//             {"type":"error","code":"allowance_used"|"service_paused"|"connection","message":...}
//             {"type":"done","counted":true|false}                    always last
//
// A body {"classify": "..."} is the one box's classifier instead (classify.ts): a plain JSON
// answer, not a stream.
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { systemPrompt } from "../_shared/assistant_prompt.ts";
import { type Llm, LlmError, type Message, QUOTA_EXCEEDED, RoutesConfigError, type ToolResult } from "../_shared/llm/index.ts";
import { loadAssistantName } from "../mcp/lib/assistant.ts";
import { classify, classifyBody, type ClassifyLog } from "./classify.ts";
import { CONFIRM_TOOLS, confirmCard } from "./confirm.ts";
import {
  ALLOWANCE_LOW, allowanceUsed, type ChatErrorCode, ERROR_TEXT, STATUS, STATUS_DEFAULT, TOO_MANY_STEPS,
} from "./messages.ts";
import { connectTools, type ToolSession } from "./tools.ts";

/** Model calls per message, as in the evaluation (tests/eval/harness.ts). */
export const MAX_ROUNDS = 8;
/** Recent messages used from what the app sends. */
export const MAX_HISTORY = 20;
export const MAX_MESSAGE_CHARS = 20_000;
/** Heads-up from this share of the monthly allowance. */
export const ALLOWANCE_WARN = 0.8;
/** Password retrieval never counts (D22): a message whose only tool calls are these is free. */
export const VAULT_LOOKUPS = new Set(["find_secret", "get_secret"]);
/** record_ai_usage() refuses more than this per call. */
const MAX_RECORD_CENTS = 100;

/** One log line: codes, ids and counts only, never conversation text (CLAUDE.md, plan step 7). */
export interface LogEntry {
  event: "chat";
  request: string;
  user: string;
  outcome: "ok" | ChatErrorCode | "client_closed" | "bad_request";
  /** Machine code of a failure: llm:<code>, db:<code>, routes_config, or an error class name. */
  code?: string;
  status?: number;
  model_calls: number;
  tools: string[];
  cost_cents: number;
  counted: boolean;
  usage_recorded?: boolean;
}

export interface ChatDeps {
  /** The user id for a valid, unexpired access token; null otherwise. */
  verifyToken(token: string): Promise<string | null>;
  /** A database client acting as that user (RLS applies; never the service-role key). */
  clientFor(token: string): SupabaseClient;
  /** The configured model routes. May throw RoutesConfigError (LLM_ROUTES missing or invalid). */
  llm(): Pick<Llm, "stream">;
  log(entry: LogEntry | ClassifyLog): void;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
};

const bodySchema = z.object({
  messages: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string().max(MAX_MESSAGE_CHARS),
  })).min(1).max(200),
});

function jsonError(status: number, error: string, detail: string): Response {
  return Response.json({ error, error_description: detail }, { status, headers: CORS });
}

/** The recent conversation as model messages: at most MAX_HISTORY, starting with the user. */
export function toMessages(history: z.infer<typeof bodySchema>["messages"]): Message[] | null {
  const recent = history.slice(-MAX_HISTORY);
  while (recent.length && recent[0].role !== "user") recent.shift();
  const last = recent.at(-1);
  if (!last || last.role !== "user" || !last.content.trim()) return null;
  return recent.map((m) =>
    m.role === "user"
      ? { role: "user", content: m.content }
      : { role: "assistant", text: m.content, toolCalls: [] }
  );
}

export function createHandler(deps: ChatDeps): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    const token = (req.headers.get("Authorization") ?? "").match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) return jsonError(401, "unauthorized", "sign-in required");
    const userId = await deps.verifyToken(token);
    if (!userId) return jsonError(401, "unauthorized", "invalid or expired token");
    if (req.method !== "POST") return jsonError(405, "method_not_allowed", "use POST");

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      raw = null;
    }
    if (raw && typeof raw === "object" && "classify" in raw) {
      const body = classifyBody.safeParse(raw);
      if (!body.success) return jsonError(400, "bad_request", "send {classify: \"...\"} (1-500 characters)");
      const verdict = await classify(deps, token, userId, body.data.classify, req.signal);
      return Response.json(verdict, { headers: { ...CORS, "Cache-Control": "no-store" } });
    }
    const parsed = bodySchema.safeParse(raw);
    const messages = parsed.success ? toMessages(parsed.data.messages) : null;
    if (!messages) {
      deps.log({
        event: "chat", request: crypto.randomUUID(), user: userId, outcome: "bad_request",
        model_calls: 0, tools: [], cost_cents: 0, counted: false,
      });
      return jsonError(400, "bad_request", "send {messages: [...]} ending with the user's message");
    }

    const abort = new AbortController();
    req.signal?.addEventListener("abort", () => abort.abort());
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        let finished = false;
        const emit = (event: Record<string, unknown>) => {
          if (event.type === "done") finished = true;
          if (abort.signal.aborted) return;
          try {
            controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
          } catch {
            abort.abort(); // the app went away
          }
        };
        try {
          await runChat({ deps, token, userId, messages, emit, signal: abort.signal });
        } catch (e) {
          // Last resort (e.g. the database client threw): the app still gets an answer and an end.
          if (!finished) {
            emit({ type: "error", code: "connection", message: ERROR_TEXT.connection });
            emit({ type: "done", counted: false });
            deps.log({
              event: "chat", request: crypto.randomUUID(), user: userId, outcome: "connection",
              code: e instanceof Error ? e.name : "unknown", model_calls: 0, tools: [], cost_cents: 0, counted: false,
            });
          }
        }
        try {
          controller.close();
        } catch { /* already closed by the client */ }
      },
      cancel() {
        abort.abort();
      },
    });
    return new Response(body, {
      headers: { ...CORS, "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
    });
  };
}

interface Allowance {
  month: string;
  used_fraction: number;
}

interface RunArgs {
  deps: ChatDeps;
  token: string;
  userId: string;
  messages: Message[];
  emit: (event: Record<string, unknown>) => void;
  signal: AbortSignal;
}

/** Vault links a tool result handed out, with the secret's id, so the app opens its own vault. */
export function vaultEvents(tool: string, resultText: string): Record<string, unknown>[] {
  if (tool !== "get_secret" && tool !== "save_secret" && tool !== "update_secret") return [];
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(resultText);
  } catch {
    return [];
  }
  const secret = data.secret as { id?: unknown; name?: unknown; secret_type?: unknown } | undefined;
  if (!secret || typeof secret.id !== "string") return [];
  const link = typeof data.reveal_link === "string" ? data.reveal_link : data.entry_link;
  if (typeof link !== "string") return [];
  return [{
    type: "vault",
    action: typeof data.reveal_link === "string" ? "reveal" : "enter",
    secret_id: secret.id,
    name: typeof secret.name === "string" ? secret.name : null,
    // So the app can open its own entry screen for the right kind of secret (A5c step 6).
    secret_type: typeof secret.secret_type === "string" ? secret.secret_type : null,
    // save_secret's id is for a secret that exists only once its value is entered, so the app
    // opens "save a new secret" for it, not "change the value" (which needs an existing one).
    new_secret: tool === "save_secret",
    link,
    expires_at: data.expires_at ?? null,
  }];
}

async function runChat({ deps, token, userId, messages, emit, signal }: RunArgs): Promise<void> {
  const log: LogEntry = {
    event: "chat", request: crypto.randomUUID(), user: userId, outcome: "ok",
    model_calls: 0, tools: [], cost_cents: 0, counted: false,
  };
  const fail = (outcome: ChatErrorCode, code: string, status?: number) => {
    log.outcome = outcome;
    log.code = code;
    if (status !== undefined) log.status = status;
    if (outcome !== "allowance_used") emit({ type: "error", code: outcome, message: ERROR_TEXT[outcome] });
  };
  const db = deps.clientFor(token);

  // 1. The allowance, before any model call.
  const { data: allowance, error: allowanceError } = await db.rpc("my_ai_allowance");
  if (allowanceError || !allowance) {
    fail("connection", `db:${allowanceError?.code ?? "no_allowance"}`);
    emit({ type: "done", counted: false });
    deps.log(log);
    return;
  }
  const before = allowance as Allowance;
  if (Number(before.used_fraction) >= 1) {
    fail("allowance_used", "allowance_used");
    emit({ type: "error", code: "allowance_used", message: allowanceUsed(String(before.month)) });
    emit({ type: "done", counted: false });
    deps.log(log);
    return;
  }
  if (Number(before.used_fraction) >= ALLOWANCE_WARN) {
    emit({ type: "notice", code: "allowance_low", message: ALLOWANCE_LOW, used_fraction: before.used_fraction });
  }

  // 2. The conversation loop: model, tool calls, results, model (as tests/eval/harness.ts).
  let tools: ToolSession | null = null;
  try {
    const llm = deps.llm();
    const assistantName = await loadAssistantName(db, userId);
    tools = await connectTools({ db, userId, accessToken: token, assistantName });
    const system = systemPrompt(assistantName, tools.instructions);
    const cards = new Set<string>();
    let lastStatus = "";
    let wrote = false; // text already sent this message: the next round's text starts a new paragraph
    for (let round = 0;; round++) {
      if (round >= MAX_ROUNDS) {
        emit({ type: "text", text: (wrote ? "\n\n" : "") + TOO_MANY_STEPS });
        log.code = "too_many_rounds";
        break;
      }
      let done;
      let roundWrote = false;
      for await (const ev of llm.stream("default", { system, messages, tools: tools.specs, signal })) {
        if (ev.type === "done") {
          done = ev;
        } else if (ev.text) {
          emit({ type: "text", text: (wrote && !roundWrote ? "\n\n" : "") + ev.text });
          wrote = roundWrote = true;
        }
      }
      if (!done) throw new Error("the model stream ended without a final turn");
      log.model_calls += 1;
      log.cost_cents += done.usage.costCents;
      messages.push(done.turn);
      if (done.stop !== "tool_calls") break;

      const results: ToolResult[] = [];
      for (const call of done.turn.toolCalls) {
        log.tools.push(call.name);
        if (call.invalidInput) {
          results.push({ callId: call.id, content: "The tool arguments were not a JSON object.", isError: true });
          continue;
        }
        if (CONFIRM_TOOLS.has(call.name)) {
          // Never run here: the app asks the user and runs it itself.
          const outcome = await confirmCard(call.name, call.input, tools, db);
          if (!outcome.card) {
            results.push({ callId: call.id, content: outcome.error, isError: true });
            continue;
          }
          const key = `${outcome.card.tool}:${outcome.card.target.id}`;
          if (!cards.has(key)) emit(outcome.card as unknown as Record<string, unknown>);
          cards.add(key);
          results.push({ callId: call.id, content: outcome.toModel });
          continue;
        }
        const status = STATUS[call.name] ?? STATUS_DEFAULT;
        if (status !== lastStatus) emit({ type: "status", tool: call.name, text: status });
        lastStatus = status;
        const out = await tools.call(call.name, call.input);
        if (!out.isError) for (const ev of vaultEvents(call.name, out.text)) emit(ev);
        results.push({ callId: call.id, content: out.text, isError: out.isError });
      }
      messages.push({ role: "tool", results });
      lastStatus = "";
    }
  } catch (e) {
    if (signal.aborted) {
      log.outcome = "client_closed";
    } else if (e instanceof LlmError) {
      const paused = e.code === QUOTA_EXCEEDED || e.code === "api_key_not_set";
      fail(paused ? "service_paused" : "connection", `llm:${e.code}`, e.status);
    } else if (e instanceof RoutesConfigError) {
      fail("service_paused", "routes_config");
    } else {
      // The class name only: an error's message can quote the conversation.
      fail("connection", e instanceof Error ? e.name : "unknown");
    }
  } finally {
    await tools?.close().catch(() => {});
  }

  // 3. Usage: every message that used the model, except vault-only ones.
  const vaultOnly = log.tools.length > 0 && log.tools.every((t) => VAULT_LOOKUPS.has(t));
  log.counted = log.model_calls > 0 && !vaultOnly;
  if (log.counted) {
    const cents = Math.min(MAX_RECORD_CENTS, Math.max(0, Math.round(log.cost_cents * 10_000) / 10_000));
    const { data: after, error } = await db.rpc("record_ai_usage", { p_cost_cents: cents });
    log.usage_recorded = !error;
    if (error) {
      log.code ??= `db:${error.code ?? "record_failed"}`;
    } else if (Number(before.used_fraction) < ALLOWANCE_WARN && Number((after as Allowance)?.used_fraction) >= ALLOWANCE_WARN) {
      emit({ type: "notice", code: "allowance_low", message: ALLOWANCE_LOW, used_fraction: (after as Allowance).used_fraction });
    }
  }
  log.cost_cents = Math.round(log.cost_cents * 10_000) / 10_000;
  emit({ type: "done", counted: log.counted });
  deps.log(log);
}
