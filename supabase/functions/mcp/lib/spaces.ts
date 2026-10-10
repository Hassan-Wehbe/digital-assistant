// Spaces are addressed by people as names or paths ("Work/Gartner"), by the
// model sometimes as ids. Load the user's spaces once per call and resolve.
import type { SupabaseClient } from "@supabase/supabase-js";

export interface Space {
  id: string;
  name: string;
  description: string | null;
  parent_id: string | null;
  is_restricted: boolean;
  /** "tasks" or "memories" on the account's built-in spaces (they cannot be deleted, renamed,
   * moved or restricted; 20261012120000_memory_builtin_spaces.sql); null on the user's own. */
  built_in?: string | null;
  path: string;
}

/** The refusal Wilma passes on for a built-in space ("Tasks", "Memories"). */
export function builtInRefusal(s: Space, what: "deleted" | "renamed"): string {
  return `"${s.name}" is a built-in space, so it can't be ${what}.` +
    (what === "renamed" ? " Its description can change." : " The notes in it can be deleted one by one.");
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function loadSpaces(db: SupabaseClient): Promise<Space[]> {
  const { data, error } = await db
    .from("space")
    .select("id, name, description, parent_id, is_restricted, built_in");
  if (error) throw new Error(`could not load spaces: ${error.message}`);
  const byId = new Map(data.map((s) => [s.id as string, s]));
  const pathOf = (id: string, seen = new Set<string>()): string => {
    const s = byId.get(id)!;
    if (!s.parent_id || seen.has(id) || !byId.has(s.parent_id)) return s.name;
    seen.add(id);
    return `${pathOf(s.parent_id, seen)}/${s.name}`;
  };
  return data
    .map((s) => ({ ...s, path: pathOf(s.id) }) as Space)
    .sort((a, b) => a.path.localeCompare(b.path));
}

const norm = (s: string) =>
  s.trim().toLowerCase().replace(/\s*(?:\/|>)\s*/g, "/");

/** Find a space by id, full path ("Work/Gartner") or unique name. Throws a helpful error otherwise. */
export function resolveSpace(spaces: Space[], ref: string): Space {
  const r = ref.trim();
  if (UUID.test(r)) {
    const hit = spaces.find((s) => s.id === r);
    if (hit) return hit;
  }
  const byPath = spaces.find((s) => norm(s.path) === norm(r));
  if (byPath) return byPath;
  const byName = spaces.filter((s) => norm(s.name) === norm(r));
  if (byName.length === 1) return byName[0];
  if (byName.length > 1) {
    throw new Error(
      `"${ref}" matches several spaces: ${byName.map((s) => s.path).join(", ")}. Use the full path.`,
    );
  }
  const known = spaces.map((s) => s.path).join(", ") || "(none yet)";
  throw new Error(`No space called "${ref}". Existing spaces: ${known}. Use create_space to add one.`);
}
