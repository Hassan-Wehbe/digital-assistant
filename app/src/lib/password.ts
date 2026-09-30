// Changing the sign-in password (testers replace the temporary one the owner gives them).
// The current password is checked first, so a phone left signed in cannot be used to take
// over the account. Never log or report a password.

export const MIN_PASSWORD_LENGTH = 10;

export interface PasswordDeps {
  /** Sign in again with the current password; returns an error message, or null. */
  verify(email: string, password: string): Promise<string | null>;
  /** Set the new password for the signed-in user; returns an error message, or null. */
  update(password: string): Promise<string | null>;
}

export async function changePassword(deps: PasswordDeps, email: string | undefined, current: string, next: string, again: string): Promise<void> {
  if (!email) throw new Error('Sign in again first.');
  if (!current) throw new Error('Enter your current sign-in password.');
  if (next.length < MIN_PASSWORD_LENGTH) throw new Error(`Use at least ${MIN_PASSWORD_LENGTH} characters for the new password.`);
  if (next !== again) throw new Error('The two new passwords are different.');
  if (next === current) throw new Error('The new password is the same as the current one.');
  if (await deps.verify(email, current)) throw new Error('The current password is not right.');
  const problem = await deps.update(next);
  if (problem) throw new Error(`The password was not changed: ${problem}`);
}
