// The phone's password check is the server's (docs/ui-review.md, plan step 4): the same code
// and the same answers on the cases the server's own tests use (tests/deno/credentials_test.ts),
// plus everyday messages to Wilma.
import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve } from 'path';

import * as server from '../../../supabase/functions/mcp/lib/credentials';
import { credentialLabel, findCredential } from './credentials';

const SERVER_FILE = resolve(__dirname, '../../../supabase/functions/mcp/lib/credentials.ts');
const APP_FILE = resolve(__dirname, 'credentials.ts');

// Key-shaped test values are assembled at run time so secret scanners do not flag this file.
function fake(prefix: string, n: number, alphabet = 'aB3dE5gH7jK9mN2pQ4sT6vW8yZ0cF1'): string {
  let out = prefix;
  for (let i = 0; i < n; i++) out += alphabet[(i * 7 + 3) % alphabet.length];
  return out;
}

// From tests/deno/credentials_test.ts, plus how people type to Wilma.
const TRAPS: [string, string][] = [
  ['the wifi is hunter2, save it in Home', 'password'],
  ['Wifi password: Sunflower2024!', 'password'],
  ['my netflix password is fluffy and my email is ...', 'password'],
  ['My password for the bank is Tr0ub4dor&3', 'password'],
  ['I changed my password to Kitten77', 'password'],
  ["Mom's password is sunshine", 'password'],
  ['The guest wifi password is sunshine.', 'password'],
  ['Network\nSSID: HomeNet\nPassword: marigold', 'password'],
  ["password = 'correct horse battery staple'", 'password'],
  ['router sticker: wifi password Sunflower2024!', 'password'],
  ['Passwort: Geheim123', 'password'],
  ['mot de passe : soleil2024', 'password'],
  ['PIN: 4821', 'PIN'],
  ['my bank card pin is 0937', 'PIN'],
  ['pin code 55102', 'PIN'],
  ['The garage code is 4321#', 'access code'],
  ['alarm code: 908172', 'access code'],
  ['CVV 123', 'access code'],
  ['DB_PASSWORD=Xk9p2LmQ', 'password'],
  ['{"user": "bob", "password": "Pa55word!"}', 'password'],
  [`Use this key: ${fake('sk-ant-api03-', 40)}`, 'API key or token'],
  [`OPENAI_API_KEY=${fake('sk-proj-', 48)}`, 'API key or token'],
  [`token ${fake('ghp_', 36)}`, 'API key or token'],
  ['aws id AKIA' + 'Q3EXAMPLE7ZYXWVU', 'API key or token'],
  [`maps key ${fake('AIza', 35)}`, 'API key or token'],
  [`stripe ${fake('sk_live_', 24)}`, 'API key or token'],
  [fake('eyJ', 20) + '.' + fake('eyJ', 30) + '.' + fake('', 40), 'API key or token'],
  ['-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAA\n-----END OPENSSH PRIVATE KEY-----', 'private key'],
  ['api key: ' + fake('', 32, '0123456789abcdef'), 'API key or token'],
  ['client_secret = ' + fake('', 24), 'API key or token'],
  ['postgres://admin:Xk9p2LmQ@db.example.com:5432/app', 'connection string with a password'],
  ['Visa 4111 1111 1111 1111 exp 12/29', 'card number'],
  ['card: 5555-5555-5555-4444', 'card number'],
  // Messages to Wilma.
  ['save the wifi password: Sunflower2024! in Home', 'password'],
  ['remember my gym locker combination 2468', 'access code'],
];

const ORDINARY: string[] = [
  "Grandma's secret ingredient is a pinch of nutmeg.",
  'Secret: 2 tbsp fish sauce, added at the end.',
  'Pin the dough to the board and fold it in thirds; bake 25 minutes at 200C.',
  'Remember to change the wifi password every year.',
  'The wifi is slow upstairs; move the router.',
  'The wifi is 5GHz only, the printer needs 2.4GHz.',
  'My password is stored in the vault under Bank.',
  'My password is weak, change it this weekend.',
  'The password is required and must be at least 12 characters.',
  'Password: see the vault (Home Wi-Fi).',
  'Password: in Bitwarden',
  'PIN is 4 digits; the bank locks the card after 3 wrong tries.',
  'Mountain pass: 2300m, open June to October.',
  'Users reset their password through an email link (Supabase Auth).',
  'password: z.string().min(12)',
  'password: string',
  'password_hash: text not null',
  'const argon2id = (password: Uint8Array, salt: Uint8Array) => ...',
  'Owner setup and first password: `docs/phase1-m2-setup.md`.',
  'Password: https://example.com/reset (link in the email)',
  "password = request.form['password']",
  'DB_PASSWORD=${DB_PASSWORD}',
  'const password = Deno.env.get("DB_PASSWORD");',
  'postgres://postgres:[YOUR-PASSWORD]@db.abc.supabase.co:5432/postgres',
  'postgres://user:password@localhost:5432/dev',
  'api_key: <your key here>',
  'API key: stored in Supabase secrets as ANTHROPIC_API_KEY',
  'Token: ERC-20',
  'The access token expires after 1 hour; refresh tokens last 30 days.',
  'Password: ********',
  'Password: "see the vault"',
  '"password": "stored in Bitwarden"',
  'ISBN 978-0-306-40615-7, page 1234',
  'Call 0412 345 678 after 5pm',
  'Item id 3f2a9c1e-0b5d-4e8a-9f6b-2c7d1e0a4b3c',
  'Order 1234-5678-9012 shipped',
  'Hash the password Argon2id-style with a per-user salt.',
  'GPIO pin 13 drives the LED; pin 2 is ground.',
  'Commit 4b825dc642cb6eb9a060e54bf8d69288fbee4904 fixed the token refresh.',
  // Messages to Wilma.
  "what's the wifi password?",
  'where did I put the bank password',
  'open the vault',
  'sushi near me',
  'save a recipe for hummus: 1 can chickpeas, 2 tbsp tahini, 1 lemon',
  'Home',
  '',
];

/** The lines between the markers (app) or the same stretch of the server's file. */
function copied(file: string, begin: RegExp, end: RegExp): string {
  const lines = readFileSync(file, 'utf8').split('\n');
  const from = lines.findIndex((l) => begin.test(l));
  const to = lines.findIndex((l, i) => i > from && end.test(l));
  expect(from).toBeGreaterThanOrEqual(0);
  expect(to).toBeGreaterThan(from);
  return lines.slice(from, to).join('\n').trimEnd();
}

describe('the phone checks text the way the server does', () => {
  it("holds the server's code, unchanged", () => {
    const app = copied(APP_FILE, /^\/\/ ---- Copied from the server: begin/, /^\/\/ ---- Copied from the server: end/);
    const srv = copied(SERVER_FILE, /^export type CredentialKind/, /^\/\*\* Flatten metadata/);
    expect(app.split('\n').slice(1).join('\n')).toBe(srv);
  });

  it.each(TRAPS)('catches: %s', (text, kind) => {
    expect(findCredential(text)).toBe(kind);
    expect(server.findCredential(text)).toBe(kind);
  });

  it.each(ORDINARY)('lets through: %s', (text) => {
    expect(findCredential(text)).toBeNull();
    expect(server.findCredential(text)).toBeNull();
  });

  it('gives the same answer as the server on every prefix as it is typed', () => {
    for (const [text] of TRAPS) {
      for (let i = 1; i <= text.length; i++) {
        expect(findCredential(text.slice(0, i))).toBe(server.findCredential(text.slice(0, i)));
      }
    }
  });
});

describe('credentialLabel', () => {
  it('names the kind with its article, never the value', () => {
    expect(credentialLabel('password')).toBe('a password');
    expect(credentialLabel('PIN')).toBe('a PIN');
    expect(credentialLabel('API key or token')).toBe('an API key or token');
    expect(credentialLabel('access code')).toBe('an access code');
  });
});
