// Sign-in / consent page for the Claude connector (OAuth 2.1 via Supabase Auth).
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./config.js";

// Refuse to run inside a frame: an approve button is a clickjacking target, and
// GitHub Pages cannot send frame-ancestors headers.
if (window.top !== window.self) {
  document.documentElement.textContent = "";
  throw new Error("framed");
}

const $ = (id) => document.getElementById(id);
// supabase-js is the copy vendored for the vault pages (docs/vault/vendor/), loaded
// by consent.html as a classic script; nothing is fetched from a CDN.
const supabase = globalThis.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
const authorizationId = new URLSearchParams(location.search).get("authorization_id");

// Everything shown from the request is set with textContent (never parsed as HTML):
// client names are chosen by whoever registers the client.
function show(section, message, isError = false) {
  for (const id of ["login", "consent"]) $(id).hidden = id !== section;
  $("status").textContent = message ?? "";
  $("status").hidden = !message;
  $("status").className = isError ? "error" : "muted";
}

async function loadRequest() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return show("login");

  const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
  if (error) return show(null, `This sign-in request can't be used: ${error.message}`, true);
  if (!("authorization_id" in data)) {
    // Already approved before: go straight back to the app.
    show(null, "Already approved. Returning to the app…");
    location.assign(data.redirect_url);
    return;
  }
  $("client-name").textContent = data.client?.name || "An app";
  $("user-email").textContent = data.user?.email ?? session.user.email ?? "";
  $("redirect").textContent = data.redirect_uri;
  $("scopes").textContent = data.scope?.trim() || "(none)";
  show("consent");
}

async function decide(approve) {
  $("approve").disabled = $("deny").disabled = true;
  const fn = approve ? "approveAuthorization" : "denyAuthorization";
  const { data, error } = await supabase.auth.oauth[fn](authorizationId, { skipBrowserRedirect: true });
  if (error) {
    $("approve").disabled = $("deny").disabled = false;
    return show("consent", error.message, true);
  }
  show(null, approve ? "Approved. Returning to the app…" : "Denied. Returning to the app…");
  location.assign(data.redirect_url);
}

$("login").addEventListener("submit", async (e) => {
  e.preventDefault();
  show("login", "Signing in…");
  const { error } = await supabase.auth.signInWithPassword({
    email: $("email").value.trim(),
    password: $("password").value,
  });
  $("password").value = "";
  if (error) return show("login", error.message, true);
  await loadRequest();
});
$("approve").addEventListener("click", () => decide(true));
$("deny").addEventListener("click", () => decide(false));
$("signout").addEventListener("click", async (e) => {
  e.preventDefault();
  await supabase.auth.signOut();
  show("login");
});

if (!authorizationId) {
  show(null, "Open this page from the app you are connecting (it adds an authorization_id to the link).", true);
} else {
  loadRequest().catch((err) => show(null, `Something went wrong: ${err.message}`, true));
}
