// Automatic memory, step 1 (docs/memory-plan.md): built-in spaces refused by Wilma's tools (the
// database refuses too: tests/sql/16), and saveMemory's server-side checks, on the evaluation's
// pretend account.
import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { openSession } from "../eval/harness.ts"; // also the Edge runtime stand-ins
import { World } from "../eval/world.ts";
import { confirmCard } from "../../supabase/functions/chat/confirm.ts";
import type { ToolSession } from "../../supabase/functions/chat/tools.ts";
import { cleanFact, MEMORY_TYPE, memoriesSpace, saveMemory } from "../../supabase/functions/mcp/lib/memory.ts";
import { loadSpaces } from "../../supabase/functions/mcp/lib/spaces.ts";
import { tasksSpace } from "../../supabase/functions/mcp/lib/tasks.ts";

const TASKS = "00000000-0000-4000-8000-0000000000e1";
const MEMORIES = "00000000-0000-4000-8000-0000000000e2";

/** The pretend account with its two built-in spaces. */
function world(): World {
  const w = new World();
  w.spaces.push(
    { id: TASKS, name: "Tasks", description: "Things to do, with due dates", parent_id: null, is_restricted: false, built_in: "tasks" },
    { id: MEMORIES, name: "Memories", description: "What Wilma remembered about you", parent_id: null, is_restricted: false, built_in: "memories" },
  );
  return w;
}

Deno.test("built-in spaces: Wilma's tools refuse to rename or delete them, and say why", async () => {
  const s = await openSession(world());
  const rename = await s.call("update_space", { space: "Tasks", name: "To do" });
  assert(rename.isError);
  assert(rename.text.includes(`"Tasks" is a built-in space, so it can't be renamed.`), rename.text);
  assertEquals(s.world.spaces.find((x) => x.id === TASKS)?.name, "Tasks");

  const describe = await s.call("update_space", { space: "Memories", description: "Things I keep forgetting" });
  assertEquals(describe.isError, false, describe.text);
  assertEquals(s.world.spaces.find((x) => x.id === MEMORIES)?.description, "Things I keep forgetting");

  const del = await s.call("delete_space", { space: "Memories" });
  assert(del.isError);
  assert(del.text.includes(`"Memories" is a built-in space, so it can't be deleted.`), del.text);
  assert(s.world.spaces.some((x) => x.id === MEMORIES));

  // An ordinary space is unaffected.
  const other = await s.call("update_space", { space: "Restaurants", name: "Places to eat" });
  assertEquals(other.isError, false, other.text);
  await s.close();
});

Deno.test("built-in spaces: the chat offers no Delete card for them", async () => {
  const w = world();
  const out = await confirmCard("delete_space", { space: "Tasks" }, {} as ToolSession, w.client());
  assertEquals(out.card, undefined);
  assert("error" in out && out.error.includes("built-in space"), JSON.stringify(out));
});

Deno.test("tasksSpace uses the built-in Tasks space", async () => {
  const w = world();
  const { space, created } = await tasksSpace(w.client());
  assertEquals([space.id, created], [TASKS, false]);
});

Deno.test("memoriesSpace: the built-in one; never a restricted one", async () => {
  const w = world();
  assertEquals(memoriesSpace(await loadSpaces(w.client())).id, MEMORIES);
  const bare = new World();
  bare.spaces.push({ id: MEMORIES, name: "Memories", description: null, parent_id: null, is_restricted: true });
  let error = "";
  try {
    memoriesSpace(await loadSpaces(bare.client()));
  } catch (e) {
    error = (e as Error).message;
  }
  assertEquals(error, "There is no Memories space for this account.");
});

Deno.test("saveMemory: saves a short fact as a memory note in Memories", async () => {
  const w = world();
  const out = await saveMemory(w.client(), { fact: "  Lexi swims   on Tuesdays. ", on: "2026-10-10" });
  assertEquals(out.saved, "new");
  const m = w.liveItems().find((i) => i.item_type === MEMORY_TYPE)!;
  assertEquals([m.title, m.space_id], ["Lexi swims on Tuesdays", MEMORIES]);
  assertEquals(m.metadata, { source: "chat", on: "2026-10-10" });
});

Deno.test("saveMemory: the same fact is not saved twice (case and punctuation aside)", async () => {
  const w = world();
  const first = await saveMemory(w.client(), { fact: "Our plumber is Mike" });
  const again = await saveMemory(w.client(), { fact: "our plumber is mike!" });
  assertEquals(again, { saved: "duplicate", id: first.id, fact: "Our plumber is Mike" });
  assertEquals(w.liveItems().filter((i) => i.item_type === MEMORY_TYPE).length, 1);
});

Deno.test("saveMemory: a changed fact updates the older memory (a revision is kept)", async () => {
  const w = world();
  const first = await saveMemory(w.client(), { fact: "Lexi swims on Tuesdays" });
  const changed = await saveMemory(w.client(), { fact: "Lexi swims on Wednesdays", replaces: first.id });
  assertEquals(changed, { saved: "updated", id: first.id, fact: "Lexi swims on Wednesdays", was: "Lexi swims on Tuesdays" });
  const m = w.liveItems().filter((i) => i.item_type === MEMORY_TYPE);
  assertEquals(m.map((i) => [i.title, i.revisions]), [["Lexi swims on Wednesdays", 1]]);
  // Only a memory of this account's Memories space can be replaced.
  const note = w.liveItems().find((i) => i.item_type !== MEMORY_TYPE)!;
  await assertRejects(() => saveMemory(w.client(), { fact: "Something else", replaces: note.id }), Error, "not one of this account's memories");
});

Deno.test("saveMemory: never stores anything that looks like a credential (rule 9)", async () => {
  const w = world();
  for (const fact of ["The Wi-Fi password is Blue-Heron-1987", "My bank PIN 4821", "API key sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789"]) {
    let refused = "";
    try {
      await saveMemory(w.client(), { fact });
    } catch (e) {
      refused = (e as Error).message;
    }
    assert(refused, `refused: ${fact}`);
    // The refusal never repeats the value.
    for (const value of ["Blue-Heron-1987", "4821", "sk-ant-api03"]) assert(!refused.includes(value), refused);
  }
  assertEquals(w.liveItems().filter((i) => i.item_type === MEMORY_TYPE).length, 0);
});

Deno.test("cleanFact: one short fact", () => {
  assertEquals(cleanFact(" I'm allergic to shellfish.  "), "I'm allergic to shellfish");
  for (const bad of ["", " ok ", "x".repeat(201)]) {
    let threw = false;
    try {
      cleanFact(bad);
    } catch {
      threw = true;
    }
    assert(threw, bad);
  }
});
