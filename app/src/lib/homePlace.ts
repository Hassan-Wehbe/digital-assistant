// Homes (design D36, docs/my-places-plan.md step 3): the places a day is planned from, in their own
// table `home_place` (one row each, at most 10, one name once, exactly one default), never notes.
// Read and written as the signed-in user through Supabase, so RLS keeps each person to their own
// rows (rule 5). The default moves only through `set_default_home(id)`: the app never writes
// `is_default` (the database does not let it). The first home saved becomes the default, and
// deleting the default passes it to the oldest home left; the database does both.
//
// Used by Settings → Homes (app/homes.tsx), My day's "Where do you leave from?" and its "Planned
// from … · Change", and the chat's 🏠 card (a `home_save` event: nothing is written until the tap).
// Text that looks like a password or a code is refused here, before anything is sent (rule 9).
//
// A deleted home is gone (Q6): it is a setting, not a note, so there is no Recycle bin or revision.
import { findCredential } from './credentials';
import { HOME_KIND } from './places';
import type { SearchResult } from './wilma';

export const HOME_TITLE = 'Home';
export const MAX_HOMES = 10;
export const MAX_LABEL = 60;
export const MAX_ADDRESS = 300;

/** One saved home, as the app reads it. */
export interface HomeRow {
  id: string;
  label: string;
  address: string | null;
  lat: number;
  lng: number;
  is_default: boolean;
}

/** What the app may write (the database's column grants: never `is_default` or the owner). */
export interface HomeFields {
  label: string;
  address: string | null;
  lat: number;
  lng: number;
}

type Result = PromiseLike<{ data: unknown; error: unknown }>;

/** The part of the Supabase client used here (so the tests need no network). */
export interface HomesDb {
  from(table: 'home_place'): {
    select(columns: string): {
      order(column: 'is_default', o: { ascending: false }): { order(column: 'created_at', o: { ascending: true }): Result };
    };
    insert(row: HomeFields): { select(columns: string): { single(): Result } };
    update(changes: Partial<HomeFields>): { eq(column: 'id', value: string): { select(columns: string): { single(): Result } } };
    delete(): { eq(column: 'id', value: string): Result };
  };
  rpc(fn: 'set_default_home', args: { p_id: string }): Result;
}

const COLUMNS = 'id, label, address, lat, lng, is_default';

export const CREDENTIAL_TEXT =
  'That looks like a password or a code, so it was not saved. Homes are not secret: keep codes in the Vault.';
export const NOT_SAVED = 'That wasn’t saved. Check your connection and try again.';
export const CANT_READ = 'Your homes cannot be read right now. Check your connection and try again.';

const onMap = (lat: unknown, lng: unknown): boolean =>
  typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

/** "  Mom's \n house " → "Mom's house" (one line, as the database keeps it). */
export const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Two names are the same home when they match ignoring case and spaces (the database's rule). */
export const sameName = (a: string, b: string) => oneLine(a).toLowerCase() === oneLine(b).toLowerCase();

/** A row as read, checked; null when anything is off. */
export function toHome(raw: unknown): HomeRow | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !r.id || typeof r.label !== 'string' || !r.label.trim() || !onMap(r.lat, r.lng)) return null;
  return {
    id: r.id,
    label: r.label,
    address: typeof r.address === 'string' && r.address.trim() ? r.address : null,
    lat: r.lat as number,
    lng: r.lng as number,
    is_default: r.is_default === true,
  };
}

/** The fields to write, checked and tidied, or a sentence saying why not. Nothing is sent before this. */
export function checkHome(h: { label: string; address?: string | null; lat: number; lng: number }): { fields: HomeFields } | { error: string } {
  const label = oneLine(h.label ?? '');
  const address = oneLine(h.address ?? '');
  if (findCredential(label) || (address && findCredential(address))) return { error: CREDENTIAL_TEXT };
  if (!label) return { error: 'Give the home a name, like Home or Mom’s.' };
  if (label.length > MAX_LABEL) return { error: `A home’s name can be at most ${MAX_LABEL} characters.` };
  if (address.length > MAX_ADDRESS) return { error: `An address can be at most ${MAX_ADDRESS} characters.` };
  if (!onMap(h.lat, h.lng)) return { error: 'That spot is not on the map. Pick the address again.' };
  return { fields: { label, address: address || null, lat: h.lat, lng: h.lng } };
}

/** The database's refusal in plain words (the limit's own sentence is already plain). */
export function homeError(error: unknown, label?: string): string {
  const e = (error ?? {}) as { code?: unknown; message?: unknown };
  const message = typeof e.message === 'string' ? e.message : '';
  if (e.code === 'P0001' && message.startsWith('You can save at most')) return message;
  if (e.code === '23505') return label ? `You already have a home called “${oneLine(label)}”. Pick another name.` : 'You already have a home with that name.';
  if (e.code === '23514') return 'That name or address is too long, or the spot is not on the map.';
  return NOT_SAVED;
}

/** Default first, then in the order they were saved. Throws a plain sentence when they cannot be read. */
export async function listHomes(db: HomesDb): Promise<HomeRow[]> {
  let out: { data: unknown; error: unknown };
  try {
    out = await db.from('home_place').select(COLUMNS).order('is_default', { ascending: false }).order('created_at', { ascending: true });
  } catch {
    throw new Error(CANT_READ);
  }
  if (out.error || !Array.isArray(out.data)) throw new Error(CANT_READ);
  return out.data.map(toHome).filter((h): h is HomeRow => h !== null);
}

export type HomeResult = { home: HomeRow } | { error: string };

async function one(run: () => Result, label?: string): Promise<HomeResult> {
  try {
    const { data, error } = await run();
    if (error) return { error: homeError(error, label) };
    const home = toHome(data);
    return home ? { home } : { error: NOT_SAVED };
  } catch {
    return { error: NOT_SAVED };
  }
}

/** A new home (the first one becomes the default by itself). */
export async function addHome(db: HomesDb, h: { label: string; address?: string | null; lat: number; lng: number }): Promise<HomeResult> {
  const checked = checkHome(h);
  if ('error' in checked) return checked;
  return one(() => db.from('home_place').insert(checked.fields).select(COLUMNS).single(), checked.fields.label);
}

/** A new name, address or point for a home (its other fields as they are). */
export async function changeHome(db: HomesDb, home: HomeRow, changes: Partial<HomeFields>): Promise<HomeResult> {
  const checked = checkHome({ ...home, ...changes });
  if ('error' in checked) return checked;
  return one(() => db.from('home_place').update(checked.fields).eq('id', home.id).select(COLUMNS).single(), checked.fields.label);
}

/** Moves the ★ to this home (the one database function that may). True when it worked. */
export async function makeDefault(db: HomesDb, id: string): Promise<boolean> {
  try {
    const { error } = await db.rpc('set_default_home', { p_id: id });
    return !error;
  } catch {
    return false;
  }
}

/** Deletes a home for good (the caller asked to confirm first). True when it worked. */
export async function deleteHome(db: HomesDb, id: string): Promise<boolean> {
  try {
    const { error } = await db.from('home_place').delete().eq('id', id);
    return !error;
  } catch {
    return false;
  }
}

/**
 * Saves a home at a spot, by name: the home with that name gets the new address and point ("I
 * moved", "Where do you leave from?" again), otherwise a new home is added. With `asDefault`, it
 * then becomes the default. `replaced`: an existing home was changed.
 */
export async function saveHomeAt(
  db: HomesDb,
  h: { label: string; address?: string | null; lat: number; lng: number },
  opts: { asDefault?: boolean } = {},
): Promise<{ home: HomeRow; replaced: boolean } | { error: string }> {
  const checked = checkHome(h);
  if ('error' in checked) return checked;
  let homes: HomeRow[];
  try {
    homes = await listHomes(db);
  } catch (e) {
    return { error: e instanceof Error ? e.message : NOT_SAVED };
  }
  const same = homes.find((x) => sameName(x.label, checked.fields.label));
  const { label: _, ...place } = checked.fields;
  const out = same ? await changeHome(db, same, place) : await addHome(db, checked.fields);
  if ('error' in out) return out;
  if (opts.asDefault && !out.home.is_default) {
    if (!(await makeDefault(db, out.home.id))) return { error: `“${out.home.label}” was saved, but not made the default. Try Make default in Settings → Homes.` };
    return { home: { ...out.home, is_default: true }, replaced: !!same };
  }
  return { home: out.home, replaced: !!same };
}

/** "🏠 Home ★ · 12 Oak St, Oviedo" (a list row). */
export function homeLine(h: Pick<HomeRow, 'label' | 'address' | 'is_default'>): string {
  return `🏠 ${h.label}${h.is_default ? ' ★' : ''}${h.address ? ` · ${h.address}` : ''}`;
}

// ---- The chat's 🏠 card ------------------------------------------------------------------------

/** What the server's `home_save` event says (chat/phone_actions.ts save_home). */
export interface HomeCardData {
  label: string;
  /** What the user said; null when they gave none ("I'm home": Use where I am). */
  address: string | null;
  /** The user asked for it to be the default ("I moved", "my home is ..."). */
  makeDefault: boolean;
}

/** The event's (or a saved entry's) fields, checked; null when malformed. */
export function toHomeCard(raw: unknown, makeDefaultKey: 'make_default' | 'makeDefault'): HomeCardData | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.label !== 'string' || !oneLine(r.label) || r.label.length > MAX_LABEL) return null;
  if (r.address !== undefined && r.address !== null && (typeof r.address !== 'string' || r.address.length > MAX_ADDRESS)) return null;
  const address = typeof r.address === 'string' && oneLine(r.address) ? oneLine(r.address) : null;
  return { label: oneLine(r.label), address, makeDefault: r[makeDefaultKey] === true };
}

export type HomeCardButton = 'save' | 'default';

/**
 * The card's buttons (plan, small questions: Save as default only when a default already exists):
 * the first home is just Save (it becomes the default); a home that is already the default is just
 * Save; otherwise Save and Save as default, the one Wilma was asked for first (filled).
 * `homes` null: they could not be read, so both are offered.
 */
export function homeCardButtons(homes: HomeRow[] | null, card: HomeCardData): { buttons: HomeCardButton[]; main: HomeCardButton; replaces?: HomeRow } {
  const same = homes?.find((h) => sameName(h.label, card.label));
  if (homes && (!homes.some((h) => h.is_default) || same?.is_default)) return { buttons: ['save'], main: 'save', ...(same ? { replaces: same } : {}) };
  return { buttons: ['save', 'default'], main: card.makeDefault ? 'default' : 'save', ...(same ? { replaces: same } : {}) };
}

// ---- Picking a spot (My day, Settings → Homes) -------------------------------------------------

/** A place picked for a home or for an event: a point and the words to show for it. */
export interface PickedSpot {
  lat: number;
  lng: number;
  label: string;
  address?: string;
  /** The saved place's note id, when one was picked. */
  id?: string;
  /** Use where I am: a reading of the phone, with no words for it. */
  here?: true;
}

/** Search results that are places with a location (old Home notes left out), as picks. */
export function savedSpots(results: SearchResult[]): (PickedSpot & { id: string })[] {
  const out: (PickedSpot & { id: string })[] = [];
  for (const r of results) {
    const p = r.place;
    if (r.item_type !== 'place' || !p || p.kind === HOME_KIND) continue;
    const { lat, lng } = p;
    if (!onMap(lat, lng)) continue;
    out.push({ id: r.id, lat: lat as number, lng: lng as number, label: r.title, ...(p.address ? { address: p.address } : {}) });
  }
  return out;
}

/** The address to keep for a picked spot: the street and town found, else a saved place's name; none for "where I am". */
export const spotAddress = (spot: PickedSpot): string | null => (spot.here ? null : spot.address?.trim() || spot.label.trim() || null);

// ---- The place picker's list (docs/places-space-plan.md step 3, D45) ---------------------------

/** One row of the picker: a spot to use now, a place to look up first, or one that needs an address. */
export type PickRow =
  | { row: 'spot'; spot: PickedSpot; kind?: string; home?: true }
  /** An address but no spot: the phone's map lookup finds it when picked (Is this it?). */
  | { row: 'lookup'; id: string; label: string; address: string; kind?: string }
  /** Neither: the place opens so an address can be added. */
  | { row: 'no_address'; id: string; label: string; kind?: string };

/**
 * Every place the picker offers (Denisse's case: a place without a spot is no longer invisible):
 * homes first (`homes`), then places, those in Places (or under it) before those elsewhere, each
 * group in the order given (newest first from search). Old Home notes (D36) are left out.
 */
export function pickRows(homes: HomeRow[], results: SearchResult[], placesPath = 'Places'): PickRow[] {
  const rows: PickRow[] = homes.map((h) => ({
    row: 'spot',
    home: true,
    kind: HOME_KIND,
    spot: { lat: h.lat, lng: h.lng, label: h.label, ...(h.address ? { address: h.address } : {}) },
  }));
  const inPlaces = (r: SearchResult) => r.space === placesPath || !!r.space?.startsWith(`${placesPath}/`);
  const places = results.filter((r) => r.item_type === 'place' && r.place?.kind !== HOME_KIND);
  for (const r of [...places.filter(inPlaces), ...places.filter((r) => !inPlaces(r))]) {
    const p = r.place ?? {};
    const kind = typeof p.kind === 'string' ? p.kind : undefined;
    const address = p.address?.trim();
    if (onMap(p.lat, p.lng)) {
      rows.push({ row: 'spot', kind, spot: { id: r.id, lat: p.lat as number, lng: p.lng as number, label: r.title, ...(address ? { address } : {}) } });
    } else if (address) rows.push({ row: 'lookup', id: r.id, label: r.title, address, kind });
    else rows.push({ row: 'no_address', id: r.id, label: r.title, kind });
  }
  return rows;
}

/** The rows whose name, address or kind has the typed words (all of them; case and accents aside). */
export function filterRows(rows: PickRow[], words: string): PickRow[] {
  const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const want = fold(words).split(/\s+/).filter(Boolean);
  if (!want.length) return rows;
  return rows.filter((r) => {
    const label = r.row === 'spot' ? r.spot.label : r.label;
    const address = r.row === 'spot' ? r.spot.address : r.row === 'lookup' ? r.address : '';
    const hay = fold([label, address ?? '', r.kind ?? ''].join(' '));
    return want.every((w) => hay.includes(w));
  });
}
