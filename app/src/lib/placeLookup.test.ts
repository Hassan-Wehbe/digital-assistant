import { describe, expect, it, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';

import { lookUpPlace, lookupQuery, type GeocodeDeps } from './placeLookup';

const allowed = { granted: true, canAskAgain: true };
const notYet = { granted: false, canAskAgain: true };
const refused = { granted: false, canAskAgain: false };

function phone(over: Partial<GeocodeDeps> = {}) {
  return {
    permission: jest.fn<GeocodeDeps['permission']>(async () => allowed),
    askPermission: jest.fn<GeocodeDeps['askPermission']>(async () => allowed),
    geocode: jest.fn<GeocodeDeps['geocode']>(async () => [{ latitude: 28.66941234, longitude: -81.20811987 }]),
    ...over,
  };
}

describe('lookupQuery (what the phone looks up)', () => {
  it('is "name, address", or the name alone (what Google Maps shares on the owner\'s phone)', () => {
    expect(lookupQuery('Hinode Sushi', 'Oviedo FL')).toBe('Hinode Sushi, Oviedo FL');
    expect(lookupQuery(' Hinode Sushi ', '')).toBe('Hinode Sushi');
    expect(lookupQuery('', 'Armenia St, Beirut')).toBe('Armenia St, Beirut');
  });

  it('does not say the name twice, and is nothing without a name or an address', () => {
    expect(lookupQuery('Tawlet', 'Tawlet, Armenia St')).toBe('Tawlet, Armenia St');
    expect(lookupQuery('  ', ' ')).toBeNull();
  });

  it('stays short', () => {
    expect(lookupQuery('a'.repeat(200), 'b'.repeat(300))).toHaveLength(400);
  });
});

describe('lookUpPlace (Is this it?)', () => {
  it('sends only the text it is given and returns the first point, rounded', async () => {
    const p = phone();
    expect(await lookUpPlace(p, 'Hinode Sushi, Oviedo FL', false)).toEqual({
      found: { lat: 28.669412, lng: -81.20812 },
    });
    expect(p.geocode).toHaveBeenCalledTimes(1);
    expect(p.geocode).toHaveBeenCalledWith('Hinode Sushi, Oviedo FL');
    expect(p.askPermission).not.toHaveBeenCalled();
  });

  it('never asks for the permission by itself; says whether a tap can', async () => {
    const p = phone({
      permission: jest.fn<GeocodeDeps['permission']>(async () => notYet),
    });
    expect(await lookUpPlace(p, 'Hinode Sushi', false)).toEqual({
      permission: { canAsk: true },
    });
    expect(p.askPermission).not.toHaveBeenCalled();
    expect(p.geocode).not.toHaveBeenCalled();
    const q = phone({
      permission: jest.fn<GeocodeDeps['permission']>(async () => refused),
    });
    expect(await lookUpPlace(q, 'Hinode Sushi', true)).toEqual({
      permission: { canAsk: false },
    });
    expect(q.askPermission).not.toHaveBeenCalled();
    expect(q.geocode).not.toHaveBeenCalled();
  });

  it('asks on a tap, and looks up once it is given', async () => {
    const p = phone({
      permission: jest.fn<GeocodeDeps['permission']>(async () => notYet),
    });
    expect(await lookUpPlace(p, 'Hinode Sushi', true)).toHaveProperty('found');
    expect(p.askPermission).toHaveBeenCalledTimes(1);
    const q = phone({
      permission: jest.fn<GeocodeDeps['permission']>(async () => notYet),
      askPermission: jest.fn<GeocodeDeps['askPermission']>(async () => refused),
    });
    expect(await lookUpPlace(q, 'Hinode Sushi', true)).toEqual({
      permission: { canAsk: false },
    });
    expect(q.geocode).not.toHaveBeenCalled();
  });

  it('is "none" when nothing is found, on a failure, after the time limit, or off the map', async () => {
    const empty = phone({
      geocode: jest.fn<GeocodeDeps['geocode']>(async () => []),
    });
    expect(await lookUpPlace(empty, 'Nowhere Diner', false)).toEqual({
      none: true,
    });
    const broken = phone({
      geocode: jest.fn<GeocodeDeps['geocode']>(async () => {
        throw new Error('Geocoder is not running');
      }),
    });
    expect(await lookUpPlace(broken, 'Hinode Sushi', false)).toEqual({
      none: true,
    });
    const never = phone({
      geocode: jest.fn<GeocodeDeps['geocode']>(() => new Promise(() => {})),
    });
    expect(await lookUpPlace(never, 'Hinode Sushi', false, 10)).toEqual({
      none: true,
    });
    const odd = phone({
      geocode: jest.fn<GeocodeDeps['geocode']>(async () => [{ latitude: 95, longitude: 0 }]),
    });
    expect(await lookUpPlace(odd, 'Hinode Sushi', false)).toEqual({
      none: true,
    });
    const nan = phone({
      geocode: jest.fn<GeocodeDeps['geocode']>(async () => [{ latitude: NaN, longitude: 0 }]),
    });
    expect(await lookUpPlace(nan, 'Hinode Sushi', false)).toEqual({
      none: true,
    });
    const notAList = phone({
      geocode: jest.fn<GeocodeDeps['geocode']>(async () => null as never),
    });
    expect(await lookUpPlace(notAList, 'Hinode Sushi', false)).toEqual({
      none: true,
    });
  });
});

describe('the lookup never uses where the phone is', () => {
  const src = (f: string) => readFileSync(join(__dirname, f), 'utf8');

  it('placeLookup.ts and the "Is this it?" card cannot read the position', () => {
    for (const f of ['placeLookup.ts', '../components/PlaceLookup.tsx']) {
      expect(src(f)).not.toMatch(/whereAmI|deviceLocation|getCurrentPosition|getLastKnownPosition|watchPosition/);
    }
  });

  it("the phone's geocoder calls only the permission and the name lookup", () => {
    const block = /export const deviceGeocoder[\s\S]*?\n};/.exec(src('location.ts'))?.[0] ?? '';
    expect(block).toMatch(/geocodeAsync\(query\)/);
    expect(block).not.toMatch(/Position|reverseGeocode/);
  });
});
