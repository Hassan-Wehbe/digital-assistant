import { describe, expect, it, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';

import { lookUpPlace, lookupQuery, spotText, type GeocodeDeps } from './placeLookup';

const allowed = { granted: true, canAskAgain: true };
const notYet = { granted: false, canAskAgain: true };
const refused = { granted: false, canAskAgain: false };

function phone(over: Partial<GeocodeDeps> = {}) {
  return {
    permission: jest.fn<GeocodeDeps['permission']>(async () => allowed),
    askPermission: jest.fn<GeocodeDeps['askPermission']>(async () => allowed),
    geocode: jest.fn<GeocodeDeps['geocode']>(async () => [{ latitude: 28.66941234, longitude: -81.20811987 }]),
    describe: jest.fn<GeocodeDeps['describe']>(async () => [
      { streetNumber: '1155', street: 'Lockwood Blvd', city: 'Oviedo', district: null, region: 'FL', country: 'United States' },
    ]),
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
  it('sends only the text it is given and returns the first point, rounded, with its street and town', async () => {
    const p = phone();
    expect(await lookUpPlace(p, 'Hinode Sushi, Oviedo FL', false)).toEqual({
      found: { lat: 28.669412, lng: -81.20812 },
      where: '1155 Lockwood Blvd, Oviedo, FL, United States',
    });
    expect(p.geocode).toHaveBeenCalledTimes(1);
    expect(p.geocode).toHaveBeenCalledWith('Hinode Sushi, Oviedo FL');
    expect(p.askPermission).not.toHaveBeenCalled();
  });

  it('asks for the street and town of the spot found, and of nothing else', async () => {
    const p = phone();
    await lookUpPlace(p, 'Hinode Sushi', false);
    expect(p.describe).toHaveBeenCalledTimes(1);
    expect(p.describe).toHaveBeenCalledWith({ latitude: 28.669412, longitude: -81.20812 });
    const none = phone({ geocode: jest.fn<GeocodeDeps['geocode']>(async () => []) });
    await lookUpPlace(none, 'Nowhere Diner', false);
    expect(none.describe).not.toHaveBeenCalled();
  });

  it('a name matched in another town says so (owner, versionCode 13: Oviedo, Spain)', async () => {
    const p = phone({
      geocode: jest.fn<GeocodeDeps['geocode']>(async () => [{ latitude: 43.362252, longitude: -5.848546 }]),
      describe: jest.fn<GeocodeDeps['describe']>(async () => [
        { streetNumber: null, street: 'Calle Uría', city: 'Oviedo', district: null, region: 'Asturias', country: 'Spain' },
      ]),
    });
    expect(await lookUpPlace(p, 'Mister O1 Extraordinary Pizza Oviedo', false)).toEqual({
      found: { lat: 43.362252, lng: -5.848546 },
      where: 'Calle Uría, Oviedo, Asturias, Spain',
    });
  });

  it('still finds the spot when its street and town cannot be had (failure, time limit, empty)', async () => {
    const found = { lat: 28.669412, lng: -81.20812 };
    const broken = phone({
      describe: jest.fn<GeocodeDeps['describe']>(async () => {
        throw new Error('Geocoder is not running');
      }),
    });
    expect(await lookUpPlace(broken, 'Hinode Sushi', false)).toEqual({ found, where: null });
    const never = phone({ describe: jest.fn<GeocodeDeps['describe']>(() => new Promise(() => {})) });
    expect(await lookUpPlace(never, 'Hinode Sushi', false, 10)).toEqual({ found, where: null });
    const empty = phone({ describe: jest.fn<GeocodeDeps['describe']>(async () => []) });
    expect(await lookUpPlace(empty, 'Hinode Sushi', false)).toEqual({ found, where: null });
    const blank = phone({ describe: jest.fn<GeocodeDeps['describe']>(async () => [{ street: ' ', city: null }]) });
    expect(await lookUpPlace(blank, 'Hinode Sushi', false)).toEqual({ found, where: null });
    const notAList = phone({ describe: jest.fn<GeocodeDeps['describe']>(async () => null as never) });
    expect(await lookUpPlace(notAList, 'Hinode Sushi', false)).toEqual({ found, where: null });
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

describe('spotText (the "Found at" line)', () => {
  it('is street, town, region and country, with whatever parts there are', () => {
    expect(spotText({ street: 'Calle Uría', city: 'Oviedo', region: 'Asturias', country: 'Spain' })).toBe('Calle Uría, Oviedo, Asturias, Spain');
    expect(spotText({ streetNumber: '1155', street: 'Lockwood Blvd', city: 'Oviedo', region: 'FL' })).toBe('1155 Lockwood Blvd, Oviedo, FL');
    expect(spotText({ street: 'Lockwood Blvd', city: null, district: 'Alafaya', region: 'FL' })).toBe('Lockwood Blvd, Alafaya, FL');
    expect(spotText({ streetNumber: '12', city: 'Orlando' })).toBe('12, Orlando');
    expect(spotText({ region: 'FL' })).toBe('FL');
  });

  it('is nothing without any part, and stays short', () => {
    expect(spotText({ street: ' ', city: null, region: '' })).toBeNull();
    expect(spotText(undefined)).toBeNull();
    expect(spotText({ street: 7 as never, city: 'Oviedo' })).toBe('Oviedo');
    expect(spotText({ street: 'a'.repeat(300) })).toHaveLength(200);
  });
});

describe('the lookup never uses where the phone is', () => {
  const src = (f: string) => readFileSync(join(__dirname, f), 'utf8');

  it('placeLookup.ts and the "Is this it?" card cannot read the position', () => {
    for (const f of ['placeLookup.ts', '../components/PlaceLookup.tsx']) {
      expect(src(f)).not.toMatch(/whereAmI|deviceLocation|getCurrentPosition|getLastKnownPosition|watchPosition/);
    }
  });

  it("the phone's geocoder calls only the permission, the name lookup and the found spot's street and town", () => {
    const block = /export const deviceGeocoder[\s\S]*?\n};/.exec(src('location.ts'))?.[0] ?? '';
    expect(block).toMatch(/geocodeAsync\(query\)/);
    expect(block).toMatch(/describe: \(point\) => pkg\(\)\.reverseGeocodeAsync\(point\)/);
    expect(block).not.toMatch(/Position/);
    expect(block.match(/reverseGeocodeAsync/g)).toHaveLength(1);
  });
});
