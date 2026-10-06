import { describe, expect, it, jest } from '@jest/globals';

import { coordsText, NO_PERMISSION, NOT_FOUND, SERVICES_OFF, whereAmI, type LocationDeps } from './location';

const allowed = { granted: true, canAskAgain: true };
const notYet = { granted: false, canAskAgain: true };
const refused = { granted: false, canAskAgain: false };

function phone(over: Partial<LocationDeps> = {}) {
  const deps = {
    permission: jest.fn<LocationDeps['permission']>(async () => allowed),
    askPermission: jest.fn<LocationDeps['askPermission']>(async () => allowed),
    servicesOn: jest.fn<LocationDeps['servicesOn']>(async () => true),
    position: jest.fn<LocationDeps['position']>(async () => ({ latitude: 33.89379123, longitude: 35.50177849, accuracy: 12.4 })),
    ...over,
  };
  return deps;
}

describe('whereAmI (Save where I am)', () => {
  it('reads the location once, rounded, without asking again when already allowed (#91)', async () => {
    const p = phone();
    expect(await whereAmI(p)).toEqual({ here: { lat: 33.893791, lng: 35.501778, accuracy: 12 } });
    expect(p.askPermission).not.toHaveBeenCalled();
    expect(p.position).toHaveBeenCalledTimes(1);
  });

  it('asks for the permission on the tap when it was never given', async () => {
    const p = phone({ permission: jest.fn<LocationDeps['permission']>(async () => notYet) });
    expect(await whereAmI(p)).toHaveProperty('here');
    expect(p.askPermission).toHaveBeenCalledTimes(1);
  });

  it('says how to allow it when refused, and never reads the location', async () => {
    const p = phone({ permission: jest.fn<LocationDeps['permission']>(async () => notYet), askPermission: jest.fn<LocationDeps['askPermission']>(async () => notYet) });
    expect(await whereAmI(p)).toEqual({ error: NO_PERMISSION });
    const q = phone({ permission: jest.fn<LocationDeps['permission']>(async () => refused) });
    expect(await whereAmI(q)).toEqual({ error: NO_PERMISSION });
    expect(q.askPermission).not.toHaveBeenCalled();
    expect(p.position).not.toHaveBeenCalled();
    expect(q.position).not.toHaveBeenCalled();
  });

  it('says when the phone has location turned off', async () => {
    const p = phone({ servicesOn: jest.fn<LocationDeps['servicesOn']>(async () => false) });
    expect(await whereAmI(p)).toEqual({ error: SERVICES_OFF });
    expect(p.position).not.toHaveBeenCalled();
  });

  it('gives up after the time limit, or on a failure or a reading off the map', async () => {
    const never = phone({ position: jest.fn<LocationDeps['position']>(() => new Promise(() => {})) });
    expect(await whereAmI(never, 10)).toEqual({ error: NOT_FOUND });
    const broken = phone({ position: jest.fn<LocationDeps['position']>(async () => { throw new Error('gps'); }) });
    expect(await whereAmI(broken)).toEqual({ error: NOT_FOUND });
    const odd = phone({ position: jest.fn<LocationDeps['position']>(async () => ({ latitude: 95, longitude: 0, accuracy: null })) });
    expect(await whereAmI(odd)).toEqual({ error: NOT_FOUND });
  });

  it('writes coordinates plainly', () => {
    expect(coordsText({ lat: 33.893791, lng: -81.38 })).toBe('33.893791, -81.380000');
  });
});
