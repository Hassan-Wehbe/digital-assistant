import { describe, expect, it } from '@jest/globals';

import {
  EMPTY_PLACE,
  isMapsLink,
  localDate,
  mapsLink,
  placeForm,
  placeLine,
  placeMetadata,
  placeOf,
  samePlace,
  visitArgs,
  type PlaceMetadata,
} from './places';

describe('isMapsLink (the same links as the server, supabase/functions/mcp/lib/places.ts)', () => {
  it('accepts Google Maps and geo: links', () => {
    for (const ok of [
      'https://maps.app.goo.gl/AbC123',
      'https://goo.gl/maps/xyz',
      'https://www.google.com/maps/place/Tawlet/@33.89,35.52,17z',
      'https://google.com/maps/search/?api=1&query=Tawlet',
      'https://maps.google.com/?q=Tawlet',
      'https://www.google.co.uk/maps/place/X',
      'https://maps.google.com.lb/?q=x',
      'HTTPS://MAPS.APP.GOO.GL/AbC123',
      'geo:33.8938,35.5018',
      'geo:33.8938,35.5018?q=Tawlet',
    ]) {
      expect([ok, isMapsLink(ok)]).toEqual([ok, true]);
    }
  });

  it('refuses everything else, including look-alikes', () => {
    for (const bad of [
      'http://maps.app.goo.gl/AbC123',
      'https://goo.gl/abc',
      'https://www.google.com/search?q=tawlet',
      'https://maps.google.com.evil.example/?q=x',
      'https://evil.example/maps.app.goo.gl',
      'https://user:pw@maps.app.goo.gl/x',
      'https://maps.app.goo.gl:8443/x',
      'https://maps.app.goo.gl\\@evil.example/x',
      'https://www.google.com/maps/../url?q=https://evil.example',
      'https://www.google.com/maps/%2e%2e/url',
      'https://maps.app.goo.gl/x y',
      'javascript:alert(1)',
      'geo:somewhere',
      'intent://maps',
      'https://tripadvisor.com/x',
      '',
    ]) {
      expect([bad, isMapsLink(bad)]).toEqual([bad, false]);
    }
  });
});

describe('mapsLink (Open in Maps)', () => {
  it('uses the saved link when there is one', () => {
    expect(mapsLink({ address: 'Armenia St', maps_url: 'https://maps.app.goo.gl/AbC123' })).toBe('https://maps.app.goo.gl/AbC123');
    expect(mapsLink({ maps_url: 'geo:33.8938,35.5018' })).toBe('geo:33.8938,35.5018');
  });

  it('else searches Google Maps for the address, encoded', () => {
    expect(mapsLink({ address: 'Armenia St, Mar Mikhael & Co #2' })).toBe(
      'https://www.google.com/maps/search/?api=1&query=Armenia%20St%2C%20Mar%20Mikhael%20%26%20Co%20%232',
    );
  });

  it('opens the saved location first, before the saved link and the address (what Wilma measures from)', () => {
    expect(mapsLink({ address: 'Armenia St', lat: 33.893791, lng: 35.501778 })).toBe(
      'https://www.google.com/maps/search/?api=1&query=33.893791,35.501778',
    );
    expect(mapsLink({ maps_url: 'https://maps.app.goo.gl/AbC123', lat: 1, lng: 2 })).toBe(
      'https://www.google.com/maps/search/?api=1&query=1,2',
    );
  });

  it('never opens a saved link that is not a Maps link, and has nothing to open without an address', () => {
    expect(mapsLink({ address: 'Armenia St', maps_url: 'javascript:alert(1)' })).toBe(
      'https://www.google.com/maps/search/?api=1&query=Armenia%20St',
    );
    expect(mapsLink({ maps_url: 'https://evil.example' })).toBeNull();
    expect(mapsLink({ address: '   ' })).toBeNull();
  });
});

describe('the place form', () => {
  const saved: PlaceMetadata = {
    address: 'Armenia St, Mar Mikhael',
    maps_url: 'https://maps.app.goo.gl/AbC123',
    kind: 'restaurant',
    status: 'been',
    rating: 4,
    visited_on: '2026-10-03',
    cuisine: ['lebanese', 'mezze'],
    price_level: 2,
    dishes_liked: ['fattoush'],
    would_return: true,
    occasions: ['date_night', 'group'],
    visits: [{ on: '2026-10-03', with: 'Sarah' }],
    lat: 33.8938,
    lng: 35.5018,
    google_place_id: 'ChIJ123',
  };

  it('round trip: what was saved comes back unchanged, hidden fields included', () => {
    const out = placeMetadata(placeForm(saved), saved);
    expect(out).toEqual({ metadata: saved });
    expect('metadata' in out && samePlace(out.metadata, saved)).toBe(true);
  });

  it('saves, keeps and removes the location from the form', () => {
    expect(placeMetadata({ ...EMPTY_PLACE, coords: { lat: 33.893791, lng: 35.501778 } })).toEqual({
      metadata: { status: 'want', lat: 33.893791, lng: 35.501778 },
    });
    const out = placeMetadata({ ...placeForm(saved), coords: null }, saved);
    expect('metadata' in out && out.metadata.lat).toBeUndefined();
    expect(placeMetadata({ ...EMPTY_PLACE, coords: { lat: 91, lng: 0 } })).toHaveProperty('error');
  });

  it('a new place with only a name is "want to go"', () => {
    expect(placeMetadata(EMPTY_PLACE)).toEqual({ metadata: { status: 'want' } });
  });

  it('tidies the typed lists as the server does', () => {
    const out = placeMetadata({ ...EMPTY_PLACE, address: '  Armenia St,   Beirut ', cuisine: 'Italian, italian , Pizza,,', dishes: ' Carbonara ' });
    expect(out).toEqual({
      metadata: { address: 'Armenia St, Beirut', cuisine: ['italian', 'pizza'], dishes_liked: ['carbonara'], status: 'want' },
    });
  });

  it('refuses a link that is not Google Maps', () => {
    for (const link of ['https://tripadvisor.com/tawlet', 'javascript:alert(1)', 'http://maps.app.goo.gl/x']) {
      expect(placeMetadata({ ...EMPTY_PLACE, mapsUrl: link })).toEqual({
        error: 'The map link must be a Google Maps link (from Share in Google Maps), or leave it empty.',
      });
    }
    expect(placeMetadata({ ...EMPTY_PLACE, mapsUrl: ' https://maps.app.goo.gl/AbC123 ' })).toEqual({
      metadata: { maps_url: 'https://maps.app.goo.gl/AbC123', status: 'want' },
    });
  });

  it('keeps the rating and "would go back" only for a place you have been to', () => {
    expect(placeMetadata({ ...EMPTY_PLACE, rating: 5, wouldReturn: false })).toEqual({ metadata: { status: 'want' } });
    expect(placeMetadata({ ...EMPTY_PLACE, status: 'been', rating: 5, wouldReturn: false })).toEqual({
      metadata: { status: 'been', rating: 5, would_return: false },
    });
  });

  it('a place with visits stays "been there"', () => {
    expect(placeMetadata({ ...placeForm(saved), status: 'want' }, saved)).toEqual({ error: 'This place has visits, so it stays “Been there”.' });
  });

  it('refuses out-of-range values and long lists', () => {
    expect(placeMetadata({ ...EMPTY_PLACE, address: 'x'.repeat(301) })).toHaveProperty('error');
    expect(placeMetadata({ ...EMPTY_PLACE, status: 'been', rating: 6 })).toHaveProperty('error');
    expect(placeMetadata({ ...EMPTY_PLACE, price: 5 })).toHaveProperty('error');
    expect(placeMetadata({ ...EMPTY_PLACE, cuisine: Array.from({ length: 11 }, (_, i) => `c${i}`).join(',') })).toHaveProperty('error');
  });

  it('reads a place only from a place item', () => {
    expect(placeOf({ item_type: 'note', metadata: { address: 'x' } })).toBeNull();
    expect(placeOf({ item_type: 'place', metadata: null })).toEqual({});
    expect(placeOf({ item_type: 'Place', metadata: { kind: 'bar' } })).toEqual({ kind: 'bar' });
  });
});

describe('placeLine (lists)', () => {
  it('names the kind, cuisine, price and want / been', () => {
    expect(placeLine({ kind: 'restaurant', cuisine: ['italian'], price_level: 2, status: 'been', rating: 4 })).toBe(
      'Restaurant · italian · $$ · Been there ★4',
    );
    expect(placeLine({ kind: 'to-visit', status: 'want' })).toBe('To visit · Want to go');
    expect(placeLine({})).toBe('Place · Want to go');
  });
});

describe('visitArgs (We went again)', () => {
  const now = new Date(2026, 9, 6, 12);

  it('today on the phone is the default date', () => {
    expect(localDate(now)).toBe('2026-10-06');
  });

  it('sends the date, and who and a line only when given', () => {
    expect(visitArgs({ on: '2026-10-03', with: ' Sarah ', note: '', rating: 5 }, now)).toEqual({
      visit: { on: '2026-10-03', with: 'Sarah', rating: 5 },
    });
    expect(visitArgs({ on: '2026-10-06', with: '', note: '', rating: null }, now)).toEqual({ visit: { on: '2026-10-06' } });
  });

  it('refuses a date that is not real or is in the future', () => {
    expect(visitArgs({ on: '3 Oct', with: '', note: '', rating: null }, now)).toHaveProperty('error');
    expect(visitArgs({ on: '2026-02-30', with: '', note: '', rating: null }, now)).toHaveProperty('error');
    expect(visitArgs({ on: '2026-10-07', with: '', note: '', rating: null }, now)).toEqual({ error: 'The visit date is in the future.' });
  });
});
