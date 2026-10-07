// CLAUDE.md rule 9: security never depends on the model. Items are indexed for search and
// sent to models as context, so credentials must never be stored in them. The tool
// descriptions ask the model to use the vault; this check enforces it in the server.
//
// What it catches: well-known key formats (API keys, private keys, tokens, card numbers,
// connection strings with a password) and labelled values ("password: ...", "PIN 4821",
// "the wifi is hunter2", "my password is ..."). What it lets through: text that only talks
// about passwords, placeholders (<password>, ${DB_PASSWORD}, ****) and code.
//
// The suspected value is never returned, logged or put in an error: callers learn only
// which field and what kind of credential it looked like.

export type CredentialKind =
  | "password"
  | "PIN"
  | "access code"
  | "API key or token"
  | "private key"
  | "card number"
  | "connection string with a password";

export interface CredentialFinding {
  field: string;
  kind: CredentialKind;
}

// ---- Well-known formats: specific enough to flag wherever they appear --------------------

const KNOWN_FORMATS: [CredentialKind, RegExp][] = [
  ["private key", /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/],
  ["API key or token", /\bsk-ant-[A-Za-z0-9_-]{20,}/], // Anthropic
  ["API key or token", /\bsk-(?:proj-|svcacct-|admin-)?(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{20,}/], // OpenAI
  ["API key or token", /\bgh[pousr]_[A-Za-z0-9]{30,}/], // GitHub
  ["API key or token", /\bgithub_pat_[A-Za-z0-9_]{22,}/],
  ["API key or token", /\bglpat-[A-Za-z0-9_-]{20,}/], // GitLab
  ["API key or token", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/], // AWS access key id
  ["API key or token", /\bAIza[0-9A-Za-z_-]{35}/], // Google
  ["API key or token", /\bxox[abposr]-[A-Za-z0-9-]{10,}/], // Slack
  ["API key or token", /\b[rs]k_(?:live|test)_[A-Za-z0-9]{16,}/], // Stripe
  ["API key or token", /\bsb_secret_[A-Za-z0-9_-]{20,}/], // Supabase
  ["API key or token", /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/], // SendGrid
  ["API key or token", /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/], // JWT
];

const CONNECTION_STRING = /\b[a-z][a-z0-9+.-]{1,20}:\/\/[^\s:/@]+:([^\s@/]+)@/gi;

// Card numbers: 13-19 digits (spaces or dashes allowed), a card network's prefix, Luhn-valid.
const CARD_CANDIDATE = /(?<![\d-])(?:\d[ -]?){12,18}\d(?![\d-])/g;
const CARD_PREFIX = /^(?:4|5[1-5]|2[2-7]|3[47]|6(?:011|5))/;

function luhnValid(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

// ---- Labelled values: "<label> <separator> <value>" --------------------------------------

type LabelKind = "password" | "wifi" | "PIN" | "access code" | "API key or token";

// Letters or digits may not touch the label (so "password_hash", "passwordHash", "spin" do
// not count), but "_" or "-" before it may ("DB_PASSWORD", "wifi-password").
const B = "(?<![\\p{L}\\p{N}])";
const E = "(?![\\p{L}\\p{N}_])";
const LABELS: [LabelKind, string][] = [
  ["password", "pass(?:word|wort|code|phrase|wd)|pwd|pw|kennwort|mot de passe|contrase(?:ñ|n)a|كلمة (?:السر|المرور)"],
  ["wifi", "wi-?fi|wlan|(?:network|wpa2?|wifi|wi-fi) key"],
  ["PIN", "pin(?: code| number)?"],
  ["access code", "(?:door|gate|alarm|garage|lock|safe|entry|building|access|security|unlock|entrance) code|combination|cvv|cvc"],
  ["API key or token", "api[ _-]?(?:key|token|secret)|access[ _-]?key|secret[ _-]?key|(?:access|auth|bearer|refresh|session)[ _-]?token|client[ _-]?secret|app[ _-]?secret|token|secret"],
];
const LABEL_RE = new RegExp(
  LABELS.map(([, src], i) => `(?<l${i}>${B}(?:${src})${E})`).join("|"),
  "giu",
);

// After the label: ways the value is introduced. Each is tried; any secret-looking value counts.
const SEPARATORS: RegExp[] = [
  // password: x | password = x | "password": "x" | password => x | Password - x
  /^["'`]?\s*(?::|=>?|\s[-–—])\s*/,
  // password is x | password was: x | password is now x
  /^\s+(?:is|was)(?:\s+(?:now|still|currently|actually|just))?\s*:?\s*/i,
  // password for the bank is x | password to netflix: x
  /^\s+(?:for|to|of|on|at|in)\s+[^\n:=]{1,40}?(?:\s+(?:is|was)\s+|\s*[:=]\s*)/i,
  // changed my password to x
  /^\s+to\s+/i,
  // PIN 4821 | door code 1234 | wifi password Sunflower2024! ("bare": strict, see looksSecret)
  /^\s+/,
];

// Words that follow "password is" / "password:" in ordinary prose, docs and schemas.
const ORDINARY = new Set((
  "a an the in on at to of for by with from as is it its this that these those there here what which who " +
  "how why when where not no none never always also still now just only very too so and or but if same " +
  "different required optional needed mandatory necessary missing empty blank unknown unset null nil " +
  "undefined true false yes ok okay fine good bad weak strong long short simple complex secure insecure safe " +
  "unsafe random unique private public secret hidden visible correct incorrect wrong right valid invalid new " +
  "old expired temporary temp default standard string text varchar char int integer number numeric bool " +
  "boolean hash bytes object any str type field value see ask check vault bitwarden lastpass keychain manager " +
  "elsewhere below above attached inside provided unchanged case sensitive your their our my his her " +
  "enabled disabled tbd todo n/a na later soon please"
).split(" "));
const ADJECTIVE_ENDINGS = /(?:ed|ing|ly|ive|ble|al|ous|ful|less|ness|ment|tion|sion)$/;
const PLACEHOLDER_WHOLE = /^(?:password|passwd|pass|pwd|secret|token|key|value|none|null|empty|tbd|todo)$/i;
const PLACEHOLDER_PART =
  /your|example|placeholder|redacted|dummy|sample|xxx|\benv\b|process\.env|deno\.env|os\.environ|getenv|(?:^|[_.-])(?:password|passwd|pwd|secret|token)(?:$|[_.-])/i;
const UNITS = /^(?:\d+(?:\.\d+)?(?:ghz|mhz|mbps|gbps|kbps|ms|s)|802\.11\w*)$/i;
const FIRST_PERSON = /(?:^|[^\p{L}])(?:my|our|his|her|their|\p{L}+['’]s)\s+(?:[\p{L}-]+\s+){0,3}$/iu;

/** The value right after a separator: a quoted string, or up to the next whitespace. */
function readValue(rest: string): { value: string; terminal: boolean } | null {
  let value: string;
  let after: string;
  const q = rest[0];
  if (q === '"' || q === "'" || q === "`" || q === "“") {
    const close = rest.indexOf(q === "“" ? "”" : q, 1);
    if (close < 0 || close > 120) return null;
    value = rest.slice(1, close);
    after = rest.slice(close + 1);
  } else {
    const m = rest.match(/^\S{1,120}/);
    if (!m) return null;
    value = m[0];
    after = rest.slice(value.length);
    // Sentence punctuation after a value is not part of it ("it's hunter2.").
    const trimmed = value.replace(/[.,;:!?)\]}"'”]+$/, "");
    if (trimmed && trimmed !== value) {
      after = value.slice(trimmed.length) + after;
      value = trimmed;
    }
  }
  if (!value) return null;
  // The value ends a clause: end of text or line, or punctuation (not "is stored in ...").
  const terminal = /^\s*(?:$|[\n.,;!?)\]}"'”]|\s[-–—]\s|\s(?:and|but|so|please)\b)/i.test(after);
  return { value, terminal };
}

const hasLetter = (v: string) => /\p{L}/u.test(v);
const hasDigit = (v: string) => /\d/.test(v);
const hasSymbol = (v: string) => /[!@#$%^&*+=?~|\\/<>;:,.]/.test(v);

function isPlaceholder(v: string): boolean {
  if (/^[<{[(].*[>}\])]$/.test(v)) return true; // <password>, {{x}}, [YOUR-PASSWORD], (none)
  if (/^[$%]/.test(v)) return true; // $DB_PASSWORD, ${X}, %PASSWORD%
  if (/^([x*.•·_-])\1*$/i.test(v)) return true; // ****, xxxx, ...
  return PLACEHOLDER_WHOLE.test(v) || PLACEHOLDER_PART.test(v);
}

// Type and algorithm names that follow "password:" in code and designs.
const TYPE_NAMES =
  /^(?:u?int\d+(?:array)?|float\d+(?:array)?|bytes\d*|base(?:32|64)\w*|hex|utf-?(?:8|16)|sha-?\d+|md5|argon2\w*|bcrypt|scrypt|pbkdf2\w*|x25519|ed25519|aes-?\w*)$/i;

/** Code, a type, a file path or a link rather than a value: config.password,
 *  z.string().min(8), Uint8Array, docs/setup.md, https://... */
function isCode(v: string): boolean {
  return /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/.test(v) ||
    /^[A-Za-z_$][\w$.]*[([]/.test(v) ||
    TYPE_NAMES.test(v) ||
    /^(?:\.{0,2}\/)?[\w.-]+(?:\/[\w.-]+)+\/?$/.test(v) ||
    /^[a-z][a-z0-9+.-]*:\/\//i.test(v);
}

function isOrdinaryWord(v: string): boolean {
  const w = v.toLowerCase();
  return w.length < 4 || ORDINARY.has(w) || ADJECTIVE_ENDINGS.test(w);
}

function looksSecret(
  kind: LabelKind,
  value: string,
  ctx: { terminal: boolean; firstPerson: boolean; bare: boolean },
): boolean {
  if (/\s/.test(value)) return false; // quoted passphrases are handled in findLabelled
  if (isPlaceholder(value) || isCode(value)) return false;
  const digitsOnly = /^\d+$/.test(value);
  const keypad = /^[\d#*]+$/.test(value) && (value.match(/\d/g) ?? []).length >= 3;

  switch (kind) {
    case "PIN":
      return /^\d{4,8}#?$/.test(value);
    case "access code":
      if (keypad && value.length <= 10) return true;
      return !ctx.bare && hasDigit(value) && hasLetter(value) && value.length >= 4;
    case "API key or token":
      if (ctx.bare) return false;
      return value.length >= 16 && hasLetter(value) && hasDigit(value);
    case "wifi":
    case "password": {
      if (ctx.bare) {
        // "wifi password Sunflower2024!": no separator, so only an unmistakable value.
        return ctx.terminal && value.length >= 8 && hasLetter(value) && hasDigit(value) &&
          (hasSymbol(value) || (/\p{Lu}/u.test(value) && /\p{Ll}/u.test(value)));
      }
      if (UNITS.test(value)) return false;
      if (digitsOnly) return value.length >= 4 && value.length <= 12;
      if (hasLetter(value) && hasDigit(value)) return value.length >= 5;
      if (hasLetter(value) && hasSymbol(value)) return value.length >= 6;
      if (kind === "wifi" || !/^\p{L}+$/u.test(value)) return false;
      // A plain word: only when it clearly is the value.
      if (isOrdinaryWord(value)) return false;
      if (ctx.firstPerson) return true; // "my password is fluffy and ..."
      return ctx.terminal; // "the password is sunshine." / "Password: sunshine"
    }
  }
}

function findLabelled(text: string): CredentialKind | null {
  // exec, not matchAll: the phone's JavaScript engine (Hermes) leaves out named groups in
  // matchAll's results, which crashed the app on "password" (versionCode 12). A fresh copy of the
  // pattern, so its position never carries over between calls.
  const re = new RegExp(LABEL_RE.source, LABEL_RE.flags);
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const groups = m.groups ?? {};
    const idx = LABELS.findIndex((_, i) => groups[`l${i}`] !== undefined);
    if (idx < 0) continue;
    const kind = LABELS[idx][0];
    const end = m.index! + m[0].length;
    const rest = text.slice(end, end + 200);
    const firstPerson = FIRST_PERSON.test(text.slice(Math.max(0, m.index! - 60), m.index!));

    for (const [s, sep] of SEPARATORS.entries()) {
      const bare = s === SEPARATORS.length - 1;
      const sm = rest.match(sep);
      if (!sm) continue;
      const v = readValue(rest.slice(sm[0].length));
      if (!v) continue;
      const quoted = /^["'`“]/.test(rest.slice(sm[0].length));
      // A quoted passphrase may contain spaces: "password": "correct horse battery".
      if (quoted && (kind === "password" || kind === "wifi") && /\s/.test(v.value) && !bare) {
        const words = v.value.trim().split(/\s+/);
        const ordinary = words.filter(isOrdinaryWord).length;
        if (!isPlaceholder(v.value) && v.value.length >= 8 && words.length <= 6 && ordinary <= 1) {
          return kind === "wifi" ? "password" : kind;
        }
        continue;
      }
      if (looksSecret(kind, v.value, { ...v, firstPerson, bare })) {
        return kind === "wifi" ? "password" : kind;
      }
    }
  }
  return null;
}

/** What kind of credential the text seems to contain, or null. Never returns the value. */
export function findCredential(text: string): CredentialKind | null {
  if (!text) return null;
  for (const [kind, re] of KNOWN_FORMATS) if (re.test(text)) return kind;

  for (const m of text.matchAll(CONNECTION_STRING)) {
    const pw = decodeURIComponentSafe(m[1]);
    if (!isPlaceholder(pw) && !/^(?:pass|pwd|password)$/i.test(pw)) return "connection string with a password";
  }

  for (const m of text.matchAll(CARD_CANDIDATE)) {
    const digits = m[0].replace(/[ -]/g, "");
    if (digits.length >= 13 && digits.length <= 19 && CARD_PREFIX.test(digits) && luhnValid(digits)) {
      return "card number";
    }
  }

  return findLabelled(text);
}

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Flatten metadata so keys act as labels: {"wifi_password": "x"} -> "wifi_password: x". */
function flatten(value: unknown, key = ""): string[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.flatMap((v) => flatten(v, key));
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => flatten(v, k));
  }
  return [key ? `${key}: ${String(value)}` : String(value)];
}

/** The first field (in the order given) that seems to contain a credential. */
export function scanFields(fields: Record<string, unknown>): CredentialFinding | null {
  for (const [field, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    const texts = typeof value === "string" ? [value] : flatten(value);
    for (const text of texts) {
      const kind = findCredential(text);
      if (kind) return { field, kind };
    }
  }
  return null;
}

/** The refusal shown to the model. Built only from the field name and kind, never the value. */
export function credentialRefusal(f: CredentialFinding, assistantName = "Wilma"): string {
  return (
    `Not saved: the ${f.field} looks like it contains a ${f.kind}. ${assistantName} keeps passwords, ` +
    "PINs, keys and other credentials only in the encrypted vault, never in notes, because notes are " +
    "searchable and are read by AI models. Do not repeat the value in your reply. Offer the vault " +
    "instead: save_secret takes only a name (and optional address and type) and returns a link where " +
    "the user types the value themselves. If the user typed the value into this chat, suggest they " +
    "change it. The rest of the note can still be saved without the value, mentioning that it is in " +
    "the vault. If this is a false alarm (the text only talks about credentials), reword that part so " +
    "it holds no value-like text and save again."
  );
}

/** Throw the refusal if any field looks like it holds a credential (use inside guarded()). */
export function rejectCredentials(fields: Record<string, unknown>, assistantName?: string): void {
  const finding = scanFields(fields);
  if (finding) throw new Error(credentialRefusal(finding, assistantName));
}
