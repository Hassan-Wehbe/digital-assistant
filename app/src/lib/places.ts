// Places (docs/places-plan.md, design D26): a note with item_type "place" whose metadata holds an
// address, a Google Maps link, the kind, cuisine, price, occasions, dishes, want to go / been
// there and visits. The server checks every field (supabase/functions/mcp/lib/places.ts); the
// app checks the same things first so the person gets a plain sentence instead of a refusal
// written for the model, and only ever opens Google Maps or geo: links.

export const PLACE_TYPE = 'place';

export const PLACE_KINDS = ['restaurant', 'cafe', 'bar', 'shop', 'to-visit', 'hotel', 'other'] as const;
export type PlaceKind = (typeof PLACE_KINDS)[number];
export const KIND_LABELS: Record<PlaceKind, string> = {
  restaurant: 'Restaurant',
  cafe: 'Café',
  bar: 'Bar',
  shop: 'Shop',
  'to-visit': 'To visit',
  hotel: 'Hotel',
  other: 'Other',
};

/** The Home place the day planner drives from (at most one; set in My day, never in the kind picker). */
export const HOME_KIND = 'home';

export const OCCASIONS = ['date_night', 'kids', 'business', 'quick_lunch', 'group', 'special'] as const;
export type Occasion = (typeof OCCASIONS)[number];
export const OCCASION_LABELS: Record<Occasion, string> = {
  date_night: 'Date night',
  kids: 'With kids',
  business: 'Business',
  quick_lunch: 'Quick lunch',
  group: 'Group',
  special: 'Special occasion',
};

export const MAX_ADDRESS = 300;
export const MAX_LINK = 500;
const MAX_CUISINE = 10;
const MAX_DISHES = 20;
const MAX_WITH = 100;
const MAX_VISIT_NOTE = 300;

export interface PlaceVisit {
  on: string;
  with?: string;
  note?: string;
}

/** A place's metadata as the server stores it (unknown fields are kept as they are). */
export interface PlaceMetadata {
  address?: string;
  maps_url?: string;
  kind?: PlaceKind | typeof HOME_KIND;
  status?: 'want' | 'been';
  rating?: number;
  visited_on?: string;
  cuisine?: string[];
  price_level?: number;
  dishes_liked?: string[];
  would_return?: boolean;
  occasions?: Occasion[];
  visits?: PlaceVisit[];
  lat?: number;
  lng?: number;
  google_place_id?: string;
}

export function isPlace(itemType: string | null | undefined): boolean {
  return (itemType ?? '').trim().toLowerCase() === PLACE_TYPE;
}

/**
 * Only Google Maps links (https) or geo: links, as the server's isMapsLink. React Native's URL
 * is incomplete, so this reads the link with patterns, and is at least as strict as the server:
 * no user name or port, no spaces or backslashes, no "." or ".." steps or encoded dots in the path.
 */
export function isMapsLink(url: string): boolean {
  if (/^geo:-?\d{1,3}(\.\d+)?,-?\d{1,3}(\.\d+)?([;?].*)?$/i.test(url)) return !/[\s\\]/.test(url);
  if (/[\s\\]/.test(url)) return false;
  const m = /^https:\/\/([^/?#]*)([^?#]*)/i.exec(url);
  if (!m) return false;
  const host = m[1].toLowerCase();
  const path = m[2];
  if (!host || host.includes('@') || host.includes(':') || host.includes('%')) return false;
  if (/(^|\/)\.{1,2}(\/|$)|%2e/i.test(path)) return false;
  if (host === 'maps.app.goo.gl') return true;
  if (host === 'goo.gl') return path.startsWith('/maps');
  if (/^maps\.google\.[a-z.]{2,6}$/.test(host)) return true;
  if (/^(www\.)?google\.[a-z.]{2,6}$/.test(host)) return path.startsWith('/maps');
  return false;
}

/**
 * Where Open in Maps goes: the saved location (from "Save where I am" or "Is this it?"), the spot
 * Wilma measures distances from; else the saved link; else a Google Maps search for the address.
 * The location comes first so a wrong one shows (owner, versionCode 13: a Google link that opened
 * the right café hid a saved location in another town).
 */
export function mapsLink(place: Pick<PlaceMetadata, 'address' | 'maps_url' | 'lat' | 'lng'>): string | null {
  if (validCoords(place)) return `https://www.google.com/maps/search/?api=1&query=${place.lat},${place.lng}`;
  if (place.maps_url && isMapsLink(place.maps_url)) return place.maps_url;
  const address = place.address?.trim();
  if (!address) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

function validCoords(p: { lat?: unknown; lng?: unknown }): p is { lat: number; lng: number } {
  return (
    typeof p.lat === 'number' && typeof p.lng === 'number' && Number.isFinite(p.lat) && Number.isFinite(p.lng) &&
    Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180
  );
}

/** The place in an item's metadata, or null when the item is not a place. */
export function placeOf(item: { item_type: string; metadata?: Record<string, unknown> | null }): PlaceMetadata | null {
  if (!isPlace(item.item_type)) return null;
  const m = item.metadata;
  return m && typeof m === 'object' && !Array.isArray(m) ? (m as PlaceMetadata) : {};
}

const been = (p: PlaceMetadata) => p.status === 'been' || p.rating !== undefined || !!p.visited_on || !!p.visits?.length;

/** One short line for lists: "Restaurant · italian · $$ · Been there ★4". */
export function placeLine(p: PlaceMetadata): string {
  const kind = p.kind === HOME_KIND ? 'Home' : p.kind && KIND_LABELS[p.kind] ? KIND_LABELS[p.kind] : 'Place';
  return [
    kind,
    p.cuisine?.length ? p.cuisine.join(', ') : null,
    p.price_level ? '$'.repeat(p.price_level) : null,
    been(p) ? `Been there${p.rating ? ` ★${p.rating}` : ''}` : 'Want to go',
  ]
    .filter(Boolean)
    .join(' · ');
}

// ---- The form ----------------------------------------------------------------------------------

/** What the place form edits; lists are typed as "italian, pizza". */
export interface PlaceForm {
  address: string;
  mapsUrl: string;
  kind: PlaceKind | null;
  cuisine: string;
  price: number | null;
  occasions: Occasion[];
  dishes: string;
  status: 'want' | 'been';
  rating: number | null;
  wouldReturn: boolean | null;
  /** From "Save where I am" (or kept from the saved place); null for none. */
  coords: { lat: number; lng: number } | null;
}

export const EMPTY_PLACE: PlaceForm = {
  address: '',
  mapsUrl: '',
  kind: null,
  cuisine: '',
  price: null,
  occasions: [],
  dishes: '',
  status: 'want',
  rating: null,
  wouldReturn: null,
  coords: null,
};

export function placeForm(p: PlaceMetadata | null): PlaceForm {
  if (!p) return EMPTY_PLACE;
  return {
    address: p.address ?? '',
    mapsUrl: p.maps_url ?? '',
    kind: p.kind && (PLACE_KINDS as readonly string[]).includes(p.kind) ? (p.kind as PlaceKind) : null,
    cuisine: (p.cuisine ?? []).join(', '),
    price: p.price_level ?? null,
    occasions: (p.occasions ?? []).filter((o) => (OCCASIONS as readonly string[]).includes(o)),
    dishes: (p.dishes_liked ?? []).join(', '),
    status: been(p) ? 'been' : 'want',
    rating: p.rating ?? null,
    wouldReturn: p.would_return ?? null,
    coords: validCoords(p) ? { lat: p.lat, lng: p.lng } : null,
  };
}

/** True when the place has visits, so it cannot go back to "want to go". */
export function hasVisits(p: PlaceMetadata | null): boolean {
  return !!p && (!!p.visited_on || !!p.visits?.length);
}

const tidy = (s: string) => s.trim().replace(/\s+/g, ' ');

function words(text: string, label: string, maxItems: number, maxLen: number): string[] | { error: string } {
  const out: string[] = [];
  for (const w of text.split(',')) {
    const t = tidy(w).toLowerCase();
    if (!t) continue;
    if (t.length > maxLen) return { error: `${label}: “${t.slice(0, 20)}…” is longer than ${maxLen} characters.` };
    if (!out.includes(t)) out.push(t);
  }
  if (out.length > maxItems) return { error: `${label}: at most ${maxItems}.` };
  return out;
}

/**
 * The metadata to save, or why it cannot be saved. Fields the form does not show (visits, the
 * latest visit date, Google's place id) are kept from `base`; coordinates come from the form.
 */
export function placeMetadata(form: PlaceForm, base: PlaceMetadata | null = null): { metadata: PlaceMetadata } | { error: string } {
  const out: PlaceMetadata = {};
  const address = tidy(form.address);
  if (address.length > MAX_ADDRESS) return { error: `The address can be at most ${MAX_ADDRESS} characters.` };
  if (address) out.address = address;

  const link = form.mapsUrl.trim();
  if (link) {
    if (link.length > MAX_LINK || !isMapsLink(link)) {
      return { error: 'The map link must be a Google Maps link (from Share in Google Maps), or leave it empty.' };
    }
    out.maps_url = link;
  }
  if (form.kind) out.kind = form.kind;
  // The kind picker does not offer Home: editing the Home place keeps it Home.
  else if (base?.kind === HOME_KIND) out.kind = HOME_KIND;

  const cuisine = words(form.cuisine, 'Cuisine', MAX_CUISINE, 40);
  if ('error' in cuisine) return cuisine;
  if (cuisine.length) out.cuisine = cuisine;
  if (form.price) {
    if (!Number.isInteger(form.price) || form.price < 1 || form.price > 4) return { error: 'Price is $ to $$$$.' };
    out.price_level = form.price;
  }
  const dishes = words(form.dishes, 'Dishes', MAX_DISHES, 80);
  if ('error' in dishes) return dishes;
  if (dishes.length) out.dishes_liked = dishes;
  const occasions = OCCASIONS.filter((o) => form.occasions.includes(o));
  if (occasions.length) out.occasions = occasions;

  if (form.status === 'want' && hasVisits(base)) {
    return { error: 'This place has visits, so it stays “Been there”.' };
  }
  out.status = form.status;
  if (form.status === 'been') {
    if (form.rating !== null) {
      if (!Number.isInteger(form.rating) || form.rating < 1 || form.rating > 5) return { error: 'The rating is 1 to 5 stars.' };
      out.rating = form.rating;
    }
    if (form.wouldReturn !== null) out.would_return = form.wouldReturn;
  }

  if (form.coords) {
    if (!validCoords(form.coords)) return { error: 'That location is not a real place on the map.' };
    out.lat = form.coords.lat;
    out.lng = form.coords.lng;
  }
  if (base) {
    if (base.visited_on) out.visited_on = base.visited_on;
    if (base.visits?.length) out.visits = base.visits;
    if (base.google_place_id) out.google_place_id = base.google_place_id;
  }
  return { metadata: out };
}

/** The same metadata (field order and list order aside from visits do not matter here). */
export function samePlace(a: PlaceMetadata | null, b: PlaceMetadata | null): boolean {
  const norm = (p: PlaceMetadata | null) => {
    const m = { status: 'want', ...(p ?? {}) } as Record<string, unknown>;
    return JSON.stringify(Object.keys(m).sort().map((k) => [k, m[k]]));
  };
  return norm(a) === norm(b);
}

// ---- We went again -----------------------------------------------------------------------------

/** Today on the phone, as YYYY-MM-DD. */
export function localDate(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export interface VisitForm {
  on: string;
  with: string;
  note: string;
  rating: number | null;
}

export interface NewVisit {
  on: string;
  with?: string;
  note?: string;
  rating?: number;
}

/** What update_item's add_visit gets, or why not. The date is a real day, not in the future. */
export function visitArgs(form: VisitForm, now = new Date()): { visit: NewVisit } | { error: string } {
  const on = form.on.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(on)) return { error: 'Give the date as 2026-10-12.' };
  const t = new Date(`${on}T00:00:00Z`);
  if (Number.isNaN(t.getTime()) || t.toISOString().slice(0, 10) !== on) return { error: 'That date does not exist.' };
  if (on > localDate(now)) return { error: 'The visit date is in the future.' };
  if (t.getUTCFullYear() < 1900) return { error: 'That date is too far in the past.' };
  const visit: NewVisit = { on };
  const w = tidy(form.with);
  const note = tidy(form.note);
  if (w.length > MAX_WITH) return { error: `“With” can be at most ${MAX_WITH} characters.` };
  if (note.length > MAX_VISIT_NOTE) return { error: `The visit note can be at most ${MAX_VISIT_NOTE} characters.` };
  if (w) visit.with = w;
  if (note) visit.note = note;
  if (form.rating !== null) {
    if (!Number.isInteger(form.rating) || form.rating < 1 || form.rating > 5) return { error: 'The rating is 1 to 5 stars.' };
    visit.rating = form.rating;
  }
  return { visit };
}

/** A chat place card's second line: "Restaurant · italian, pizza" (an unknown kind is left out). */
export function placeCardDetail(c: { kind?: string; cuisine?: string[] }): string {
  const kind = c.kind && c.kind in KIND_LABELS ? KIND_LABELS[c.kind as PlaceKind] : null;
  return [kind, c.cuisine?.length ? c.cuisine.join(', ') : null].filter(Boolean).join(' · ');
}
