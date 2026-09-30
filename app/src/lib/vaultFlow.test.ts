/* eslint-disable import/no-named-as-default-member -- libsodium's functions are used from its default export, as on the web */
import { beforeAll, describe, expect, it, jest } from '@jest/globals';
import sodium from 'libsodium-wrappers-sumo';

import { vaultCrypto, type VaultCrypto } from './vaultCrypto';
import { AWAY_MS, revealSecret, shouldLock, UNLOCK_MS, type RevealDeps } from './vaultFlow';

const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz012345_-abcdef';
const ID = '6d1c1c49-6f0a-4d8e-9d2e-3c1f0e7a9b10';

let crypto: VaultCrypto;
beforeAll(async () => {
  await sodium.ready;
  crypto = vaultCrypto(sodium);
});

describe('shouldLock', () => {
  it('locks 5 minutes after unlocking', () => {
    expect(shouldLock(0, UNLOCK_MS - 1, null)).toBe(false);
    expect(shouldLock(0, UNLOCK_MS, null)).toBe(true);
  });

  it('locks after a minute away from the app, not after a short switch', () => {
    expect(shouldLock(0, 1000 + AWAY_MS - 1, 1000)).toBe(false);
    expect(shouldLock(0, 1000 + AWAY_MS, 1000)).toBe(true);
  });
});

describe('revealSecret', () => {
  function setup(over: Partial<{ requestId: string; sealedId: string; link: string }> = {}) {
    const v = crypto.createVault('correct horse battery staple', { alg: 'argon2id13', ops: 1, mem: 8192 * 1024 });
    const payload = crypto.sealSecret(v.record.public_key, ID, 'login', { username: 'u', password: 'p' });
    const rpc = jest.fn<RevealDeps['rpc']>(async (fn) =>
      fn === 'get_reveal_request'
        ? { secret_id: over.requestId ?? ID, name: 'Router' }
        : { secret_id: over.sealedId ?? ID, name: 'Router', url: 'http://192.168.1.1', secret_type: 'login', payload_enc: payload },
    );
    const revealLink = jest.fn<RevealDeps['revealLink']>(async () => ({ reveal_link: over.link ?? `https://x/vault/reveal#t=${TOKEN}` }));
    return { deps: { rpc, revealLink }, rpc, keys: v.keys };
  }

  it('uses the one-time link itself and decrypts on the phone', async () => {
    const { deps, rpc, keys } = setup();
    await expect(revealSecret(deps, crypto, keys, ID)).resolves.toEqual({
      name: 'Router',
      url: 'http://192.168.1.1',
      type: 'login',
      fields: { username: 'u', password: 'p' },
    });
    expect(rpc.mock.calls).toEqual([
      ['get_reveal_request', { p_token: TOKEN }],
      ['reveal_secret', { p_token: TOKEN }],
    ]);
  });

  it('stops before using up the link when it is for another secret', async () => {
    const { deps, rpc, keys } = setup({ requestId: 'other' });
    await expect(revealSecret(deps, crypto, keys, ID)).rejects.toThrow(/different secret/);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('refuses an unreadable link and a swapped answer', async () => {
    const a = setup({ link: 'https://x/vault/reveal' });
    await expect(revealSecret(a.deps, crypto, a.keys, ID)).rejects.toThrow(/could not read/);
    const b = setup({ sealedId: 'other' });
    await expect(revealSecret(b.deps, crypto, b.keys, ID)).rejects.toThrow(/different secret/);
  });
});
