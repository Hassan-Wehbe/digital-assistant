// Where a message from the box goes (docs/phase5-a5d-one-box-plan.md, steps 4 and 6): the
// router's rules (router.ts) with the user's own names read from our server. Only a message that
// may be a name is read for: a sentence goes straight to Wilma with no extra call. Any failure
// (offline, an error, a sign-out under way) means Wilma, which then says what is wrong as it
// does today.
//
// Step 6: a short message that matches no name at all may be a search ("lasagna recipe"). The
// server's cheap classifier decides (chat function, classify.ts); on `search` the app runs the
// read-only note search itself (restricted spaces are never searched) and shows the notes, with
// "Ask Wilma instead". Anything else, no notes, or any failure: Wilma (D4).

import type { NoteRef } from './chatThread';
import { parseLookup, placeLookup, secretNames, type Lookup, type Route } from './router';
import type { SearchResult, SecretMeta, Space } from './wilma';

export type Verdict = { route: 'search'; query: string } | { route: 'wilma' };

export interface RouteReads {
  /** All the user's spaces, restricted ones marked (the router leaves them out). */
  spaces(): Promise<Space[]>;
  /** The user's secrets matching these words (names and metadata only; never values). */
  findSecrets(query: string): Promise<SecretMeta[]>;
  /** The server's classifier; left out when it must not be asked (allowance used up). */
  classify?(text: string): Promise<Verdict>;
  /** The note search (restricted spaces are never searched). */
  searchNotes?(query: string): Promise<SearchResult[]>;
}

/** Notes shown for a search the classifier recognised. */
export const MAX_NOTES = 5;

export type MessageRoute = Route | { to: 'notes'; query: string; notes: NoteRef[] };

/** A search result as a notes card shows it: id, title, space and snippet only. */
export function toNoteRef(r: SearchResult): NoteRef {
  return { id: r.id, title: r.title, ...(r.space ? { space: r.space } : {}), ...(r.snippet ? { snippet: r.snippet } : {}) };
}

const WILMA: Route = { to: 'wilma' };

/** A message with vault words ("bank pin") is never a note search: the server would refuse it anyway. */
const mentionsVault = (lookup: Lookup) => lookup.vault.length < lookup.common.length;

export async function routeMessage(text: string, reads: RouteReads): Promise<MessageRoute> {
  const lookup = parseLookup(text);
  if (!lookup) return WILMA;
  let placed: Route | null;
  try {
    const [spaces, secrets] = await Promise.all([reads.spaces(), reads.findSecrets(lookup.query)]);
    placed = placeLookup(lookup, spaces, secretNames(secrets));
  } catch {
    return WILMA;
  }
  if (placed) return placed;
  if (!reads.classify || !reads.searchNotes || mentionsVault(lookup)) return WILMA;
  try {
    const verdict = await reads.classify(text);
    if (verdict.route !== 'search' || !verdict.query.trim()) return WILMA;
    const notes = (await reads.searchNotes(verdict.query)).slice(0, MAX_NOTES).map(toNoteRef);
    return notes.length ? { to: 'notes', query: verdict.query, notes } : WILMA;
  } catch {
    return WILMA;
  }
}
