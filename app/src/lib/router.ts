// The one box's router (docs/phase5-a5d-one-box-plan.md "How the router decides"): decides,
// without any model and without the network, whether a message is only the name of one space or
// one secret. Anything else, and anything uncertain, goes to Wilma.
//
// Step A, `parseLookup(text)`: is this message only a name? Write words, values ("... is x",
// ":", "=") and sentences go to Wilma. Otherwise it gives the words to look for (`query`, for the
// server's vault search).
// Step B, `pickLookup(lookup, spaces, secrets)`: exactly one space or secret with that name, or
// Wilma. Restricted spaces, and everything inside them, are left out before matching (CLAUDE.md
// rule 3). Secrets come in as names, ids and kinds only (`secretNames`), never addresses, links or
// values (rule 1).

import type { SecretMeta, Space } from './wilma';

/** Where a message goes. */
export type Route =
  | { to: 'wilma' }
  | { to: 'space'; space: { id: string; path: string; name: string } }
  | { to: 'secret'; secret: SecretName };

/** All the router ever knows about a secret. */
export interface SecretName {
  id: string;
  name: string;
  secretType: string;
  /** The path of the secret's space, to leave out restricted ones. */
  space?: string;
}

/** A message that may be a name (step A), ready for step B. */
export interface Lookup {
  /** The words to give the server's vault search (as typed, fillers left out). */
  query: string;
  /** The message's words without the common fillers. */
  common: string[];
  /** The same without the vault's generic words too (may be empty: "my PIN"). */
  vault: string[];
}

const WILMA: Route = { to: 'wilma' };

/** More than this many words left after the fillers: a sentence, not a name. */
const MAX_WORDS = 5;
/** Longer messages are never only a name. */
const MAX_LENGTH = 200;
/** A name needs at least this many letters for one typo to be forgiven. */
const TYPO_MIN = 6;

/** Words that ask for something to be done: such a message always goes to Wilma. */
const WRITE_WORDS = new Set([
  'save', 'store', 'keep', 'add', 'put', 'delete', 'remove', 'erase', 'purge', 'clear', 'trash',
  'empty', 'update', 'change', 'edit', 'rename', 'move', 'replace', 'set', 'create', 'make', 'new',
  'remember', 'forget', 'write', 'send', 'share', 'attach', 'upload', 'restore', 'copy',
]);

/** Words around a name in a lookup ("open the Recipes space", "what's my ..."). */
const COMMON_FILLERS = new Set([
  'open', 'show', 'find', 'get', 'give', 'tell', 'see', 'view', 'look', 'go', 'to', 'at', 'up',
  'my', 'me', 'mine', 'our', 'the', 'a', 'an', 'please', 'pls', 'what', 'whats', 'is', 'are',
  'where', 'wheres', 'which', 'i', 'im', 'ive', 'need', 'want', 'forgot', 'lost', 'can', 'could',
  'you', 'would', 'for', 'of', 'on', 'in', 'and', 'space', 'folder', 'hi', 'hey', 'wilma',
]);

/** The vault's generic words, as the server's vault search drops them (mcp/lib/vault.ts). */
const VAULT_WORDS = new Set([
  'password', 'pass', 'passcode', 'passphrase', 'pin', 'code', 'login', 'credential', 'secret',
  'details', 'account',
]);

/** Words that introduce a value ("the wifi password is ...")... */
const VALUE_WORDS = new Set(['is', 'was', 'are', 'were']);
/** ...unless they follow a question word ("what is", "where are"). */
const QUESTION_WORDS = new Set(['what', 'where', 'which']);

interface Word {
  /** As typed, without surrounding punctuation (sent to the server's search). */
  raw: string;
  /** Lower case, no accents or marks, no hyphens or apostrophes. */
  norm: string;
}

/** Lower case, accents and Arabic marks removed, apostrophes and hyphens dropped. */
function normalise(word: string): string {
  return word
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/ـ/g, '') // Arabic tatweel
    .toLowerCase()
    .replace(/['’ʼ`\-‐‑–—]/g, '')
    .replace(/[^\p{L}\p{N}]/gu, '');
}

function words(text: string): Word[] {
  return text
    .split(/[\s/\\,;.!?()[\]{}"“”«»|+*&#@<>~^]+/u)
    .map((w) => ({ raw: w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''), norm: normalise(w) }))
    .filter((w) => w.norm);
}

/** "recipes" and "recipe" are the same name; "pass" and "address" keep their s. */
function singular(word: string): string {
  return word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word;
}

const isIn = (set: Set<string>, word: string) => set.has(word) || set.has(singular(word));

/**
 * Step A. The words to look for when the message may be only a name, or null for Wilma:
 * a write word, a value being given, an empty remainder or more than five words.
 */
export function parseLookup(text: string): Lookup | null {
  if (text.length > MAX_LENGTH || /[:=]/.test(text)) return null;
  const all = words(text);
  if (all.some((w) => isIn(WRITE_WORDS, w.norm))) return null;
  // "the wifi is hunter2": a value is being given, so the words never go to the vault search.
  if (all.some((w, i) => VALUE_WORDS.has(w.norm) && !(i > 0 && QUESTION_WORDS.has(all[i - 1].norm)))) return null;
  const kept = all.filter((w) => !isIn(COMMON_FILLERS, w.norm));
  if (!kept.length || kept.length > MAX_WORDS) return null;
  return {
    query: kept.map((w) => w.raw).join(' '),
    common: kept.map((w) => singular(w.norm)),
    vault: kept.filter((w) => !isIn(VAULT_WORDS, w.norm)).map((w) => singular(w.norm)),
  };
}

/** A name's comparable forms: without common fillers, and without vault words too. */
function nameForms(name: string): { common: string; vault: string } {
  const all = words(name).map((w) => w.norm);
  const common = all.filter((w) => !isIn(COMMON_FILLERS, w));
  // A name made only of fillers ("Open") still has a form: all its words.
  const base = (common.length ? common : all).map(singular);
  return { common: base.join(''), vault: base.filter((w) => !isIn(VAULT_WORDS, w)).join('') };
}

/** At most one letter off (missing, extra, changed, or two swapped), counted in characters. */
export function oneTypo(a: string, b: string): boolean {
  const x = Array.from(a);
  const y = Array.from(b);
  if (Math.abs(x.length - y.length) > 1) return false;
  let i = 0;
  while (i < x.length && i < y.length && x[i] === y[i]) i++;
  if (i === x.length && i === y.length) return true;
  const rest = (p: string[], q: string[]) => p.join('') === q.join('');
  return (
    rest(x.slice(i + 1), y.slice(i + 1)) || // changed
    rest(x.slice(i + 1), y.slice(i)) || // extra in a
    rest(x.slice(i), y.slice(i + 1)) || // extra in b
    (x[i] === y[i + 1] && x[i + 1] === y[i] && rest(x.slice(i + 2), y.slice(i + 2))) // swapped
  );
}

/** Restricted spaces' paths: they and every space inside them are never matched. */
function restrictedPaths(spaces: Space[]): string[] {
  return spaces.filter((s) => s.restricted).map((s) => s.path.toLowerCase());
}

function insideRestricted(path: string | undefined, restricted: string[]): boolean {
  if (path === undefined) return false;
  const p = path.toLowerCase();
  return restricted.some((r) => p === r || p.startsWith(`${r}/`));
}

/** A secret as the router may see it: id, name, kind and its space's path; nothing else. */
export function secretNames(secrets: SecretMeta[]): SecretName[] {
  return secrets.map((s) => ({
    id: s.id,
    name: s.name,
    secretType: s.secret_type,
    ...(s.space !== undefined ? { space: s.space } : {}),
  }));
}

type Candidate = { route: Route; keys: { msg: string; name: string }[] };

/**
 * Step B. Exactly one space or secret whose name is the message, or Wilma. Exact names first;
 * only when nothing matches exactly, one typo in a name of six or more letters.
 */
export function pickLookup(lookup: Lookup, spaces: Space[], secrets: SecretName[]): Route {
  const restricted = restrictedPaths(spaces);
  const msgCommon = lookup.common.join('');
  const msgVault = lookup.vault.join('');
  const candidates: Candidate[] = [];

  for (const s of spaces) {
    if (s.restricted || insideRestricted(s.path, restricted)) continue;
    const segments = s.path.split('/');
    const name = segments[segments.length - 1];
    const own = nameForms(name).common;
    const full = segments.map((seg) => nameForms(seg).common).join('');
    candidates.push({
      route: { to: 'space', space: { id: s.id, path: s.path, name } },
      keys: [{ msg: msgCommon, name: own }, ...(full !== own ? [{ msg: msgCommon, name: full }] : [])],
    });
  }

  for (const s of secrets) {
    if (insideRestricted(s.space, restricted)) continue;
    const forms = nameForms(s.name);
    const keys = [{ msg: msgCommon, name: forms.common }];
    // "bank" finds "Bank login": both without the vault's generic words.
    if (msgVault && forms.vault) keys.push({ msg: msgVault, name: forms.vault });
    candidates.push({ route: { to: 'secret', secret: s }, keys });
  }

  const exact = candidates.filter((c) => c.keys.some((k) => k.name && k.msg === k.name));
  if (exact.length) return exact.length === 1 ? exact[0].route : WILMA;
  const near = candidates.filter((c) =>
    c.keys.some((k) => Array.from(k.name).length >= TYPO_MIN && oneTypo(k.msg, k.name)),
  );
  return near.length === 1 ? near[0].route : WILMA;
}
