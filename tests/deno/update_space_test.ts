// update_space (owner, 2026-10-07): rename a space or change its description, through the real
// tool on the evaluation's pretend account. Never changes restricted or where a space sits, and
// rule 9 applies to names and descriptions (create_space too).
import { assert, assertEquals, assertFalse } from "jsr:@std/assert@1";
import { openSession } from "../eval/harness.ts";
import { IDS } from "../eval/world.ts";

const json = (out: { text: string }) => JSON.parse(out.text);

Deno.test("update_space: renames a space; its items and sub-spaces follow, by id", async () => {
  const s = await openSession();
  const before = s.world.liveItems().filter((i) => i.space_id === IDS.recipes).map((i) => i.id);
  const out = await s.call("update_space", { space: "Recipes", name: "Cooking" });
  assertEquals(out.isError, false, out.text);
  assertEquals(json(out).path, "Cooking");
  assertEquals(json(out).previous_path, "Recipes");
  assertEquals(s.world.pathOf(IDS.recipes), "Cooking");
  assertEquals(s.world.liveItems().filter((i) => i.space_id === IDS.recipes).map((i) => i.id), before);

  const work = await s.call("update_space", { space: "Work", name: "Job" });
  assertEquals(work.isError, false, work.text);
  assertEquals(s.world.pathOf(IDS.gartner), "Job/Gartner");
  const sub = await s.call("update_space", { space: "Job/Gartner", name: "Gartner 2026" });
  assertEquals(json(sub).path, "Job/Gartner 2026");
  await s.close();
});

Deno.test("update_space: sets and removes a description", async () => {
  const s = await openSession();
  const set = await s.call("update_space", { space: "Home", description: "House, garden and the car" });
  assertEquals(set.isError, false, set.text);
  assertEquals(json(set).description, "House, garden and the car");
  assertEquals(s.world.spaces.find((x) => x.id === IDS.home)?.description, "House, garden and the car");
  assertEquals(s.world.pathOf(IDS.home), "Home", "the name is unchanged");

  const cleared = await s.call("update_space", { space: "Home", description: "  " });
  assertEquals(cleared.isError, false, cleared.text);
  assertEquals(s.world.spaces.find((x) => x.id === IDS.home)?.description, null);
  await s.close();
});

Deno.test("update_space: refuses nothing to change, a '/', a taken name and an unknown space", async () => {
  const s = await openSession();
  const names = () => s.world.spaces.map((x) => `${x.name}|${x.description}`).join(",");
  const start = names();
  for (
    const args of [
      { space: "Home" },
      { space: "Home", name: "House/Garden" },
      { space: "Home", name: "recipes" }, // another top-level space, whatever the case
      { space: "Nowhere", name: "Somewhere" },
      { space: "Home", name: "" },
    ]
  ) {
    const out = await s.call("update_space", args);
    assert(out.isError, JSON.stringify(args));
  }
  assertEquals(names(), start, "nothing changed");
  assert((await s.call("update_space", { space: "Home", name: "Recipes" })).text.includes("already a space called"));

  // The same name elsewhere is fine, and so is changing only the case of its own name.
  assertEquals((await s.call("update_space", { space: "Gartner", name: "Recipes" })).isError, false);
  const cased = await s.call("update_space", { space: "Home", name: "HOME" });
  assertEquals(cased.isError, false, cased.text);
  assertEquals(s.world.pathOf(IDS.home), "HOME");
  await s.close();
});

Deno.test("update_space: never changes restricted or the parent, even when asked to", async () => {
  const s = await openSession();
  const out = await s.call("update_space", {
    space: "Private", name: "Personal", restricted: false, parent: "Work", is_restricted: false, parent_id: IDS.work,
  });
  assertEquals(out.isError, false, out.text);
  const p = s.world.spaces.find((x) => x.id === IDS.private)!;
  assertEquals(p.name, "Personal");
  assertEquals(p.is_restricted, true, "still restricted");
  assertEquals(p.parent_id, null, "not moved");
  assertEquals(json(out).restricted, true);
  // Still left out of search (rule 3).
  const found = json(await s.call("search_items", { query: "Personal" }));
  assertFalse(JSON.stringify(found).includes(IDS.private));
  await s.close();
});

Deno.test("rule 9: a password in a space's name or description is refused, never stored or echoed", async () => {
  const s = await openSession();
  const value = "Tr0ub4dor&3xq";
  for (
    const [tool, args] of [
      ["update_space", { space: "Home", description: `the alarm password is ${value}` }],
      ["update_space", { space: "Home", name: `password ${value}` }],
      ["create_space", { name: "Garage", description: `door PIN: 4821, wifi password is ${value}` }],
    ] as const
  ) {
    const out = await s.call(tool, args);
    assert(out.isError, `${tool} ${JSON.stringify(args)}`);
    assert(out.text.startsWith("Not saved"), out.text);
    assertFalse(out.text.includes(value), "the refusal never repeats the value");
  }
  assertFalse(JSON.stringify(s.world.spaces).includes(value));
  assertFalse(s.world.spaces.some((x) => x.name === "Garage"));
  // An ordinary description that talks about passwords, without one, is fine.
  const ok = await s.call("update_space", { space: "Logins", description: "Where my logins live (passwords are in the vault)" });
  assertEquals(ok.isError, false, ok.text);
  await s.close();
});
