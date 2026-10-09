// Invite-only sign-up (docs/signup-plan.md step 2, design D29). The server decides: its Before
// User Created hook (20261011120000_invite_signup.sql) refuses a sign-up without a valid invite
// code or without 18+ and the current terms, and its message is shown as is. The checks here only
// save a round trip. Never log or report a password.
import { MIN_PASSWORD_LENGTH } from './password';

/** The terms a new account accepts; the same value as signup_setting.terms_version. */
export const TERMS_VERSION = '2026-10-09';

const PAGES_URL = 'https://hassan-wehbe.github.io/digital-assistant';
export const PRIVACY_URL = `${PAGES_URL}/legal/privacy.html`;
export const TERMS_URL = `${PAGES_URL}/legal/testing-terms.html`;
/** Where the confirmation email's link lands: "Your email is confirmed; sign in in the app". */
export const EMAIL_CONFIRMED_URL = `${PAGES_URL}/legal/email-confirmed.html`;

export type SignupMode = 'invite' | 'open';

export interface SignupForm {
  code: string;
  email: string;
  password: string;
  again: string;
  /** "I am 18 or older and agree to the Privacy policy and Testing terms." */
  agreed: boolean;
}

/** What is missing or wrong in the form, or null when it can be sent. */
export function signupProblem(form: SignupForm, mode: SignupMode): string | null {
  if (mode === 'invite' && !form.code.trim()) return 'Enter your invite code.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) return 'Enter your email address.';
  if (form.password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters for your password.`;
  if (form.password !== form.again) return 'The two passwords are different.';
  if (!form.agreed) return 'Tick the box to confirm you are 18 or older and agree to the privacy policy and testing terms.';
  return null;
}

export interface SignupError {
  message: string;
  code?: string;
  status?: number;
}

export interface SignupDeps {
  signUp(args: {
    email: string;
    password: string;
    options: { data: Record<string, unknown>; emailRedirectTo: string };
  }): Promise<{ error: SignupError | null }>;
  /** True when the request did not reach the server (no connection). */
  isConnectionError(error: unknown): boolean;
}

/** Sends the sign-up. Null means "check your email"; otherwise what to show. */
export async function createAccount(deps: SignupDeps, form: SignupForm, mode: SignupMode): Promise<string | null> {
  const problem = signupProblem(form, mode);
  if (problem) return problem;
  const code = form.code.trim();
  const { error } = await deps.signUp({
    email: form.email.trim().toLowerCase(),
    password: form.password,
    options: {
      data: { ...(code ? { invite_code: code } : {}), age_confirmed: true, terms_version: TERMS_VERSION },
      emailRedirectTo: EMAIL_CONFIRMED_URL,
    },
  });
  return error ? signupErrorText(error, deps.isConnectionError(error)) : null;
}

/** Supabase's sign-up errors in plain words. The hook's own messages are already plain. */
export function signupErrorText(error: SignupError, connection = false): string {
  if (connection) return 'Could not reach Wilma. Check your connection and try again.';
  const m = error.message ?? '';
  if (error.code === 'over_email_send_rate_limit' || /rate limit/i.test(m)) {
    return 'Too many sign-ups just now. Try again in an hour.';
  }
  if (error.code === 'signup_disabled' || /signups not allowed/i.test(m)) {
    return 'Creating accounts is switched off for now. Ask the person who invited you.';
  }
  // The sign-up trigger's last check (a code's last use taken at the same moment).
  if (/database error saving new user/i.test(m)) return 'This invite code could not be used. Ask for a new one.';
  return m || 'The account was not created. Try again.';
}

/** Invite-only or open (server setting, Q8): open hides the code field. Invite when unsure. */
export async function loadSignupMode(rpc: (fn: 'signup_mode') => PromiseLike<{ data: unknown; error: unknown }>): Promise<SignupMode> {
  try {
    const { data, error } = await rpc('signup_mode');
    return !error && data === 'open' ? 'open' : 'invite';
  } catch {
    return 'invite';
  }
}

/** First sign-in of an account made in the app (its sign-up carried the terms): show Welcome. */
export function isAppSignup(metadata: Record<string, unknown> | undefined): boolean {
  return typeof metadata?.terms_version === 'string';
}

export const welcomeKey = (userId: string) => `welcome-seen:${userId}`;
