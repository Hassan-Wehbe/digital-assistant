import { describe, expect, it, jest } from '@jest/globals';

import { pinPoint, tapPin } from './chatHere';
import { NO_PERMISSION, SERVICES_OFF, type LocationDeps } from './location';

function phone(o: { granted?: boolean; canAskAgain?: boolean; askGrants?: boolean; on?: boolean } = {}) {
  const deps = {
    permission: jest.fn(async () => ({ granted: o.granted ?? true, canAskAgain: o.canAskAgain ?? true })),
    askPermission: jest.fn(async () => ({ granted: o.askGrants ?? false, canAskAgain: false })),
    servicesOn: jest.fn(async () => o.on ?? true),
    position: jest.fn(async () => ({ latitude: 33.8951234567, longitude: 35.5171234567, accuracy: 12.4 })),
  } satisfies LocationDeps;
  return deps;
}

describe('the 📍 tap in the chat', () => {
  it('reads the location once and keeps only lat and lng for the next message', async () => {
    const deps = phone();
    const p = await tapPin(null, deps);
    expect(p).toEqual({ here: { lat: 33.895123, lng: 35.517123 } });
    expect(pinPoint(p)).toEqual({ lat: 33.895123, lng: 35.517123 });
    expect(deps.position).toHaveBeenCalledTimes(1);
    expect(deps.askPermission).not.toHaveBeenCalled(); // already allowed: not asked again (#91)
  });

  it('asks for the permission on the tap when it is not given yet', async () => {
    const deps = phone({ granted: false, askGrants: true });
    expect(pinPoint(await tapPin(null, deps))).toEqual({ lat: 33.895123, lng: 35.517123 });
    expect(deps.askPermission).toHaveBeenCalledTimes(1);
  });

  it('a second tap removes it without reading the location again', async () => {
    const deps = phone();
    const on = await tapPin(null, deps);
    expect(await tapPin(on, deps)).toBeNull();
    expect(deps.position).toHaveBeenCalledTimes(1);
    expect(deps.permission).toHaveBeenCalledTimes(1);
  });

  it('refused or location off: a plain sentence and nothing to send', async () => {
    const refused = await tapPin(null, phone({ granted: false, canAskAgain: false }));
    expect(refused).toEqual({ error: NO_PERMISSION });
    expect(pinPoint(refused)).toBeUndefined();
    const off = await tapPin(null, phone({ on: false }));
    expect(off).toEqual({ error: SERVICES_OFF });
    expect(pinPoint(off)).toBeUndefined();
  });

  it('after a refusal, the next tap tries again', async () => {
    const deps = phone();
    expect(pinPoint(await tapPin({ error: NO_PERMISSION }, deps))).toBeDefined();
  });
});
