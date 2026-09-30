/* eslint-disable import/no-named-as-default-member -- libsodium's functions are used from its default export, as on the web */
import { beforeAll, describe, expect, it, jest } from '@jest/globals';
import sodium from 'libsodium-wrappers-sumo';

import { memcmp, vaultCrypto, type VaultCrypto, type VaultRecord } from './vaultCrypto';
import {
  AWAY_MS,
  changePassphrase,
  changeSecretValue,
  checkNewPassphrase,
  finishSetup,
  recoverVault,
  startSetup,
  detailsChange,
  entryFields,
  revealSecret,
  sameName,
  saveNewSecret,
  shouldLock,
  UNLOCK_MS,
  type ChangeDeps,
  type KeysDeps,
  type RevealDeps,
  type SaveDeps,
} from './vaultFlow';
import type { SecretMeta } from './wilma';

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

describe('entryFields', () => {
  it('keeps single-line values exactly, trims text boxes at the end, leaves empty fields out', () => {
    expect(entryFields('login', { username: ' me@x.org ', password: 'pa ss ', notes: 'first line\n  \n' })).toEqual({
      username: ' me@x.org ',
      password: 'pa ss ',
      notes: 'first line',
    });
    expect(entryFields('wifi', { ssid: '', password: 'x', notes: '   ' })).toEqual({ password: 'x' });
  });

  it('asks for a required value and refuses an unknown type', () => {
    expect(() => entryFields('login', { username: 'me' })).toThrow('Fill in "Password"');
    expect(() => entryFields('note', { text: '  \n ' })).toThrow('Fill in "Secure note"');
    expect(() => entryFields('bank', { password: 'x' })).toThrow(/kind of secret/);
  });
});

describe('saving and changing values', () => {
  const LINK = `https://x/vault/enter#t=${TOKEN}`;
  const VALUE = 'hunter2-very-secret';

  function setup(over: Partial<{ requestId: string; requestType: string; isUpdate: boolean; publicKey: string }> = {}) {
    const v = crypto.createVault('correct horse battery staple', { alg: 'argon2id13', ops: 1, mem: 8192 * 1024 });
    let stored: string | null = null;
    const rpc = jest.fn<SaveDeps['rpc']>(async (fn, args) => {
      if (fn === 'get_secret_entry_request') {
        return {
          secret_id: over.requestId ?? ID,
          secret_type: over.requestType ?? 'login',
          is_update: over.isUpdate ?? false,
          name: 'Bank',
          public_key: over.publicKey ?? v.record.public_key,
        };
      }
      stored = args.p_payload_enc as string;
      return { secret_id: ID, name: 'Bank', updated: over.isUpdate ?? false };
    });
    const saveSecret = jest.fn<SaveDeps['saveSecret']>(async () => ({ entry_link: LINK, expires_at: 'soon', secret: { id: ID } }));
    const newValueLink = jest.fn<ChangeDeps['newValueLink']>(async () => ({ entry_link: LINK, expires_at: 'soon' }));
    return { deps: { rpc, saveSecret, newValueLink }, rpc, saveSecret, newValueLink, v, stored: () => stored };
  }

  it('saves a new secret: metadata to Wilma, the value sealed on the phone', async () => {
    const t = setup();
    const out = await saveNewSecret(
      t.deps,
      crypto,
      { space: 'sp1', name: ' Bank ', secret_type: 'login', url: ' https://bank.example ' },
      { username: 'me', password: VALUE },
      t.v.record.public_key,
    );
    expect(out).toEqual({ id: ID, name: 'Bank' });
    expect(t.saveSecret).toHaveBeenCalledWith({ space: 'sp1', name: 'Bank', secret_type: 'login', url: 'https://bank.example' });
    expect(t.rpc.mock.calls.map((c) => c[0])).toEqual(['get_secret_entry_request', 'complete_secret_entry']);
    expect(t.rpc.mock.calls[1][1].p_token).toBe(TOKEN);
    // Only ciphertext leaves the phone, and it opens to the typed value for this secret.
    expect(JSON.stringify([t.saveSecret.mock.calls, t.rpc.mock.calls])).not.toContain(VALUE);
    expect(crypto.openSecret(t.v.keys, t.stored()!, ID)).toEqual({ type: 'login', fields: { username: 'me', password: VALUE } });
  });

  it('asks Wilma nothing when the form is incomplete', async () => {
    const t = setup();
    await expect(saveNewSecret(t.deps, crypto, { space: 'sp1', name: 'Bank', secret_type: 'login' }, { username: 'me' }, null)).rejects.toThrow(
      /Password/,
    );
    await expect(saveNewSecret(t.deps, crypto, { space: 'sp1', name: '  ', secret_type: 'login' }, { password: 'x' }, null)).rejects.toThrow(/name/);
    expect(t.saveSecret).not.toHaveBeenCalled();
  });

  it('sends nothing when the link is for another secret, type or kind of entry', async () => {
    for (const over of [{ requestId: 'other' }, { requestType: 'wifi' }, { isUpdate: true }]) {
      const t = setup(over);
      await expect(saveNewSecret(t.deps, crypto, { space: 'sp1', name: 'Bank', secret_type: 'login' }, { password: VALUE }, null)).rejects.toThrow(
        /different secret/,
      );
      expect(t.rpc).toHaveBeenCalledTimes(1);
    }
  });

  it("sends nothing when the link's public key is not the vault's", async () => {
    const t = setup();
    const other = crypto.createVault('another long passphrase', { alg: 'argon2id13', ops: 1, mem: 8192 * 1024 });
    const t2 = setup({ publicKey: other.record.public_key });
    await expect(
      saveNewSecret(t2.deps, crypto, { space: 'sp1', name: 'Bank', secret_type: 'login' }, { password: VALUE }, t.v.record.public_key),
    ).rejects.toThrow(/does not match your vault/);
    expect(t2.rpc).toHaveBeenCalledTimes(1);
  });

  it('changes a value through a new-value link', async () => {
    const t = setup({ isUpdate: true });
    await expect(changeSecretValue(t.deps, crypto, { id: ID, type: 'login' }, { password: VALUE }, t.v.record.public_key)).resolves.toEqual({
      id: ID,
      name: 'Bank',
    });
    expect(t.newValueLink).toHaveBeenCalledWith(ID);
    expect(crypto.openSecret(t.v.keys, t.stored()!, ID).fields).toEqual({ password: VALUE });

    const wrong = setup({ isUpdate: false });
    await expect(changeSecretValue(wrong.deps, crypto, { id: ID, type: 'login' }, { password: VALUE }, null)).rejects.toThrow(/different secret/);
  });

  it('refuses an unreadable entry link', async () => {
    const t = setup();
    t.newValueLink.mockResolvedValueOnce({ entry_link: 'https://x/vault/enter', expires_at: 'soon' });
    await expect(changeSecretValue(t.deps, crypto, { id: ID, type: 'login' }, { password: VALUE }, null)).rejects.toThrow(/could not read/);
    expect(t.rpc).not.toHaveBeenCalled();
  });
});

describe('detailsChange', () => {
  const current = { name: 'Router', url: 'http://192.168.1.1' };

  it('sends only what changed, and an emptied website as ""', () => {
    expect(detailsChange(current, { name: ' Router ', url: 'http://192.168.1.1 ' })).toBeNull();
    expect(detailsChange(current, { name: 'Home router', url: 'http://192.168.1.1' })).toEqual({ name: 'Home router' });
    expect(detailsChange(current, { name: 'Router', url: '' })).toEqual({ url: '' });
    expect(detailsChange({ name: 'Bank', url: null }, { name: 'Bank', url: 'bank.example' })).toEqual({ url: 'bank.example' });
  });

  it('refuses an empty or long name', () => {
    expect(() => detailsChange(current, { name: ' ', url: '' })).toThrow(/cannot be empty/);
    expect(() => detailsChange(current, { name: 'x'.repeat(201), url: '' })).toThrow(/200/);
  });
});

describe('sameName', () => {
  const meta = (name: string, space: string) => ({ id: name + space, name, space, secret_type: 'login' }) as SecretMeta;
  it('finds a secret with the same name (any case) in the same space only', () => {
    const list = [meta('Bank', 'Logins'), meta('bank', 'Work'), meta('Bank card', 'Logins')];
    expect(sameName(list, ' BANK ', 'Logins').map((s) => s.id)).toEqual(['BankLogins']);
  });
});

describe('setting up, recovering and changing the passphrase', () => {
  const FAST = { alg: 'argon2id13', ops: 1, mem: 8192 * 1024 };
  const PASS = 'correct horse battery staple';
  const NEW = 'purple elephant quietly dancing';

  function deps() {
    const calls: [string, Record<string, unknown>][] = [];
    const rpc = jest.fn<KeysDeps['rpc']>(async (fn, args) => {
      calls.push([fn, args]);
      return null;
    });
    return { deps: { rpc }, rpc, calls };
  }
  /** The vault record after a rewrap_vault_passphrase call. */
  const rewrapped = (record: VaultRecord, args: Record<string, unknown>): VaultRecord => ({
    ...record,
    wrapped_private_key: args.p_wrapped_private_key as string,
    vault_salt: args.p_vault_salt as string,
    kdf_params: args.p_kdf_params as VaultRecord['kdf_params'],
  });

  it('asks for a long enough passphrase, typed the same twice', () => {
    expect(() => checkNewPassphrase('short', 'short')).toThrow(/12 characters/);
    expect(() => checkNewPassphrase(PASS, PASS + ' ')).toThrow(/different/);
    expect(() => checkNewPassphrase(PASS, PASS)).not.toThrow();
  });

  it('sets up a vault that opens with the passphrase and with the recovery key', async () => {
    const t = deps();
    const pending = startSetup(crypto, PASS, PASS, FAST);
    // Typed back loosely (lower case, spaces instead of dashes) is fine.
    const keys = await finishSetup(t.deps, crypto, pending, pending.recoveryKey.toLowerCase().replace(/-/g, ' '));
    expect(t.calls.map((c) => c[0])).toEqual(['setup_vault']);
    const a = t.calls[0][1];
    const record: VaultRecord = {
      public_key: a.p_public_key as string,
      wrapped_private_key: a.p_wrapped_private_key as string,
      recovery_wrapped_private_key: a.p_recovery_wrapped_private_key as string,
      vault_salt: a.p_vault_salt as string,
      kdf_params: a.p_kdf_params as VaultRecord['kdf_params'],
    };
    expect(memcmp(crypto.unlockWithPassphrase(record, PASS).privateKey, keys.privateKey)).toBe(true);
    expect(memcmp(crypto.unlockWithRecoveryKey(record, pending.recoveryKey).privateKey, keys.privateKey)).toBe(true);
    // Only wrapped keys leave the phone.
    const sent = JSON.stringify(t.calls);
    expect(sent).not.toContain(PASS);
    expect(sent).not.toContain(pending.recoveryKey);
    expect(sent).not.toContain(crypto.toB64(keys.privateKey));
  });

  it('stores nothing when the recovery key typed back is wrong', async () => {
    const t = deps();
    const pending = startSetup(crypto, PASS, PASS, FAST);
    const other = startSetup(crypto, PASS, PASS, FAST);
    await expect(finishSetup(t.deps, crypto, pending, other.recoveryKey)).rejects.toThrow(/not the recovery key shown/);
    await expect(finishSetup(t.deps, crypto, pending, 'ABCDE')).rejects.toThrow(/recovery key/);
    expect(t.rpc).not.toHaveBeenCalled();
  });

  it('changes the passphrase only with the current one; the recovery key keeps working', async () => {
    const v = crypto.createVault(PASS, FAST);
    const wrong = deps();
    await expect(changePassphrase(wrong.deps, crypto, v.record, 'not the passphrase', NEW, NEW, FAST)).rejects.toThrow(/not right/);
    expect(wrong.rpc).not.toHaveBeenCalled();

    const t = deps();
    const keys = await changePassphrase(t.deps, crypto, v.record, PASS, NEW, NEW, FAST);
    expect(t.calls.map((c) => c[0])).toEqual(['rewrap_vault_passphrase']);
    const next = rewrapped(v.record, t.calls[0][1]);
    expect(memcmp(crypto.unlockWithPassphrase(next, NEW).privateKey, keys.privateKey)).toBe(true);
    expect(() => crypto.unlockWithPassphrase(next, PASS)).toThrow(/not right/);
    expect(memcmp(crypto.unlockWithRecoveryKey(next, v.recoveryKey).privateKey, keys.privateKey)).toBe(true);
    expect(JSON.stringify(t.calls)).not.toContain(NEW);
  });

  it('recovers with the recovery key and a new passphrase', async () => {
    const v = crypto.createVault(PASS, FAST);
    const other = crypto.createVault(PASS, FAST);
    const wrong = deps();
    await expect(recoverVault(wrong.deps, crypto, v.record, other.recoveryKey, NEW, NEW, FAST)).rejects.toThrow(/does not open this vault/);
    await expect(recoverVault(wrong.deps, crypto, v.record, v.recoveryKey, NEW, 'typo', FAST)).rejects.toThrow(/different/);
    expect(wrong.rpc).not.toHaveBeenCalled();

    const t = deps();
    const keys = await recoverVault(t.deps, crypto, v.record, v.recoveryKey, NEW, NEW, FAST);
    const next = rewrapped(v.record, t.calls[0][1]);
    expect(memcmp(crypto.unlockWithPassphrase(next, NEW).privateKey, keys.privateKey)).toBe(true);
    expect(JSON.stringify(t.calls)).not.toContain(v.recoveryKey);
  });
});
