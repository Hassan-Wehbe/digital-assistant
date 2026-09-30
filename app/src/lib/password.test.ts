import { describe, expect, it, jest } from '@jest/globals';

import { changePassword, type PasswordDeps } from './password';

const OLD = 'temporary-pass-1';
const NEW = 'my own long password';

function setup(verifyError: string | null = null, updateError: string | null = null) {
  const verify = jest.fn<PasswordDeps['verify']>(async () => verifyError);
  const update = jest.fn<PasswordDeps['update']>(async () => updateError);
  return { deps: { verify, update }, verify, update };
}

describe('changePassword', () => {
  it('checks the current password, then sets the new one', async () => {
    const t = setup();
    await changePassword(t.deps, 'me@example.org', OLD, NEW, NEW);
    expect(t.verify).toHaveBeenCalledWith('me@example.org', OLD);
    expect(t.update).toHaveBeenCalledWith(NEW);
  });

  it('changes nothing when the current password is wrong', async () => {
    const t = setup('Invalid login credentials');
    await expect(changePassword(t.deps, 'me@example.org', 'wrong', NEW, NEW)).rejects.toThrow('The current password is not right.');
    expect(t.update).not.toHaveBeenCalled();
  });

  it('asks for a long enough new password, typed the same twice, different from the old one', async () => {
    const t = setup();
    await expect(changePassword(t.deps, 'me@example.org', OLD, 'short', 'short')).rejects.toThrow(/10 characters/);
    await expect(changePassword(t.deps, 'me@example.org', OLD, NEW, NEW + 'x')).rejects.toThrow(/different/);
    await expect(changePassword(t.deps, 'me@example.org', OLD, OLD, OLD)).rejects.toThrow(/same as the current/);
    await expect(changePassword(t.deps, 'me@example.org', '', NEW, NEW)).rejects.toThrow(/current sign-in password/);
    await expect(changePassword(t.deps, undefined, OLD, NEW, NEW)).rejects.toThrow(/Sign in again/);
    expect(t.verify).not.toHaveBeenCalled();
  });

  it("reports the server's reason without the password", async () => {
    const t = setup(null, 'Password is known to be weak');
    const err = (await changePassword(t.deps, 'me@example.org', OLD, NEW, NEW).catch((e) => e)) as Error;
    expect(err.message).toBe('The password was not changed: Password is known to be weak');
    expect(err.message).not.toContain(NEW);
  });
});
