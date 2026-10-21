// Invite-only sign-up (docs/signup-plan.md step 2): the form's checks, what is sent, the errors in
// plain words, the mode, and where the screens are.
import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve } from 'path';

import {
  createAccount,
  EMAIL_CONFIRMED_URL,
  isAppSignup,
  loadSignupMode,
  signupErrorText,
  signupProblem,
  TERMS_VERSION,
  welcomeKey,
  type SignupDeps,
  type SignupForm,
} from './signup';

const FORM: SignupForm = { code: ' wilma-7k3q-p9xd ', email: ' Tess@Example.com ', password: 'correct horse', again: 'correct horse', birthMonth: 4, birthYear: ' 1990 ', agreed: true };

function fakeDeps(error: { message: string; code?: string } | null = null) {
  const calls: Parameters<SignupDeps['signUp']>[0][] = [];
  const deps: SignupDeps = {
    signUp: async (args) => {
      calls.push(args);
      return { error };
    },
    isConnectionError: (e) => (e as { message?: string })?.message === 'offline',
  };
  return { deps, calls };
}

describe('the form', () => {
  it('passes when everything is there', () => {
    expect(signupProblem(FORM, 'invite')).toBeNull();
  });

  it('needs the code in invite mode only', () => {
    expect(signupProblem({ ...FORM, code: '  ' }, 'invite')).toBe('Enter your invite code.');
    expect(signupProblem({ ...FORM, code: '' }, 'open')).toBeNull();
  });

  it('checks the email, the password length and match, the month and year of birth, and the box', () => {
    expect(signupProblem({ ...FORM, email: 'tess' }, 'invite')).toBe('Enter your email address.');
    expect(signupProblem({ ...FORM, password: 'short', again: 'short' }, 'invite')).toMatch(/at least 10 characters/);
    expect(signupProblem({ ...FORM, again: 'correct horsE' }, 'invite')).toBe('The two passwords are different.');
    expect(signupProblem({ ...FORM, agreed: false }, 'invite')).toBe('Tick the box to agree to the privacy policy and testing terms.');
    const today = new Date(2026, 9, 21);
    expect(signupProblem({ ...FORM, birthMonth: null }, 'invite', today)).toBe('Enter your month and year of birth.');
    expect(signupProblem({ ...FORM, birthYear: '90' }, 'invite', today)).toBe('Enter your month and year of birth.');
    expect(signupProblem({ ...FORM, birthMonth: 11, birthYear: '2026' }, 'invite', today)).toBe('Please enter a real month and year of birth.');
    expect(signupProblem({ ...FORM, birthYear: '1890' }, 'invite', today)).toBe('Please enter a real month and year of birth.');
    // The minimum age is the server's: a 15-year-old's form is sent, and the server says no.
    expect(signupProblem({ ...FORM, birthYear: '2011' }, 'invite', today)).toBeNull();
  });
});

describe('creating the account', () => {
  it('sends the code, the month and year of birth and the terms version as sign-up metadata, and the confirmation page', async () => {
    const { deps, calls } = fakeDeps();
    expect(await createAccount(deps, FORM, 'invite')).toBeNull();
    expect(calls).toEqual([
      {
        email: 'tess@example.com',
        password: 'correct horse',
        options: {
          data: { invite_code: 'wilma-7k3q-p9xd', birth_month: 4, birth_year: 1990, terms_version: TERMS_VERSION },
          emailRedirectTo: EMAIL_CONFIRMED_URL,
        },
      },
    ]);
  });

  it('sends no code field when there is none (open mode)', async () => {
    const { deps, calls } = fakeDeps();
    await createAccount(deps, { ...FORM, code: '' }, 'open');
    expect(calls[0].options.data).not.toHaveProperty('invite_code');
  });

  it('sends nothing when the form is not complete', async () => {
    const { deps, calls } = fakeDeps();
    expect(await createAccount(deps, { ...FORM, agreed: false }, 'invite')).toMatch(/Tick the box/);
    expect(calls).toHaveLength(0);
  });

  it('shows the server hook message as is, and never the password', async () => {
    const { deps } = fakeDeps({ message: 'This invite code has expired. Ask for a new one.' });
    const out = await createAccount(deps, FORM, 'invite');
    expect(out).toBe('This invite code has expired. Ask for a new one.');
    expect(out).not.toContain(FORM.password);
  });

  it('puts Supabase errors in plain words', () => {
    expect(signupErrorText({ message: 'email rate limit exceeded', code: 'over_email_send_rate_limit' })).toMatch(/Try again in an hour/);
    expect(signupErrorText({ message: 'Signups not allowed for this instance', code: 'signup_disabled' })).toMatch(/switched off/);
    expect(signupErrorText({ message: 'Database error saving new user' })).toMatch(/could not be used/);
    expect(signupErrorText({ message: 'offline' }, true)).toMatch(/Could not reach Wilma/);
    expect(signupErrorText({ message: '' })).toMatch(/not created/);
  });
});

describe('the sign-up mode', () => {
  it('is open only when the server says so', async () => {
    expect(await loadSignupMode(async () => ({ data: 'open', error: null }))).toBe('open');
    expect(await loadSignupMode(async () => ({ data: 'invite', error: null }))).toBe('invite');
    expect(await loadSignupMode(async () => ({ data: 'open', error: { message: 'x' } }))).toBe('invite');
    expect(await loadSignupMode(async () => Promise.reject(new Error('offline')))).toBe('invite');
  });
});

describe('Welcome', () => {
  it('is for accounts made in the app, once per account on this phone', () => {
    expect(isAppSignup({ terms_version: TERMS_VERSION, age_confirmed: true })).toBe(true);
    expect(isAppSignup({})).toBe(false);
    expect(isAppSignup(undefined)).toBe(false);
    expect(welcomeKey('u1')).toBe('welcome-seen:u1');
  });
});

describe('the screens', () => {
  const SRC = resolve(__dirname, '..');
  const read = (f: string) => readFileSync(resolve(SRC, f), 'utf8');

  it('Create account exists only while signed out, next to sign in', () => {
    const layout = read('app/_layout.tsx');
    const signedOut = layout.slice(layout.indexOf('<Stack.Protected guard={!signedIn}>'));
    expect(signedOut).toContain('<Stack.Screen name="create-account"');
    expect(layout.slice(0, layout.indexOf('<Stack.Protected guard={!signedIn}>'))).not.toContain('create-account');
  });

  it('sign in links to it, and it signs up through createAccount', () => {
    expect(read('app/sign-in.tsx')).toContain("router.push('/create-account')");
    const screen = read('app/create-account.tsx');
    expect(screen).toContain('await createAccount(');
    expect(screen).toContain('supabase.auth.signUp(args)');
    expect(screen).toContain('accessibilityRole="checkbox"');
  });

  it('the terms version matches the migration', () => {
    const sql = readFileSync(resolve(SRC, '../../supabase/migrations/20261011120000_invite_signup.sql'), 'utf8');
    expect(sql).toContain(`terms_version  text not null default '${TERMS_VERSION}'`);
  });

  it('Home shows the Welcome card', () => {
    expect(read('app/index.tsx')).toContain('<WelcomeCard />');
  });
});
