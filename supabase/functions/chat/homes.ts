// The user's homes in the chat (design D36, docs/my-places-plan.md step 2): "plan my day from Mom's"
// names one of them, and get_day_agenda's from_home is matched here. Read as the user (RLS: only their
// own rows ever come back). The model only ever gets labels: never an address, a point or an id.
import type { SupabaseClient } from "@supabase/supabase-js";

export interface Home {
  id: string;
  label: string;
  is_default: boolean;
}

/** The user's homes, the default first. Throws "db:<code>" when the table cannot be read. */
export async function readHomes(db: SupabaseClient): Promise<Home[]> {
  const { data, error } = await db.from("home_place").select("id, label, is_default").limit(20);
  if (error) throw new Error(`db:${error.code ?? "homes"}`);
  return ((data ?? []) as Partial<Home>[])
    .filter((h): h is Home => typeof h.id === "string" && typeof h.label === "string")
    .map((h) => ({ id: h.id, label: h.label, is_default: h.is_default === true }))
    .sort((a, b) => Number(b.is_default) - Number(a.is_default));
}

/** "Mom's", "moms", "my mom’s", "Mom's house" all compare as "mom". */
function key(label: string): string {
  return label.toLowerCase().normalize("NFKC")
    .replace(/[’‘`´']/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/^(?:my|the|our) /, "")
    .replace(/ (?:house|place|home|apartment|flat)$/, "")
    .replace(/s$/, "")
    .trim();
}

/** The home the user named, or null. An exact name wins; else one loose match (never a guess between two). */
export function matchHome(homes: Home[], named: string): Home | null {
  const exact = homes.filter((h) => h.label.trim().toLowerCase() === named.trim().toLowerCase());
  if (exact.length === 1) return exact[0];
  const k = key(named);
  if (!k) return null;
  const loose = homes.filter((h) => key(h.label) === k);
  return loose.length === 1 ? loose[0] : null;
}

/** For the model when a name matches no home: the labels only. */
export function noSuchHome(homes: Home[], named: string): string {
  const quoted = named.trim().slice(0, 60).replace(/"/g, "'");
  return homes.length
    ? `No saved home is called "${quoted}". The user's homes: ${homes.map((h) => h.label).join(", ")}. Ask which one ` +
      "they mean, or offer to save it as a home (save_home)."
    : `The user has no saved homes yet, so there is no "${quoted}" to plan from. Offer to save it as a home (save_home).`;
}
