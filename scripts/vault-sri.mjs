// Rewrite the Subresource Integrity hashes in docs/vault/*.html.
// Run after changing any vault page script, the stylesheet or a vendored file:
//   node scripts/vault-sri.mjs          (rewrite)
//   node scripts/vault-sri.mjs --check  (exit 1 if any hash is stale)
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../docs/vault");
const check = process.argv.includes("--check");
const TAG = /((?:src|href)="([^"]+)"[^>]*?\sintegrity=")([^"]*)(")/g;
let stale = 0;

for (const name of readdirSync(dir).filter((f) => f.endsWith(".html"))) {
  const path = join(dir, name);
  const html = readFileSync(path, "utf8");
  const out = html.replace(TAG, (_m, pre, ref, old, post) => {
    const hash = "sha384-" + createHash("sha384").update(readFileSync(resolve(dir, ref))).digest("base64");
    if (hash !== old) {
      stale++;
      if (check) console.error(`${name}: stale integrity for ${ref}`);
    }
    return pre + hash + post;
  });
  if (!check && out !== html) {
    writeFileSync(path, out);
    console.log(`updated ${name}`);
  }
}
if (check && stale) process.exit(1);
if (check) console.log("all integrity hashes are current");
