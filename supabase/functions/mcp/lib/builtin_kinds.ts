// One kind per built-in space (docs/places-space-plan.md, owner 2026-10-29: "if I am adding a note to
// Places, I should be adding a place note; same for the built-in spaces"). Tasks holds tasks (and
// routines), Places places, Recipes recipes, Cocktails (Mocktails) drinks, Memories memories; their
// sub-spaces follow them. save_item / update_item keep a plain note saved or moved there as that kind
// and refuse a note of another kind. Turning a note into the kind never changes its title or text.
import { isPlace } from "./places.ts";
import { recipeType } from "./recipes.ts";
import type { Space } from "./spaces.ts";
import { isRoutine } from "./routines.ts";
import { isTask } from "./tasks.ts";

export type BuiltIn = "tasks" | "places" | "recipes" | "cocktails" | "memories";

/** The item_type a plain note becomes in each built-in space. */
export const KIND_TYPE: Record<BuiltIn, string> = {
  tasks: "task", places: "place", recipes: "recipe", cocktails: "cocktail", memories: "memory",
};

const WORDS: Record<BuiltIn, string> = {
  tasks: "tasks", places: "places", recipes: "recipes", cocktails: "drinks", memories: "memories",
};

/** The built-in space `s` is, or is under (Recipes/Desserts → recipes); null for the user's own and shared spaces. */
export function builtInOf(s: Space | undefined, spaces: Space[]): BuiltIn | null {
  if (!s || s.shared) return null;
  const byId = new Map(spaces.filter((x) => !x.shared).map((x) => [x.id, x]));
  const seen = new Set<string>();
  for (let cur: Space | undefined = s; cur && !seen.has(cur.id); cur = cur.parent_id ? byId.get(cur.parent_id) : undefined) {
    if (cur.built_in && cur.built_in in KIND_TYPE) return cur.built_in as BuiltIn;
    seen.add(cur.id);
  }
  return null;
}

/** What an item_type is: one of the built-in kinds, or a plain note (note, design, how-to, ...). */
export function kindOfType(itemType: string | null | undefined): "task" | "routine" | "place" | "recipe" | "cocktail" | "memory" | "plain" {
  if (isTask(itemType)) return "task";
  if (isRoutine(itemType)) return "routine";
  if (isPlace(itemType)) return "place";
  const r = recipeType(itemType);
  if (r) return r;
  if ((itemType ?? "").trim().toLowerCase() === "memory") return "memory";
  return "plain";
}

/** "fits" (the space's kind; a routine in Tasks too), "plain" (kept as the space's kind) or "wrong" (refused). */
export function fitsBuiltIn(builtIn: BuiltIn, itemType: string | null | undefined): "fits" | "plain" | "wrong" {
  const k = kindOfType(itemType);
  if (k === "plain") return "plain";
  if (k === KIND_TYPE[builtIn] || (builtIn === "tasks" && k === "routine")) return "fits";
  return "wrong";
}

/** The refusal for a note of another kind in a built-in space. */
export function onlyKind(builtIn: BuiltIn, s: Space): string {
  return `"${s.path}" holds only ${WORDS[builtIn]}; save it in another space.`;
}

/** The reply's note when a plain note was kept as the space's kind. */
export function keptAs(builtIn: BuiltIn, s: Space): string {
  return `Kept as a ${KIND_TYPE[builtIn]}: every note in "${s.path}" is a ${KIND_TYPE[builtIn]}. Its title and text are unchanged.`;
}

/** The refusal for making a note in a built-in space a plain note without moving it out. */
export function staysKind(builtIn: BuiltIn, s: Space): string {
  return `Every note in "${s.path}" is a ${KIND_TYPE[builtIn]}; to make it a plain note, move it to another space too.`;
}
