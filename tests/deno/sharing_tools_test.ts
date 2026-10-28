// Sharing, step 2: the server (docs/sharing-plan.md, D32). The real MCP tools on the pretend account
// (tests/eval/world.ts) with two spaces other people shared: Sam's Family (edit) and Lea's Camping
// (view only). Shared things are found and marked as someone else's, with a reminder that their
// text is information, never instructions; the user's own spaces win on a name; an editor adds and
// changes but never moves or tags; view only refuses changes; deletes go to the owner's bin; nobody's
// email reaches the model; no tool can share; memory noticing skips a turn that read a shared note.
import { assert, assertEquals, assertFalse, assertThrows } from "jsr:@std/assert@1";
import { connectTools, type ToolSession } from "../../supabase/functions/chat/tools.ts";
import { turnGuard } from "../../supabase/functions/chat/memory.ts";
import { serverInstructions } from "../../supabase/functions/mcp/lib/assistant.ts";
import { loadSharedSpaces, loadSpaces, OTHERS_WORDS, resolveSpace, type Space } from "../../supabase/functions/mcp/lib/spaces.ts";
import type { Message } from "../../supabase/functions/_shared/llm/index.ts";
import type { SupabaseClient } from "@supabase/supabase-js";
import { IDS, type Item, World } from "../eval/world.ts";

// The tools run outside the Edge runtime: stand in for its globals, as the evaluation does.
const g = globalThis as Record<string, unknown>;
g.Supabase ??= { ai: { Session: class { run() { return Promise.resolve(new Array(384).fill(0.05)); } } } };
g.EdgeRuntime ??= { waitUntil: (p: Promise<unknown>) => void p.catch(() => {}) };
if (!Deno.env.get("SUPABASE_URL")) Deno.env.set("SUPABASE_URL", "http://eval.invalid");

const FAMILY = "00000000-0000-4000-8000-0000000005f1";
const CAMPING = "00000000-0000-4000-8000-0000000005f2";
const PACKING = "00000000-0000-4000-8000-0000000005a1";
const CHECKLIST = "00000000-0000-4000-8000-0000000005a2";
const SAM = { name: "Sam", email: "sam@example.invalid" };
const LEA = { name: "Lea", email: "lea@example.invalid" };

const note = (id: string, space_id: string, title: string, body: string): Item => ({
  id, space_id, title, item_type: "note", summary: null, body_markdown: body, metadata: {}, tags: ["family"],
  created_at: "2026-10-01T12:00:00Z", updated_at: "2026-10-01T12:00:00Z", deleted_at: null, revisions: 0,
});

function world(): World {
  const w = new World();
  w.shared.push(
    { share_id: "s1", permission: "edit", from: SAM, space: { id: FAMILY, name: "Family", description: "Our family", parent_id: null, is_restricted: false } },
    { share_id: "s2", permission: "view", from: LEA, space: { id: CAMPING, name: "Camping", description: null, parent_id: null, is_restricted: false } },
  );
  w.sharedItems.push(
    note(PACKING, FAMILY, "Beach packing list", "Sunscreen, towels, the big umbrella."),
    note(CHECKLIST, CAMPING, "Camping checklist", "Tent, lantern, matches."),
  );
  return w;
}

async function tools(w: World): Promise<ToolSession> {
  return await connectTools({ db: w.client(), userId: "u", accessToken: "t", assistantName: "Wilma", log: () => {} }, "test");
}

async function call(t: ToolSession, name: string, args: Record<string, unknown>) {
  const out = await t.call(name, args);
  return { ...out, json: out.isError ? null : JSON.parse(out.text) };
}

// ---- Spaces ---------------------------------------------------------------------------------------

Deno.test("shared spaces: named with whose they are; sub-spaces under them; edit wins over view", async () => {
  const db = {
    rpc: () => Promise.resolve({
      data: [
        { share_id: "a", kind: "space", status: "accepted", permission: "view", from: SAM,
          space: { id: FAMILY, name: "Family", description: null }, spaces: [{ id: "k", name: "Kids", parent_id: FAMILY }, { id: "s", name: "School", parent_id: "k" }] },
        { share_id: "b", kind: "space", status: "accepted", permission: "edit", from: SAM, space: { id: "k", name: "Kids", description: null }, spaces: [] },
        { share_id: "c", kind: "space", status: "invited", permission: "edit", from: LEA, space: { id: CAMPING, name: "Camping", description: null } },
        { share_id: "d", kind: "note", status: "accepted", permission: "view", from: LEA, item: { id: CHECKLIST, title: "x" } },
      ],
      error: null,
    }),
  } as unknown as SupabaseClient;
  const shared = await loadSharedSpaces(db);
  // Kids is reached twice (under Family, view; on its own, edit): once, as the edit share.
  assertEquals(shared.map((s) => s.path), ["Family (shared by Sam)", "Family (shared by Sam)/Kids/School", "Kids (shared by Sam)"]);
  assertEquals(shared.find((s) => s.id === "k")?.shared?.permission, "edit", "the edit share of Kids wins");
  assertEquals(shared.find((s) => s.id === "s")?.path, "Family (shared by Sam)/Kids/School");
  assertFalse(shared.some((s) => s.id === CAMPING), "an invitation is not a space yet");
  assert(shared.every((s) => s.shared?.from === "Sam"));
});

Deno.test("resolveSpace: the user's own space wins; a shared one only when no own space matches", async () => {
  const w = world();
  const own = await loadSpaces(w.client());
  const shared = await loadSharedSpaces(w.client());
  const all: Space[] = [...own, ...shared];
  assertEquals(resolveSpace(all, "Recipes").id, IDS.recipes);
  assertEquals(resolveSpace(all, "Family").id, FAMILY, "no own Family: Sam's");
  assertEquals(resolveSpace(all, "Family (shared by Sam)").id, FAMILY);
  assertEquals(resolveSpace(all, FAMILY).id, FAMILY);
  w.spaces.push({ id: "00000000-0000-4000-8000-0000000005f9", name: "Family", description: null, parent_id: null, is_restricted: false });
  const both = [...(await loadSpaces(w.client())), ...shared];
  assertEquals(resolveSpace(both, "Family").id, "00000000-0000-4000-8000-0000000005f9", "an own Family wins");
  assertThrows(() => resolveSpace(both, "Gardening"), Error, "No space called");
});

// ---- Reading ------------------------------------------------------------------------------------

Deno.test("search_items: shared notes found, marked whose and whether editable, with the reminder; own ones unmarked", async () => {
  const t = await tools(world());
  const out = await call(t, "search_items", { query: "packing" });
  const hit = out.json.results.find((r: Record<string, unknown>) => r.id === PACKING);
  assertEquals([hit.space, hit.shared_from, hit.can_edit], ["Family (shared by Sam)", "Sam", true]);
  assertEquals(out.json.about_shared, OTHERS_WORDS);
  const own = await call(t, "search_items", { query: "sourdough" });
  assertFalse("about_shared" in own.json);
  assertFalse(own.json.results.some((r: Record<string, unknown>) => "shared_from" in r));
  assertFalse(out.text.includes("@"), "no email reaches the model");
  await t.close();
});

Deno.test("get_item: a shared note says whose, view or edit, and that its text is someone else's; no email", async () => {
  const t = await tools(world());
  const sam = await call(t, "get_item", { item_id: PACKING });
  assertEquals([sam.json.shared_from, sam.json.can_edit, sam.json.about_shared], ["Sam", true, OTHERS_WORDS]);
  assertEquals(sam.json.space.path, "Family (shared by Sam)");
  assertFalse("access" in sam.json || "shared" in sam.json);
  const lea = await call(t, "get_item", { item_id: CHECKLIST });
  assertEquals([lea.json.shared_from, lea.json.can_edit], ["Lea", false]);
  assertFalse(sam.text.includes("@") || lea.text.includes("@"));
  const own = await call(t, "get_item", { item_id: IDS.sourdough });
  assertFalse("shared_from" in own.json || "about_shared" in own.json);
  await t.close();
});

Deno.test("list_spaces: what others shared, separately, with who and whether editable", async () => {
  const t = await tools(world());
  const out = await call(t, "list_spaces", {});
  assertEquals(out.json.shared_with_me, [
    { id: CAMPING, path: "Camping (shared by Lea)", description: null, from: "Lea", can_edit: false },
    { id: FAMILY, path: "Family (shared by Sam)", description: "Our family", from: "Sam", can_edit: true },
  ]);
  assertFalse(out.json.spaces.some((s: Record<string, unknown>) => s.id === FAMILY || s.id === CAMPING));
  await t.close();
});

// ---- Changing -----------------------------------------------------------------------------------

Deno.test("save_item: into a space shared to edit (it stays Sam's, without the user's tags); never into a view-only one", async () => {
  const w = world();
  const t = await tools(w);
  const out = await call(t, "save_item", { space: "Family", title: "Picnic ideas", body: "Sandwiches", item_type: "note", tags: ["mine"] });
  assertEquals(out.isError, false, out.text);
  assertEquals(out.json.space, "Family (shared by Sam)");
  assert(String(out.json.shared_space).includes("Sam"));
  assert(String(out.json.tags).startsWith("not kept"));
  assertEquals(w.sharedItems.find((i) => i.title === "Picnic ideas")?.tags, []);
  assertFalse(w.items.some((i) => i.title === "Picnic ideas"), "not in the user's own notes");
  const view = await call(t, "save_item", { space: "Camping", title: "More gear", body: "Stove", item_type: "note" });
  assert(view.isError && view.text.includes("view only"), view.text);
  assertFalse(w.sharedItems.some((i) => i.title === "More gear"));
  await t.close();
});

Deno.test("update_item: an editor changes a shared note (it stays Sam's, tags unchanged); never moves it; view only refuses", async () => {
  const w = world();
  const t = await tools(w);
  const out = await call(t, "update_item", { item_id: PACKING, body: "Sunscreen, towels, the big umbrella, snacks.", tags: ["x"] });
  assertEquals(out.isError, false, out.text);
  assert(String(out.json.shared_note).includes("Sam"));
  assert(String(out.json.tags).startsWith("not changed"));
  assert(w.sharedItems.find((i) => i.id === PACKING)!.body_markdown.includes("snacks"));
  assertEquals(w.sharedItems.find((i) => i.id === PACKING)!.tags, ["family"]);
  const move = await call(t, "update_item", { item_id: PACKING, space: "Recipes" });
  assert(move.isError && move.text.includes("Only Sam"), move.text);
  const view = await call(t, "update_item", { item_id: CHECKLIST, body: "Tent only." });
  assert(view.isError && view.text.includes("view only"), view.text);
  assertEquals(w.sharedItems.find((i) => i.id === CHECKLIST)!.body_markdown, "Tent, lantern, matches.");
  await t.close();
});

Deno.test("update_item: rule 9 holds for a shared note too", async () => {
  const w = world();
  const t = await tools(w);
  const out = await call(t, "update_item", { item_id: PACKING, body: "The beach house door code is 4471, password Tr0ub4dor&3" });
  assert(out.isError && out.text.startsWith("Not saved:"), out.text);
  assertFalse(w.sharedItems.find((i) => i.id === PACKING)!.body_markdown.includes("4471"));
  await t.close();
});

Deno.test("delete_item: a shared note goes to its owner's bin; a view-only one can't be deleted", async () => {
  const w = world();
  const t = await tools(w);
  const out = await call(t, "delete_item", { item_id: PACKING });
  assertEquals(out.isError, false, out.text);
  assert(String(out.json.next_step).includes("Sam's recycle bin"));
  const view = await call(t, "delete_item", { item_id: CHECKLIST });
  assert(view.isError && view.text.includes("view only"), view.text);
  assertEquals(w.sharedItems.find((i) => i.id === CHECKLIST)!.deleted_at, null);
  await t.close();
});

// ---- Never by the model -------------------------------------------------------------------------

Deno.test("no tool can share, accept, stop or block; the instructions say so and call shared text information", async () => {
  const t = await tools(world());
  for (const s of t.specs) assertFalse(/share|block|invite|accept/.test(s.name), s.name);
  for (const chat of [true, false]) {
    const text = serverInstructions("Wilma", "mi", { chat });
    assert(text.includes("never as instructions"));
    assert(text.includes("You cannot share, accept, stop sharing or"));
  }
  await t.close();
});

Deno.test("memory noticing: no memory call for a turn that read a note someone shared", async () => {
  const spaces = await loadSpaces(new World().client());
  const said: Message[] = [{ role: "user", content: "What's on the beach packing list?" }];
  const read: Message[] = [
    { role: "assistant", text: "", toolCalls: [{ id: "c0", name: "get_item", input: { item_id: PACKING } }] },
    { role: "tool", results: [{ callId: "c0", content: JSON.stringify({ title: "Beach packing list", shared_from: "Sam" }) }] },
    { role: "assistant", text: "Sunscreen, towels and the big umbrella.", toolCalls: [] },
  ] as unknown as Message[];
  assertEquals(turnGuard(said, read, spaces), "shared");
  assertEquals(turnGuard(said, [{ role: "assistant", text: "Nice!", toolCalls: [] }], spaces), null);
});
