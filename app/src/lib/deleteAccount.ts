// Delete my account (docs/signup-plan.md step 3): the delete-account function checks the sign-in
// and the password again, then deletes the files, the account and everything it owns. The app
// then forgets the session (and with it the chat, My day's choices and recent spaces: auth.tsx).
// Never log or report the password.
import { SUPABASE_URL } from './config';

export const DELETE_ACCOUNT_URL = `${SUPABASE_URL}/functions/v1/delete-account`;
export const CONFIRM_WORD = 'DELETE';

export interface DeleteAccountDeps {
  token(): Promise<string | null>;
  fetch(url: string, init: { method: string; headers: Record<string, string>; body: string }): Promise<{ status: number; json(): Promise<unknown> }>;
  /** Forget the session on this phone (the server one is gone with the account). */
  signOutLocally(): Promise<void>;
}

/** Null when the account is deleted; otherwise what to show. */
export async function deleteAccount(deps: DeleteAccountDeps, password: string, typed: string): Promise<string | null> {
  if (typed.trim() !== CONFIRM_WORD) return `Type ${CONFIRM_WORD} to confirm.`;
  if (!password) return 'Enter your sign-in password.';
  const token = await deps.token();
  if (!token) return 'Sign in again first.';
  let res: { status: number; json(): Promise<unknown> };
  try {
    res = await deps.fetch(DELETE_ACCOUNT_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ password, confirm: CONFIRM_WORD }),
    });
  } catch {
    return 'Could not reach Wilma. Check your connection and try again.';
  }
  if (res.status === 200) {
    await deps.signOutLocally();
    return null;
  }
  if (res.status === 401) return 'Sign in again first.';
  const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
  return typeof body?.error === 'string' ? body.error : 'Your account was not deleted. Try again in a moment.';
}
