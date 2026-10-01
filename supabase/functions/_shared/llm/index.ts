// The llm module (docs/design.md D21, docs/phase5-chat-plan.md). Use:
//
//   const llm = createLlm({ env: Deno.env.get });
//   for await (const ev of llm.stream("default", { system, messages, tools })) {
//     if (ev.type === "text") send(ev.text);
//     else { /* ev.turn, ev.stop, ev.usage.costCents: run tools only if ev.stop === "tool_calls" */ }
//   }
//
// API keys are read here on the server only; they never reach the app or the model.
import { AnthropicAdapter, anthropicClient, type AnthropicLike } from "./anthropic.ts";
import { OpenAIAdapter, openaiClient, type OpenAILike } from "./openai.ts";
import { KEY_ENV, parseRoutes, type RouteName, type Routes } from "./routes.ts";
import { type ChatRequest, type LlmAdapter, LlmError, type ProviderId, type StreamEvent } from "./types.ts";

export * from "./types.ts";
export { costCents } from "./cost.ts";
export { missingKeys, parseRoutes, ROUTE_NAMES, type RouteName, type Routes, RoutesConfigError } from "./routes.ts";

export interface Llm {
  readonly routes: Routes;
  stream(route: RouteName, req: ChatRequest): AsyncGenerator<StreamEvent>;
}

export interface LlmOptions {
  env: (name: string) => string | undefined;
  /** Routes; default: parsed from the LLM_ROUTES setting. */
  routes?: Routes;
  /** Clients to use instead of the SDKs' (tests). */
  clients?: { anthropic?: AnthropicLike; openai?: OpenAILike };
}

export function createLlm(opts: LlmOptions): Llm {
  const routes = opts.routes ?? parseRoutes(opts.env("LLM_ROUTES"));
  const adapters = new Map<ProviderId, LlmAdapter>();

  function adapter(provider: ProviderId): LlmAdapter {
    let a = adapters.get(provider);
    if (a) return a;
    const injected = opts.clients?.[provider];
    const key = opts.env(KEY_ENV[provider]);
    if (!injected && !key) throw new LlmError(provider, "api_key_not_set", undefined, false);
    a = provider === "anthropic"
      ? new AnthropicAdapter((injected as AnthropicLike | undefined) ?? anthropicClient(key!))
      : new OpenAIAdapter((injected as OpenAILike | undefined) ?? openaiClient(key!));
    adapters.set(provider, a);
    return a;
  }

  return {
    routes,
    stream(route, req) {
      const model = routes[route];
      return adapter(model.provider).stream(model, req);
    },
  };
}
