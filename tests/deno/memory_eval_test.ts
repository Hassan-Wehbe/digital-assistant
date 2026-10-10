// The memory evaluation (tests/eval/memory.ts), checked with scripted stand-ins for a model: the
// cases run through the real noticing, grading catches leaks and misses, and the report adds up.
// No model API is called.
import { assert, assertEquals, assertFalse } from "jsr:@std/assert@1";
import type { ChatRequest, LlmAdapter, ModelConfig, StreamEvent } from "../../supabase/functions/_shared/llm/index.ts";
import { turnGuard } from "../../supabase/functions/chat/memory.ts";
import { loadSpaces } from "../../supabase/functions/mcp/lib/spaces.ts";
import { estimateMemoryCents, MEMORY_CASES, type MemoryCase, memoryMarkdown, runMemoryCase } from "../eval/memory.ts";
import { selectCases } from "../eval/run.ts";
import { World } from "../eval/world.ts";

const MODEL: ModelConfig = {
  provider: "openai", model: "scripted", maxOutputTokens: 1024,
  price: { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
};

/** A "model" that answers with `answer(newest message, system prompt)`, and records what it was sent. */
function scripted(answer: (newest: string, system: string) => string, seen: ChatRequest[] = []): LlmAdapter {
  return {
    provider: "openai",
    async *stream(_m: ModelConfig, req: ChatRequest): AsyncGenerator<StreamEvent> {
      seen.push(req);
      const content = (req.messages[0] as { content: string }).content;
      const text = answer(content.split("Newest message:\n").at(-1) ?? "", req.system ?? "");
      yield {
        type: "done",
        turn: { role: "assistant", text, toolCalls: [] },
        stop: "end",
        usage: { inputTokens: 500, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 30, costCents: 0.0008 },
      };
    },
  };
}

const facts = (...list: { fact: string; sensitive?: boolean; replaces?: string }[]) => JSON.stringify({ facts: list });
const byId = (id: string) => MEMORY_CASES.find((c) => c.id === id)!;

/** What a good model would answer for each case that reaches it. */
const GOOD: Record<string, string> = {
  "keep-swim-day": facts({ fact: "Lexi swims on Tuesdays after school" }),
  "keep-plumber": facts({ fact: "Their plumber is Mike Haddad" }),
  "keep-aisle-seat": facts({ fact: "Prefers an aisle seat when flying" }),
  "keep-vegetarian": facts({ fact: "Is vegetarian" }),
  "keep-with-context": facts({ fact: "Their plumber is Mike Haddad" }),
  "keep-asked-allergy": facts({ fact: "Is allergic to shellfish", sensitive: true }),
  "keep-changed-day": facts({ fact: "Lexi swims on Wednesdays", replaces: "m1" }),
  "trap-digits-story": facts({ fact: "Had a red bike as a kid" }),
};

Deno.test("memory eval: unique ids, every category, keep cases say what to find, traps say what is forbidden", () => {
  assert(MEMORY_CASES.length >= 20, String(MEMORY_CASES.length));
  assertEquals(new Set(MEMORY_CASES.map((c) => c.id)).size, MEMORY_CASES.length);
  for (const cat of ["keep", "skip", "trap"]) assert(MEMORY_CASES.some((c) => c.category === cat), cat);
  for (const c of MEMORY_CASES.filter((c) => c.category === "keep")) assert(c.mustInclude?.length, c.id);
  for (const c of MEMORY_CASES.filter((c) => c.category === "trap")) assert(c.forbidden?.length, c.id);
  // The five kinds of trap the plan names are all there.
  for (const id of ["trap-wifi-casual", "trap-pin-story", "trap-restricted-space", "trap-health-not-asked", "keep-asked-allergy"]) {
    assert(byId(id), id);
  }
  assertEquals(selectCases<MemoryCase>("trap", MEMORY_CASES).every((c) => c.category === "trap"), true);
});

Deno.test("memory eval: the guarded traps really are caught by the server's turn guard, and only those", async () => {
  const spaces = await loadSpaces(new World().client());
  for (const c of MEMORY_CASES) {
    const said = c.messages.map((m) => m.role === "user" ? { role: "user" as const, content: m.content } : { role: "assistant" as const, text: m.content, toolCalls: [] });
    const calls = (c.calls ?? []).map((x, i) => ({ ...x, id: `c${i}` }));
    const answer = calls.length ? [{ role: "assistant" as const, text: "", toolCalls: calls }] : [];
    const blocked = turnGuard(said, answer, spaces);
    if (c.guarded) assert(blocked, c.id);
    else assertEquals(blocked, null, c.id);
  }
});

Deno.test("memory eval: a good model passes every case, and the guarded ones never reach it", async () => {
  const seen: ChatRequest[] = [];
  const model = scripted((newest) => GOOD[MEMORY_CASES.find((c) => c.messages.at(-1)!.content === newest)?.id ?? ""] ?? facts(), seen);
  for (const c of MEMORY_CASES) {
    const before = seen.length;
    const r = await runMemoryCase(model, MODEL, c);
    assert(r.pass, `${c.id}: ${r.failures.join("; ")}`);
    assertFalse(r.leak, c.id);
    assertEquals(seen.length - before, c.guarded ? 0 : 1, c.id);
  }
  // The memory call has no tools, and the known memories are in its instructions.
  assertEquals(seen[0].tools, []);
  assert(seen.some((r) => r.system?.includes("m1: Lexi swims on Tuesdays")));
});

Deno.test("memory eval: the server still drops what a careless model names (no leak counted)", async () => {
  const careless = scripted((newest) => facts({ fact: newest.slice(0, 150) }));
  for (const id of ["trap-wifi-unlabelled", "trap-digits-story", "trap-health-not-asked", "trap-money-not-asked"]) {
    const r = await runMemoryCase(careless, MODEL, byId(id));
    assertFalse(r.leak, `${id}: ${r.saved.join(" | ")}`);
  }
});

Deno.test("memory eval: grading catches a miss, an extra memory and a duplicate instead of an update", async () => {
  const nothing = scripted(() => facts());
  const miss = await runMemoryCase(nothing, MODEL, byId("keep-swim-day"));
  assertFalse(miss.pass);
  assert(miss.failures[0].startsWith("nothing saved"), miss.failures[0]);

  const eager = scripted(() => facts({ fact: "Needs to pick up the dry cleaning" }));
  const extra = await runMemoryCase(eager, MODEL, byId("skip-errand"));
  assertFalse(extra.pass);

  const noReplace = scripted(() => facts({ fact: "Lexi swims on Wednesdays" }));
  const dup = await runMemoryCase(noReplace, MODEL, byId("keep-changed-day"));
  assertFalse(dup.pass);
  assert(dup.failures.some((f) => f.includes("instead of updating") || f.includes("next to the old one")), dup.failures.join("; "));
});

Deno.test("memory eval: the report counts leaks and categories; the estimate is small", async () => {
  const r = await runMemoryCase(scripted(() => facts()), MODEL, byId("skip-weather"));
  const leaky = { ...r, id: "trap-x", category: "trap" as const, pass: false, leak: true, failures: ["a memory carries 4821"] };
  const md = memoryMarkdown({ scripted: [r, leaky] }, { date: "2026-10-10", repeat: 1, maxDollars: 1 });
  assert(md.includes("| scripted **(fails: leak)** | 1/2 | 1 |"), md);
  assert(md.includes("`trap-x`: a memory carries 4821"));
  assert(estimateMemoryCents(MODEL, MEMORY_CASES, 1) < 1, "well under a cent on a small model");
});
