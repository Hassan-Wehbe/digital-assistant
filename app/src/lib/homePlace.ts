// "Where do you leave from?" (day planner step 2, first use; mockups screen 5): the Home place the
// planner times drives from. It is a place note of kind "home" (at most one: the server refuses a
// second), kept with the user's places in an unrestricted "Places" space, so the planner can read
// it (restricted spaces never add anything to a plan, CLAUDE.md rule 3). Changing it updates that
// same note; the server keeps the previous version first (rule 7).
import { HOME_KIND, type PlaceMetadata } from './places';
import type { NewSpace, SearchResult, Space } from './wilma';

export const HOME_TITLE = 'Home';
export const PLACES_SPACE = 'Places';

export interface HomeDeps {
  listSpaces: () => Promise<Space[]>;
  createSpace: (s: NewSpace) => Promise<{ id: string }>;
  search: (opts: { query?: string; limit: number; item_type: string }) => Promise<SearchResult[]>;
  saveItem: (item: { space: string; title: string; body: string; item_type: string; metadata: PlaceMetadata }) => Promise<{ id: string }>;
  updateItem: (id: string, changes: { metadata: PlaceMetadata }) => Promise<unknown>;
}

export interface HomeSpot {
  lat: number;
  lng: number;
  /** The street and town, when known (typed, or from a saved place). */
  address?: string;
}

const isHome = (r: SearchResult) => r.item_type === 'place' && r.place?.kind === HOME_KIND;

/** The Home place's note id, looked up by its name (the plan says only its label). */
export async function findHome(deps: Pick<HomeDeps, 'search'>, label = HOME_TITLE): Promise<string | null> {
  for (const query of [...new Set([label, HOME_TITLE])]) {
    const hit = (await deps.search({ query, limit: 25, item_type: 'place' })).find(isHome);
    if (hit) return hit.id;
  }
  return null;
}

const metadataFor = (spot: HomeSpot): PlaceMetadata => ({
  kind: HOME_KIND,
  lat: spot.lat,
  lng: spot.lng,
  ...(spot.address?.trim() ? { address: spot.address.trim().slice(0, 300) } : {}),
});

/**
 * Saves Home at `spot`: changes the existing Home place, or makes one in Places (made when there
 * is none). Returns a sentence for the person on failure.
 */
export async function saveHome(deps: HomeDeps, spot: HomeSpot, label?: string): Promise<{ ok: true } | { error: string }> {
  try {
    const metadata = metadataFor(spot);
    const existing = await findHome(deps, label);
    if (existing) {
      await deps.updateItem(existing, { metadata });
      return { ok: true };
    }
    const spaces = await deps.listSpaces();
    const places = spaces.find((s) => !s.restricted && s.path.trim().toLowerCase() === PLACES_SPACE.toLowerCase());
    const space = places?.id ?? (await deps.createSpace({ name: PLACES_SPACE })).id;
    await deps.saveItem({ space, title: HOME_TITLE, body: '', item_type: 'place', metadata });
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : '';
    const named = /already a Home place \("([^"]*)"\)/.exec(msg);
    if (named) return { error: `You already have a Home place, “${named[1]}”. Open that note and edit its location to change it.` };
    return { error: msg || 'Home could not be saved. Try again.' };
  }
}

/** A place picked for Home or for an event: a point and the words to show for it. */
export interface PickedSpot {
  lat: number;
  lng: number;
  label: string;
  address?: string;
  /** The saved place's note id, when one was picked. */
  id?: string;
}

/** Search results that are places with a location (Home itself left out), as picks. */
export function savedSpots(results: SearchResult[]): (PickedSpot & { id: string })[] {
  const out: (PickedSpot & { id: string })[] = [];
  for (const r of results) {
    const p = r.place;
    if (r.item_type !== 'place' || !p || p.kind === HOME_KIND) continue;
    const { lat, lng } = p;
    if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
    out.push({ id: r.id, lat, lng, label: r.title, ...(p.address ? { address: p.address } : {}) });
  }
  return out;
}
