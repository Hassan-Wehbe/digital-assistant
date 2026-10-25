// Usage tracking, step 2 (docs/usage-tracking-plan.md; design D34): counts per user per day, never
// content. One meter per request: every model answer passes through `meterLlm` (tokens, cost and
// the model's name) and every log line through `logged` (what the request was, its outcome, Mapbox
// and weather calls). The model answers since the last log line belong to that line's feature, so a
// recipe suggestion made inside a chat message counts as a suggestion and the rest as chat. After
// the reply, `flush` sends the rows to record_usage() (the caller's own rows, checked again by the
// database); a failed write is reported, never thrown, and never slows or breaks a reply.
//
// What goes in: fixed kind names, a short name as detail (a model, a tool, an error code), numbers.
// Never a message, a note, a title or a place: the log lines hold none, and nothing else is read.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChatRequest, Llm, RouteName, StreamEvent, Usage } from "./llm/index.ts";

export type UsageKind =
  | "chat" | "day_plan" | "classify" | "memory" | "outing" | "recipe_suggest" | "recipe_import"
  | "mapbox" | "weather" | "google_places"
  | "message" | "save" | "search" | "memory_kept" | "fair_use_hit" | "error" | "mcp_call";

export interface UsageRow {
  kind: UsageKind;
  detail?: string;
  count?: number;
  model_calls?: number;
  input_tokens?: number;
  cached_tokens?: number;
  output_tokens?: number;
  cost_cents?: number;
  failures?: number;
}

/** The database's limits per row (record_usage); a row over them is clipped, never refused. */
const MAX_COUNT = 100;
const MAX_TOKENS = 2_000_000;
const MAX_CENTS = 5;
/** record_usage() takes at most this many rows per call. */
const MAX_ROWS = 20;

/** A model's or tool's name as the database's `detail` allows it: lower-case, a short fixed shape. */
export function usageName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9._:/-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

/** A log line, as the meter reads it: only these fields, all counts or fixed codes. */
export interface MeteredLog {
  event: string;
  outcome?: string;
  code?: string;
  tools?: string[];
  saved?: number;
  drive_requests?: number;
  drive_failures?: number;
  weather_requests?: number;
  weather_failures?: number;
}

interface Pending {
  calls: number;
  input: number;
  cached: number;
  output: number;
  cost: number;
}

export class UsageMeter {
  private pending = new Map<string, Pending>();
  private out: UsageRow[] = [];

  /** Where the request came from: "chat" (a message) or "app" (a screen: My day, Suggest, ...). */
  origin: "chat" | "app" = "app";

  /** A model answered (tokens and cost in cents, from the route's prices). */
  modelAnswered(model: string, u: Usage): void {
    const key = usageName(model) || "unknown";
    const p = this.pending.get(key) ?? { calls: 0, input: 0, cached: 0, output: 0, cost: 0 };
    p.calls += 1;
    p.input += u.inputTokens + u.cacheWriteTokens;
    p.cached += u.cacheReadTokens;
    p.output += u.outputTokens;
    p.cost += u.costCents;
    this.pending.set(key, p);
  }

  /** A request's log line: what it was, and the model answers since the last one. */
  logged(e: MeteredLog): void {
    const add = (kind: UsageKind, extra: Omit<UsageRow, "kind"> = {}) => this.out.push({ kind, ...extra });
    const err = (what: string) => add("error", { detail: usageName(what), count: 1 });
    const fair = (what: string) => add("fair_use_hit", { detail: what, count: 1 });
    let kind: UsageKind | null = null;
    switch (e.event) {
      case "chat": {
        kind = "chat";
        if (e.outcome === "bad_request") break;
        add("chat", { count: 1 });
        add("message", { count: 1 });
        if (e.outcome === "allowance_used") fair("ai_allowance");
        else if (e.outcome && !["ok", "client_closed", "credential_held"].includes(e.outcome)) err(`chat:${e.outcome}`);
        const saves = (e.tools ?? []).filter((t) => t === "save_item").length;
        const searches = (e.tools ?? []).filter((t) => t === "search_items").length;
        if (saves) add("save", { count: saves });
        if (searches) add("search", { count: searches });
        break;
      }
      case "day":
        kind = "day_plan";
        if (e.outcome === "ok") add("day_plan", { detail: this.origin === "chat" ? "chat" : "my_day", count: 1 });
        else if (e.outcome === "fair_use") fair("day_plan");
        else if (e.outcome === "connection") err("day:connection");
        break;
      case "classify":
        kind = "classify";
        add("classify", { count: 1 });
        break;
      case "memory":
        kind = "memory";
        if (e.outcome !== "skipped") add("memory", { count: 1 });
        if (e.saved) add("memory_kept", { count: e.saved });
        break;
      case "outing":
        kind = "outing";
        if (e.outcome === "ok") add("outing", { count: 1 });
        else if (e.outcome === "fair_use") fair("outing");
        else if (e.outcome === "allowance_used") fair("ai_allowance");
        else if (e.outcome === "connection") err("outing:connection");
        break;
      case "recipe_suggest":
        kind = "recipe_suggest";
        if (e.outcome === "ok" || e.outcome === "none_fit" || e.outcome === "no_answer") add("recipe_suggest", { count: 1 });
        else if (e.outcome === "limit") fair("recipe_suggest");
        else if (e.outcome === "allowance_used") fair("ai_allowance");
        else if (e.outcome === "connection") err("recipe_suggest:connection");
        break;
      case "recipe_from_text":
      case "recipe_from_image": {
        kind = "recipe_import";
        const how = e.event === "recipe_from_text" ? "text" : "image";
        if (e.outcome === "ok" || e.outcome === "not_a_recipe" || e.outcome === "no_answer") add("recipe_import", { detail: how, count: 1 });
        else if (e.outcome === "allowance_used") fair("ai_allowance");
        else if (e.outcome === "connection") err(`recipe_import:connection`);
        break;
      }
    }
    if (e.drive_requests) add("mapbox", { count: e.drive_requests, failures: e.drive_failures ?? 0 });
    if (e.weather_requests) add("weather", { count: e.weather_requests, failures: e.weather_failures ?? 0 });
    if (kind) this.claim(kind);
  }

  /** The model answers so far belong to `kind`. */
  private claim(kind: UsageKind): void {
    for (const [model, p] of this.pending) {
      this.out.push({ kind, detail: model, model_calls: p.calls, input_tokens: p.input, cached_tokens: p.cached, output_tokens: p.output, cost_cents: p.cost });
    }
    this.pending.clear();
  }

  /** The rows, merged by kind and detail and clipped to the database's limits. Answers no log line claimed go to the origin's kind. */
  rows(): UsageRow[] {
    if (this.pending.size) this.claim("chat");
    const merged = new Map<string, UsageRow>();
    for (const r of this.out) {
      const key = `${r.kind}|${r.detail ?? ""}`;
      const m = merged.get(key) ?? { kind: r.kind, ...(r.detail ? { detail: r.detail } : {}) };
      for (const f of ["count", "model_calls", "input_tokens", "cached_tokens", "output_tokens", "cost_cents", "failures"] as const) {
        if (r[f] !== undefined) m[f] = (m[f] ?? 0) + r[f]!;
      }
      merged.set(key, m);
    }
    return [...merged.values()].slice(0, MAX_ROWS).map((r) => {
      const c: UsageRow = { kind: r.kind, ...(r.detail ? { detail: r.detail } : {}) };
      for (const f of ["count", "model_calls", "failures"] as const) if (r[f]) c[f] = Math.min(MAX_COUNT, Math.round(r[f]!));
      for (const f of ["input_tokens", "cached_tokens", "output_tokens"] as const) if (r[f]) c[f] = Math.min(MAX_TOKENS, Math.round(r[f]!));
      if (r.cost_cents) c.cost_cents = Math.min(MAX_CENTS, Math.round(r.cost_cents * 1_000_000) / 1_000_000);
      return c;
    });
  }

  /** Sends the rows as the user (RLS: their own rows only). Never throws. */
  async flush(db: Pick<SupabaseClient, "rpc">): Promise<{ rows: number; ok: boolean; code?: string }> {
    const rows = this.rows();
    this.out = [];
    return await recordRows(db, rows);
  }
}

/** A model client whose answers are counted by `meter`, with the model's name from the routes when known. */
export function meterLlm(inner: Pick<Llm, "stream"> & Partial<Pick<Llm, "routes">>, meter: UsageMeter): Pick<Llm, "stream"> & Partial<Pick<Llm, "routes">> {
  return {
    ...(inner.routes ? { routes: inner.routes } : {}),
    async *stream(route: RouteName, req: ChatRequest): AsyncGenerator<StreamEvent> {
      for await (const ev of inner.stream(route, req)) {
        if (ev.type === "done") {
          // The memory route is optional: without it the router's model answers (createLlm).
          const routes = inner.routes as Record<string, { model?: string } | undefined> | undefined;
          const model = (routes?.[route] ?? (route === "memory" ? routes?.router : undefined))?.model ?? route;
          meter.modelAnswered(model, ev.usage);
        }
        yield ev;
      }
    },
  };
}

/**
 * The MCP server's requests (the Claude connector, and the app's own saves and searches): one
 * `mcp_call` per tool called, by the tool's name, plus `save` and `search`. Only the JSON-RPC
 * method and the tool's name are read, never its arguments.
 */
export function toolCallRows(body: unknown): UsageRow[] {
  const calls = (Array.isArray(body) ? body : [body])
    .filter((m): m is { method: string; params: { name: unknown } } =>
      !!m && typeof m === "object" && (m as { method?: unknown }).method === "tools/call" &&
      !!(m as { params?: unknown }).params && typeof (m as { params: { name?: unknown } }).params.name === "string")
    .map((m) => usageName(m.params.name as string))
    .filter(Boolean);
  const rows = new Map<string, UsageRow>();
  const add = (kind: UsageKind, detail?: string) => {
    const key = `${kind}|${detail ?? ""}`;
    const r = rows.get(key) ?? { kind, ...(detail ? { detail } : {}), count: 0 };
    r.count = Math.min(MAX_COUNT, (r.count ?? 0) + 1);
    rows.set(key, r);
  };
  for (const name of calls) {
    add("mcp_call", name);
    if (name === "save_item") add("save");
    if (name === "search_items") add("search");
  }
  return [...rows.values()].slice(0, MAX_ROWS);
}

/** Writes rows as the user; never throws (a failure is returned for the log line). */
export async function recordRows(db: Pick<SupabaseClient, "rpc">, rows: UsageRow[]): Promise<{ rows: number; ok: boolean; code?: string }> {
  if (!rows.length) return { rows: 0, ok: true };
  try {
    const { error } = await db.rpc("record_usage", { p_rows: rows });
    return error ? { rows: rows.length, ok: false, code: `db:${error.code ?? "error"}` } : { rows: rows.length, ok: true };
  } catch (e) {
    return { rows: rows.length, ok: false, code: e instanceof Error ? e.name : "unknown" };
  }
}
