// Automatic memory (docs/memory-plan.md, design D24, D30): each memory is a short note, item_type
// "memory", in the account's built-in Memories space. This module saves one (new, or a changed
// fact replacing an older memory) with the server's own checks, so the model is never trusted with
// them (rules 1, 3 and 9):
//   * nothing that looks like a credential is ever stored (rejectCredentials, as save_item);
//   * only into the built-in Memories space, never a restricted one;
//   * the same fact is not saved twice;
//   * a changed fact updates the older memory, whose old text goes to item_revision (rule 7).
// Step 2 (noticing in the chat, chat/memory.ts) calls saveMemory when the user has memory on.
import type { SupabaseClient } from "@supabase/supabase-js";
import { findCredential, rejectCredentials } from "./credentials.ts";
import { chunkAndEmbed } from "./embed.ts";
import { loadSpaces, type Space } from "./spaces.ts";

export const MEMORY_TYPE = "memory";
export const MEMORIES_SPACE = "Memories";
/** A memory is one short fact, as a title. */
export const MAX_MEMORY_CHARS = 200;
const MIN_MEMORY_CHARS = 3;

export interface MemoryInput {
  fact: string;
  /** The older memory this fact changes ("Lexi swims on Wednesdays now"): updated, not duplicated. */
  replaces?: string;
  /** When it was said, "2026-10-10"; kept in metadata. */
  on?: string;
}

export type MemoryOutcome =
  | { saved: "new"; id: string; fact: string }
  | { saved: "updated"; id: string; fact: string; was: string }
  | { saved: "duplicate"; id: string; fact: string };

/** "  Lexi swims   on Tuesdays. " → "Lexi swims on Tuesdays". Throws when it is not a usable fact. */
export function cleanFact(fact: string): string {
  const out = fact.replace(/\s+/g, " ").trim().replace(/[.\s]+$/, "");
  if (out.length < MIN_MEMORY_CHARS) throw new Error("A memory needs a few words.");
  if (out.length > MAX_MEMORY_CHARS) throw new Error(`A memory is one short fact (at most ${MAX_MEMORY_CHARS} characters).`);
  return out;
}

const sameFact = (a: string, b: string) => a.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim() === b.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** app_user.memory_on: off by default (Q3), and off when it cannot be read. */
export async function memoryOn(db: SupabaseClient, userId: string): Promise<boolean> {
  const { data, error } = await db.from("app_user").select("memory_on").eq("id", userId).maybeSingle();
  return !error && (data as { memory_on?: unknown } | null)?.memory_on === true;
}

/**
 * The built-in Memories space (made for every account, 20261012120000_memory_builtin_spaces.sql).
 * Never a restricted space; an error if it is missing (it cannot be deleted, so that means the
 * migration has not run).
 */
export function memoriesSpace(spaces: Space[]): Space {
  const hit = spaces.find((s) => s.built_in === "memories") ??
    spaces.find((s) => !s.parent_id && !s.is_restricted && s.name.trim().toLowerCase() === MEMORIES_SPACE.toLowerCase());
  if (!hit || hit.is_restricted) throw new Error("There is no Memories space for this account.");
  return hit;
}

interface MemoryRow {
  id: string;
  title: string;
  space_id: string;
  item_type: string;
}

/** The account's current memories (not in the bin), newest first. */
export async function listMemories(db: SupabaseClient, space: Space): Promise<MemoryRow[]> {
  const { data, error } = await db
    .from("item")
    .select("id, title, space_id, item_type")
    .eq("space_id", space.id)
    .eq("item_type", MEMORY_TYPE)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(1000);
  if (error) throw new Error(`Could not read memories: ${error.message}`);
  // Checked again here, whatever the database returned.
  return ((data ?? []) as MemoryRow[]).filter((r) => r.space_id === space.id && r.item_type === MEMORY_TYPE);
}

/** Saves one memory with the server's checks (top of the file). */
export async function saveMemory(db: SupabaseClient, input: MemoryInput, assistantName?: string): Promise<MemoryOutcome> {
  const fact = cleanFact(input.fact);
  // Rule 9: a memory is never a credential, whatever the model thought.
  rejectCredentials({ fact }, assistantName);
  const space = memoriesSpace(await loadSpaces(db));
  const existing = await listMemories(db, space);

  const same = existing.find((m) => sameFact(m.title, fact));
  if (same) return { saved: "duplicate", id: same.id, fact: same.title };

  const metadata = { source: "chat", ...(input.on ? { on: input.on } : {}) };
  const chunks = await chunkAndEmbed({ title: fact, body: "" });

  if (input.replaces) {
    const old = existing.find((m) => m.id === input.replaces);
    if (!old) throw new Error("The memory to replace is not one of this account's memories.");
    const { error } = await db.rpc("update_item", {
      p_item_id: old.id,
      p_title: fact,
      p_body: null,
      p_summary: null,
      p_metadata: metadata,
      p_item_type: null,
      p_space_id: null,
      p_tags: null,
      p_change_note: "Changed by what the user said",
      p_chunks: chunks,
    });
    if (error) throw new Error(`Could not update the memory: ${error.message}`);
    return { saved: "updated", id: old.id, fact, was: old.title };
  }

  const { data, error } = await db.rpc("save_item", {
    p_space_id: space.id,
    p_item_type: MEMORY_TYPE,
    p_title: fact,
    p_body: "",
    p_summary: null,
    p_metadata: metadata,
    p_tags: [],
    p_chunks: chunks,
  });
  if (error) throw new Error(`Could not save the memory: ${error.message}`);
  return { saved: "new", id: String(data), fact };
}

/** Memories in each chat turn's "About the user" block (Q6), and at most this many characters. */
export const MAX_ABOUT = 30;
export const MAX_ABOUT_CHARS = 3_000;

/**
 * The newest memories for the chat's "About the user" block (step 4): titles only, newest first,
 * none when memory is off or anything cannot be read. Only the built-in Memories space (never a
 * restricted one, rule 3); anything that looks like a credential is left out, whoever wrote it
 * (rule 1: a memory edited by hand went through update_item's check, this is the second one).
 */
export async function memoriesForPrompt(db: SupabaseClient, userId: string): Promise<string[]> {
  try {
    if (!(await memoryOn(db, userId))) return [];
    const memories = await listMemories(db, memoriesSpace(await loadSpaces(db)));
    const out: string[] = [];
    let chars = 0;
    for (const m of memories) {
      const title = m.title.replace(/\s+/g, " ").trim().slice(0, MAX_MEMORY_CHARS);
      if (!title || findCredential(title)) continue;
      if (out.length >= MAX_ABOUT || chars + title.length > MAX_ABOUT_CHARS) break;
      out.push(title);
      chars += title.length;
    }
    return out;
  } catch {
    return [];
  }
}
