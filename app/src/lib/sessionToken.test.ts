import { describe, expect, it, jest } from '@jest/globals';

import { sessionToken, type SessionSource } from './sessionToken';

const offline = new Error('Network request failed');

function source(session: { access_token: string } | null, error: unknown = null) {
  const signOutLocally = jest.fn(async () => undefined);
  const src: SessionSource = {
    getSession: async () => ({ data: { session }, error }),
    signOutLocally,
    isConnectionError: (e) => e === offline,
  };
  return { src, signOutLocally };
}

describe('sessionToken', () => {
  it('returns the saved token and stays signed in', async () => {
    const { src, signOutLocally } = source({ access_token: 'abc' });
    expect(await sessionToken(src)).toBe('abc');
    expect(signOutLocally).not.toHaveBeenCalled();
  });

  it('keeps the session when the refresh fails for lack of a connection', async () => {
    const { src, signOutLocally } = source(null, offline);
    await expect(sessionToken(src)).rejects.toBe(offline);
    expect(signOutLocally).not.toHaveBeenCalled();
  });

  it('goes back to sign-in when there is no session', async () => {
    const { src, signOutLocally } = source(null);
    expect(await sessionToken(src)).toBeNull();
    expect(signOutLocally).toHaveBeenCalledTimes(1);
  });

  it('goes back to sign-in when the session was refused by the server', async () => {
    const { src, signOutLocally } = source(null, new Error('Invalid Refresh Token'));
    expect(await sessionToken(src)).toBeNull();
    expect(signOutLocally).toHaveBeenCalledTimes(1);
  });
});
