// Routes are configuration, not code (D21): which provider and model answers each kind of
// request, with its prices. The evaluation set decides the values; they live in the Edge
// Function secret LLM_ROUTES (JSON), so changing a model needs no deploy. Example in
// docs/phase5-chat-plan.md ("Routes configuration").
import { z } from "npm:zod@4.1.13";
import type { ModelConfig, ProviderId } from "./types.ts";

export const ROUTE_NAMES = ["router", "default", "escalation"] as const;
export type RouteName = typeof ROUTE_NAMES[number];
export type Routes = Record<RouteName, ModelConfig>;

/** Where each provider's API key lives (Supabase -> Edge Functions -> Secrets). */
export const KEY_ENV: Record<ProviderId, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
};

const price = z.number().nonnegative().max(1000);
const modelConfig = z.object({
  provider: z.enum(["anthropic", "openai"]),
  model: z.string().trim().min(1).max(100),
  price: z.object({ input: price, output: price, cacheRead: price, cacheWrite: price }).strict(),
  maxOutputTokens: z.number().int().min(256).max(128_000),
  effort: z.enum(["low", "medium", "high", "xhigh", "max"]).optional(),
}).strict();
const routesSchema = z.object({ router: modelConfig, default: modelConfig, escalation: modelConfig }).strict();

export class RoutesConfigError extends Error {
  constructor(detail: string) {
    super(`LLM_ROUTES is not valid: ${detail}`);
    this.name = "RoutesConfigError";
  }
}

/** Parse and check the LLM_ROUTES JSON. Throws RoutesConfigError with what is wrong. */
export function parseRoutes(json: string | undefined): Routes {
  if (!json) throw new RoutesConfigError("not set");
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new RoutesConfigError("not JSON");
  }
  const parsed = routesSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new RoutesConfigError(`${issue.path.join(".") || "(top)"}: ${issue.message}`);
  }
  return parsed.data;
}

/** Providers the routes use whose API key is not set: those routes cannot answer. */
export function missingKeys(routes: Routes, env: (name: string) => string | undefined): ProviderId[] {
  const used = new Set(ROUTE_NAMES.map((r) => routes[r].provider));
  return [...used].filter((p) => !env(KEY_ENV[p]));
}
