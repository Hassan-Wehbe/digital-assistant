// Delete account (docs/signup-plan.md step 3): DELETE and the password first, then one request
// with the sign-in; signed out only when the server says it is deleted; the password is sent
// only to the delete-account function and never shown.
import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve } from 'path';

import { DELETE_ACCOUNT_URL, deleteAccount, type DeleteAccountDeps } from './deleteAccount';

function fake(status: number | 'offline', body: unknown = {}, token: string | null = 'tok') {
  const calls: { url: string; init: Parameters<DeleteAccountDeps['fetch']>[1] }[] = [];
  let signedOut = false;
  const deps: DeleteAccountDeps = {
    token: async () => token,
    fetch: async (url, init) => {
      calls.push({ url, init });
      if (status === 'offline') throw new Error('Network request failed');
      return { status, json: async () => body };
    },
    signOutLocally: async () => {
      signedOut = true;
    },
  };
  return { deps, calls, signedOut: () => signedOut };
}

describe('deleting the account', () => {
  it('sends the password and DELETE with the sign-in, then signs out', async () => {
    const f = fake(200, { deleted: true });
    expect(await deleteAccount(f.deps, 'correct horse', ' DELETE ')).toBeNull();
    expect(f.calls).toEqual([
      {
        url: DELETE_ACCOUNT_URL,
        init: {
          method: 'POST',
          headers: { authorization: 'Bearer tok', 'content-type': 'application/json' },
          body: JSON.stringify({ password: 'correct horse', confirm: 'DELETE' }),
        },
      },
    ]);
    expect(f.signedOut()).toBe(true);
  });

  it('asks for DELETE and the password before sending anything', async () => {
    const f = fake(200);
    expect(await deleteAccount(f.deps, 'correct horse', 'delete')).toMatch(/Type DELETE/);
    expect(await deleteAccount(f.deps, '', 'DELETE')).toMatch(/password/);
    expect(f.calls).toHaveLength(0);
  });

  it('keeps the person signed in when it was not deleted, and says why', async () => {
    const wrong = fake(403, { error: 'The password is not right.' });
    expect(await deleteAccount(wrong.deps, 'guess', 'DELETE')).toBe('The password is not right.');
    expect(wrong.signedOut()).toBe(false);
    expect(await deleteAccount(fake(500, 'oops').deps, 'x', 'DELETE')).toMatch(/not deleted/);
    expect(await deleteAccount(fake('offline').deps, 'x', 'DELETE')).toMatch(/Could not reach/);
    expect(await deleteAccount(fake(401).deps, 'x', 'DELETE')).toMatch(/Sign in again/);
    expect(await deleteAccount(fake(200, {}, null).deps, 'x', 'DELETE')).toMatch(/Sign in again/);
  });

  it('the Settings row leads to the screen, which exists only while signed in', () => {
    const SRC = resolve(__dirname, '..');
    const read = (f: string) => readFileSync(resolve(SRC, f), 'utf8');
    expect(read('app/settings.tsx')).toContain("router.push('/delete-account')");
    const layout = read('app/_layout.tsx');
    const signedIn = layout.slice(layout.indexOf('<Stack.Protected guard={signedIn}>'), layout.indexOf('<Stack.Protected guard={!signedIn}>'));
    expect(signedIn).toContain('<Stack.Screen name="delete-account"');
    expect(read('app/delete-account.tsx')).toContain('await deleteAccount(');
  });
});
