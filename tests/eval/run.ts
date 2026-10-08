// The evaluation runner. Each run calls real model APIs and costs real (small) money, so it
// only runs when the owner starts it (GitHub Actions -> "model evaluation"), with a cap.
//
//   deno run -A --config supabase/functions/mcp/deno.json tests/eval/run.ts \
//     --models haiku-4-5,sonnet-5-5-low [--cases all|<ids or categories>] [--repeat 1] \
//     [--max-dollars 10] [--concurrency 1] [--out tests/eval/results] [--dry-run] [--suite chat|router]
//
// --suite router evaluates the one box's classifier (router.ts) instead of Wilma's conversations.
//
// --dry-run prints the plan and a cost estimate and calls nothing (no keys needed).
// Keys come from ANTHROPIC_API_KEY / OPENAI_API_KEY in the environment and are never printed.
import { AnthropicAdapter, anthropicClient } from "../../supabase/functions/_shared/llm/anthropic.ts";
import { OpenAIAdapter, openaiClient } from "../../supabase/functions/_shared/llm/openai.ts";
import {
  type LlmAdapter, type ModelConfig, type ProviderId, QUOTA_EXCEEDED,
} from "../../supabase/functions/_shared/llm/index.ts";
import { runConversation } from "./harness.ts";
import { CASES } from "./cases.ts";
import { type CaseResult, type EvalCase, grade } from "./grade.ts";
import { markdown, summarize } from "./report.ts";
import { estimateRouterCents, ROUTER_CASES, type RouterCase, routerMarkdown, type RouterResult, runRouterCase } from "./router.ts";

export interface Candidate extends ModelConfig {
  disabled?: string;
}

const KEY_ENV: Record<ProviderId, string> = { anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY" };

export function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) throw new Error(`unexpected argument: ${a}`);
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) out[key] = "true";
    else out[key] = argv[++i];
  }
  return out;
}

/** "all", or a comma list of case ids and categories. */
export function selectCases<C extends { id: string; category: string } = EvalCase>(
  spec: string,
  cases: C[] = CASES as unknown as C[],
): C[] {
  if (!spec || spec === "all") return cases;
  const wanted = spec.split(",").map((s) => s.trim()).filter(Boolean);
  const unknown = wanted.filter((w) => !cases.some((c) => c.id === w || c.category === w));
  if (unknown.length) throw new Error(`unknown case or category: ${unknown.join(", ")}`);
  return cases.filter((c) => wanted.includes(c.id) || wanted.includes(c.category));
}

export function selectModels(spec: string, all: Record<string, Candidate>): [string, Candidate][] {
  const ids = spec.split(",").map((s) => s.trim()).filter(Boolean);
  if (!ids.length) throw new Error(`--models is required; candidates: ${Object.keys(all).join(", ")}`);
  return ids.map((id) => {
    const m = all[id];
    if (!m) throw new Error(`unknown model "${id}"; candidates: ${Object.keys(all).join(", ")}`);
    if (m.disabled) throw new Error(`model "${id}" is not ready: ${m.disabled}`);
    if (!m.model) throw new Error(`model "${id}" has no model id`);
    return [id, m];
  });
}

/**
 * A generous upper bound in cents: every case assumed to take 3 model calls of ~9,000 input
 * tokens (tools + instructions + conversation) without any cache discount, and 500 output tokens.
 */
export function estimateCents(m: ModelConfig, cases: EvalCase[], repeat: number): number {
  const turns = cases.reduce((a, c) => a + c.turns.length, 0) * repeat;
  return (turns * 3 * (9000 * m.price.input + 500 * m.price.output)) / 1_000_000 * 100;
}

/**
 * Why every further call to this model would fail the same way, or null. Such an answer stops
 * the model's run at once instead of repeating it for every case.
 */
export function stopReason(
  run: { errorCode?: string; errorStatus?: number },
  id: string,
  m: ModelConfig,
): string | null {
  const keyName = KEY_ENV[m.provider];
  if (run.errorCode === QUOTA_EXCEEDED) {
    return `${id} stopped: the ${m.provider} account is out of credit or over its spend limit ` +
      "(top up or raise the limit, then run again)";
  }
  if (run.errorCode === "invalid_function_parameters") {
    return `${id} stopped: ${m.provider} rejected a tool definition (HTTP 400); see the error's location ` +
      "and fix the adapter's tool schema conversion";
  }
  if (run.errorStatus === 401) return `${id} stopped: ${keyName} was refused (HTTP 401); create a new key and update the secret`;
  if (run.errorStatus === 403) {
    return `${id} stopped: this key may not use "${m.model}" (HTTP 403); check the project's allowed models`;
  }
  if (run.errorStatus === 404) {
    return `${id} stopped: ${m.provider} does not know the model "${m.model}", or this key may not use it ` +
      "(HTTP 404); check the exact model id and the project's allowed models";
  }
  return null;
}

/**
 * A short transcript of a case for the log, so a failure can be understood from the run page.
 * Only the evaluation's made-up data appears here; secret values in replies are reported as
 * leaks by the grading, and this output is for the owner's own run log.
 */
export function transcript(run: { turns: { user: string; reply: string; toolCalls: { name: string; args: unknown; isError: boolean; result: string }[] }[] }): string {
  const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s).replace(/\s+/g, " ");
  return run.turns.map((t) => [
    `    user: ${cut(t.user, 200)}`,
    ...t.toolCalls.map((c) =>
      `    tool: ${c.name} ${cut(JSON.stringify(c.args), 160)} -> ${c.isError ? "ERROR " : ""}${cut(c.result, 160)}`
    ),
    `    reply: ${cut(t.reply || "(nothing)", 400)}`,
  ].join("\n")).join("\n");
}

/** Models whose provider key is set, and the others (skipped, with the setting to add). */
export function splitByKeys(
  models: [string, Candidate][],
  env: (name: string) => string | undefined,
): { ready: [string, Candidate][]; missing: string[] } {
  const ready = models.filter(([, m]) => !!env(KEY_ENV[m.provider]));
  const missing = models.filter(([, m]) => !env(KEY_ENV[m.provider]))
    .map(([id, m]) => `${id} skipped: ${KEY_ENV[m.provider]} is not set`);
  return { ready, missing };
}

function adapterFor(provider: ProviderId): LlmAdapter {
  const key = Deno.env.get(KEY_ENV[provider]);
  if (!key) throw new Error(`${KEY_ENV[provider]} is not set`);
  return provider === "anthropic" ? new AnthropicAdapter(anthropicClient(key)) : new OpenAIAdapter(openaiClient(key));
}

async function pool<T>(items: T[], concurrency: number, fn: (t: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, async () => {
    for (let t = queue.shift(); t !== undefined; t = queue.shift()) await fn(t);
  }));
}

async function main() {
  const args = parseArgs(Deno.args);
  const all = (JSON.parse(await Deno.readTextFile(new URL("./models.json", import.meta.url))) as {
    models: Record<string, Candidate>;
  }).models;
  const selected = selectModels(args.models ?? "", all);
  const suite = args.suite ?? "chat";
  if (suite !== "chat" && suite !== "router") throw new Error(`unknown suite "${suite}": chat or router`);
  const cases = suite === "router" ? selectCases<RouterCase>(args.cases ?? "all", ROUTER_CASES) : selectCases<EvalCase>(args.cases ?? "all");
  const repeat = Math.max(1, Number(args.repeat ?? 1));
  const maxDollars = Number(args["max-dollars"] ?? 10);
  // One case at a time by default: new provider accounts have low per-minute limits.
  const concurrency = Number(args.concurrency ?? 1);
  if (!(maxDollars > 0) || !(concurrency >= 1)) throw new Error("--max-dollars and --concurrency must be positive");
  // A dry run plans every selected model; a real run skips models whose provider key is missing.
  const { ready, missing } = args["dry-run"]
    ? { ready: selected, missing: [] as string[] }
    : splitByKeys(selected, (n) => Deno.env.get(n));
  for (const note of missing) console.log(note);
  if (!ready.length) throw new Error("no selected model has its API key set; nothing to run");
  const models = ready;

  console.log(`Plan (${suite}): ${cases.length} cases x ${repeat} run(s) on ${models.map(([id]) => id).join(", ")}.`);
  for (const [id, m] of models) {
    const cents = suite === "router"
      ? estimateRouterCents(m, cases as RouterCase[], repeat)
      : estimateCents(m, cases as EvalCase[], repeat);
    console.log(`  ${id} (${m.provider} ${m.model}): at most about $${(cents / 100).toFixed(2)}`);
  }
  console.log(`Spending cap for the whole run: $${maxDollars.toFixed(2)} (remaining cases are skipped once it is reached).`);
  if (args["dry-run"]) return;

  const adapters = new Map<ProviderId, LlmAdapter>();
  for (const [, m] of models) if (!adapters.has(m.provider)) adapters.set(m.provider, adapterFor(m.provider));

  const capCents = maxDollars * 100;
  if (suite === "router") {
    await runRouterSuite(models, adapters, cases as RouterCase[], repeat, capCents, maxDollars, missing, args.out);
    return;
  }
  let spentCents = 0;
  const results: Record<string, (CaseResult | "skipped")[]> = {};
  const transcripts: unknown[] = [];
  const notes = [...missing];
  for (const [id, m] of models) {
    results[id] = [];
    let stopped = false;
    const jobs = (cases as EvalCase[]).flatMap((c) => Array.from({ length: repeat }, () => c));
    await pool(jobs, concurrency, async (c) => {
      if (spentCents >= capCents || stopped) {
        results[id].push("skipped");
        return;
      }
      const run = await runConversation(adapters.get(m.provider)!, m, c.turns, { setup: c.setup, here: c.here, calendar: c.calendar });
      spentCents += run.costCents;
      const stop = stopReason(run, id, m);
      if (stop && !stopped) {
        stopped = true;
        notes.push(stop);
        console.log(stop);
      }
      const g = grade(c, run);
      results[id].push(g);
      transcripts.push({
        model: id, case: c.id, grade: g,
        turns: run.turns.map((t) => ({
          ...t,
          toolCalls: t.toolCalls.map((tc) => ({ ...tc, result: tc.result.slice(0, 2000) })),
        })),
      });
      const mark = g.pass ? "pass" : g.leaks.length ? "LEAK" : g.error ? "error" : "fail";
      console.log(`${mark.padEnd(5)} ${id} ${c.id} (${(g.ms / 1000).toFixed(1)} s, ${g.costCents.toFixed(2)} cents)`);
      if (!g.pass) console.log(transcript(run));
    });
  }

  const date = new Date().toISOString().slice(0, 16).replace("T", " ");
  const report = markdown(Object.entries(results).map(([id, r]) => summarize(id, r)), results, {
    date, repeat, maxDollars, notes,
  });
  const outDir = args.out ?? "tests/eval/results";
  await Deno.mkdir(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  await Deno.writeTextFile(`${outDir}/eval-${stamp}.md`, report);
  await Deno.writeTextFile(`${outDir}/eval-${stamp}.json`, JSON.stringify(transcripts, null, 2));
  const summaryFile = Deno.env.get("GITHUB_STEP_SUMMARY");
  if (summaryFile) await Deno.writeTextFile(summaryFile, report, { append: true });
  console.log(`\n${report}\nSaved ${outDir}/eval-${stamp}.md and .json (full transcripts).`);
}

/** The classifier suite: one model call per case, graded in router.ts. */
async function runRouterSuite(
  models: [string, Candidate][],
  adapters: Map<ProviderId, LlmAdapter>,
  cases: RouterCase[],
  repeat: number,
  capCents: number,
  maxDollars: number,
  notes: string[],
  out: string | undefined,
) {
  let spentCents = 0;
  const results: Record<string, RouterResult[]> = {};
  for (const [id, m] of models) {
    results[id] = [];
    for (const c of cases.flatMap((c) => Array.from({ length: repeat }, () => c))) {
      if (spentCents >= capCents) break;
      const r = await runRouterCase(adapters.get(m.provider)!, m, c);
      spentCents += r.costCents;
      results[id].push(r);
      const mark = r.pass ? "pass" : r.leak ? "LEAK" : "fail";
      const got = r.verdict.route === "search" ? `search "${r.verdict.query}"` : `wilma${r.code ? ` (${r.code})` : ""}`;
      console.log(`${mark.padEnd(5)} ${id} ${c.id}: ${got} (${(r.ms / 1000).toFixed(1)} s)`);
      if (!r.pass) console.log(`    ${r.failures.join("; ")}`);
    }
  }
  const date = new Date().toISOString().slice(0, 16).replace("T", " ");
  const report = routerMarkdown(results, { date, repeat, maxDollars, notes });
  const outDir = out ?? "tests/eval/results";
  await Deno.mkdir(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  await Deno.writeTextFile(`${outDir}/router-${stamp}.md`, report);
  await Deno.writeTextFile(`${outDir}/router-${stamp}.json`, JSON.stringify(results, null, 2));
  const summaryFile = Deno.env.get("GITHUB_STEP_SUMMARY");
  if (summaryFile) await Deno.writeTextFile(summaryFile, report, { append: true });
  console.log(`\n${report}\nSaved ${outDir}/router-${stamp}.md and .json.`);
}

if (import.meta.main) {
  try {
    await main();
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    Deno.exit(1);
  }
}
