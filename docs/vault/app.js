// Shared helpers for the vault pages: sign-in, database calls, small DOM helpers.
// Everything shown from the database or a link is set with textContent (never parsed as HTML).
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "../oauth/config.js";
import { ready, VaultError } from "./crypto.js";

// Refuse to run inside a frame (clickjacking); GitHub Pages cannot send
// frame-ancestors headers, so this is the page's own check.
if (window.top !== window.self) {
  document.documentElement.textContent = "";
  throw new Error("framed");
}

export const $ = (id) => document.getElementById(id);

// Same sign-in session as the consent page (same site, same storage key).
// It holds only the Supabase login session; no vault key or secret is ever stored.
const db = globalThis.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { detectSessionInUrl: false },
});

const SECTIONS = new Set();

/** Show one section (by id) and hide the others registered with show(). */
export function show(id) {
  if (id) SECTIONS.add(id);
  for (const s of SECTIONS) $(s).hidden = s !== id;
}

export function status(message, kind = "muted") {
  const el = $("status");
  el.textContent = message ?? "";
  el.hidden = !message;
  el.className = kind === "error" ? "error" : kind === "ok" ? "ok" : "muted";
}

export function errorText(err) {
  if (err instanceof VaultError) return err.message;
  return err?.message ?? String(err);
}

export async function rpc(fn, args = {}) {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data;
}

/** The link token, from "#t=..." (a fragment is never sent to any server). */
export function linkToken() {
  const t = new URLSearchParams(location.hash.slice(1)).get("t");
  return t && /^[A-Za-z0-9_-]{20,100}$/.test(t) ? t : null;
}

export function minutesLeft(iso) {
  const m = Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 60000));
  return m <= 1 ? "about a minute" : `${m} minutes`;
}

/**
 * Make sure the owner is signed in, then run `onReady(email)`.
 * The page needs a #login form with #email and #password.
 */
export async function withSession(onReady) {
  status("Loading…");
  await ready();
  const run = async () => {
    const { data: { session } } = await db.auth.getSession();
    if (!session) {
      status(null);
      return show("login");
    }
    $("who").textContent = session.user.email ?? "";
    $("account").hidden = false;
    try {
      await onReady(session.user.email ?? "");
    } catch (err) {
      show(null);
      status(errorText(err), "error");
    }
  };

  $("login").addEventListener("submit", async (e) => {
    e.preventDefault();
    status("Signing in…");
    const { error } = await db.auth.signInWithPassword({
      email: $("email").value.trim(),
      password: $("password").value,
    });
    $("password").value = "";
    if (error) return status(error.message, "error");
    await run();
  });
  $("signout").addEventListener("click", async (e) => {
    e.preventDefault();
    await db.auth.signOut();
    $("account").hidden = true;
    status(null);
    show("login");
  });
  await run();
}

/** Disable a form's controls while `fn` runs; always re-enable. */
export async function busy(form, message, fn) {
  const controls = [...form.querySelectorAll("button, input, textarea")];
  for (const c of controls) c.disabled = true;
  status(message);
  // Let the browser paint the message before Argon2id blocks the thread.
  await new Promise((r) => setTimeout(r, 30));
  try {
    return await fn();
  } finally {
    for (const c of controls) c.disabled = false;
  }
}

/** Show/hide toggle for a password input. */
export function revealToggle(input) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "small";
  b.textContent = "Show";
  b.addEventListener("click", () => {
    const hidden = input.type === "password";
    input.type = hidden ? "text" : "password";
    b.textContent = hidden ? "Hide" : "Show";
  });
  return b;
}
