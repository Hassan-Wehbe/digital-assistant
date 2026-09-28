// Static checks on the vault pages (docs/vault/) and the sign-in page
// (docs/oauth/): the hardening the plan asks for stays in place as the pages change.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { crypto } from "jsr:@std/crypto@1";
import { encodeBase64 } from "jsr:@std/encoding@1/base64";
import { dirname, fromFileUrl, join, resolve } from "jsr:@std/path@1";

const DOCS = resolve(dirname(fromFileUrl(import.meta.url)), "../../docs");
const DIR = join(DOCS, "vault");
const PAGES = ["vault/setup.html", "vault/enter.html", "vault/reveal.html", "vault/recover.html",
               "vault/index.html", "oauth/consent.html"];
const SCRIPTS = ["vault/app.js", "vault/crypto.js", "vault/setup.js", "vault/enter.js", "vault/reveal.js",
                 "vault/recover.js", "oauth/consent.js"];

async function sha384(path: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-384", await Deno.readFile(path));
  return "sha384-" + encodeBase64(new Uint8Array(digest));
}

function csp(html: string): string {
  return html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1] ?? "";
}

for (const page of PAGES) {
  Deno.test(`${page}: strict CSP, local scripts only, integrity hashes current`, async () => {
    const html = await Deno.readTextFile(join(DOCS, page));
    const base = dirname(join(DOCS, page));
    const policy = csp(html);
    assert(policy.includes("default-src 'none'"), "default-src 'none'");
    assert(!policy.includes("unsafe-inline") && !/unsafe-eval(?!\S)/.test(policy.replace("'wasm-unsafe-eval'", "")),
      "no unsafe-inline / unsafe-eval");
    assert(policy.includes("base-uri 'none'") && policy.includes("form-action 'none'"));
    const scriptSrc = policy.match(/script-src ([^;]+)/)?.[1] ?? "";
    assert(["'self'", "'self' 'wasm-unsafe-eval'", ""].includes(scriptSrc.trim()), `script-src: ${scriptSrc}`);
    const connect = policy.match(/connect-src ([^;]+)/)?.[1]?.trim();
    assert(connect === undefined || connect === "https://motvckmpusxiuelpwqxy.supabase.co", `connect-src: ${connect}`);
    assert(html.includes('<meta name="referrer" content="no-referrer">'));

    // No inline script bodies and no remote resources.
    for (const m of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
      assert(/\ssrc="/.test(m[1]), "inline <script> is not allowed");
      assertEquals(m[2].trim(), "");
    }
    assert(!/(src|href)="(https?:)?\/\//.test(html), "no remote src/href");
    assert(!/\sstyle="/.test(html), "no inline style attributes");

    // Every script, module and stylesheet is pinned with a current hash.
    const refs = [...html.matchAll(/<(script|link)\b([^>]*)>/g)].map((m) => m[2]);
    for (const attrs of refs) {
      const ref = attrs.match(/(?:src|href)="([^"]+)"/)?.[1];
      if (!ref) continue;
      const integrity = attrs.match(/integrity="([^"]+)"/)?.[1];
      assertEquals(integrity, await sha384(resolve(base, ref)), `integrity of ${ref} (run node scripts/vault-sri.mjs)`);
    }
  });
}

Deno.test("each page preloads (with integrity) every module its script imports", async () => {
  const importsOf = async (file: string): Promise<string[]> => {
    const src = await Deno.readTextFile(file);
    const specs = [...src.matchAll(/(?:^|\n)\s*import[^"']*["']([^"']+)["']|from"(\.[^"]+)"/g)]
      .map((m) => m[1] ?? m[2]);
    const out: string[] = [];
    for (const s of specs) {
      const abs = resolve(dirname(file), s);
      out.push(abs, ...(await importsOf(abs)));
    }
    return out;
  };
  for (const page of PAGES.filter((p) => p !== "vault/index.html")) {
    const html = await Deno.readTextFile(join(DOCS, page));
    const base = dirname(join(DOCS, page));
    const entry = html.match(/<script type="module" src="([^"]+)"/)![1];
    const preloaded = new Set([...html.matchAll(/rel="modulepreload" href="([^"]+)"/g)].map((m) => resolve(base, m[1])));
    for (const dep of new Set(await importsOf(resolve(base, entry)))) {
      assert(preloaded.has(dep), `${page}: ${dep} is imported but not preloaded with integrity`);
    }
  }
});

Deno.test("page scripts never use innerHTML, eval, or browser storage", async () => {
  for (const f of SCRIPTS) {
    const src = await Deno.readTextFile(join(DOCS, f));
    for (const banned of ["innerHTML", "outerHTML", "insertAdjacentHTML", "document.write", "eval(",
                          "new Function", "localStorage", "sessionStorage", "indexedDB", "console.log"]) {
      assert(!src.includes(banned), `${f} uses ${banned}`);
    }
  }
});

Deno.test("vendored library files match the versions recorded in vendor/README.md", async () => {
  const readme = await Deno.readTextFile(join(DIR, "vendor/README.md"));
  assert(readme.includes("| 0.8.4 |") && readme.includes("| 2.117.2 |"));
  const wrappers = await Deno.readTextFile(join(DIR, "vendor/libsodium-wrappers.mjs"));
  assert(wrappers.includes('from"./libsodium-sumo.mjs"'), "import rewritten to the local file");
  const sumo = await Deno.readFile(join(DIR, "vendor/libsodium-sumo.mjs"));
  const hex = [...new Uint8Array(await crypto.subtle.digest("SHA-256", sumo))]
    .map((b) => b.toString(16).padStart(2, "0")).join("");
  assert(readme.includes(hex), "libsodium-sumo.mjs is byte-identical to the npm release");
  const supa = await Deno.readFile(join(DIR, "vendor/supabase.js"));
  const hex2 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", supa))]
    .map((b) => b.toString(16).padStart(2, "0")).join("");
  assert(readme.includes(hex2), "supabase.js is byte-identical to the npm release");
});
