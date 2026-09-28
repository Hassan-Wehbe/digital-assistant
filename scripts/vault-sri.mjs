// Rewrite the Subresource Integrity hashes in docs/vault/, docs/oauth/ and docs/files/ pages.
// Run after changing any page script, stylesheet or vendored file:
//   node scripts/vault-sri.mjs          (rewrite)
//   node scripts/vault-sri.mjs --check  (exit 1 if any hash is stale)
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const docs = resolve(dirname(fileURLToPath(import.meta.url)), "../docs");
const check = process.argv.includes("--check");
const TAG = /((?:src|href)="([^"]+)"[^>]*?\sintegrity=")([^"]*)(")/g;
let stale = 0;

for (const name of ["vault", "oauth", "files"].flatMap((d) =>
  readdirSync(join(docs, d)).filter((f) => f.endsWith(".html")).map((f) => join(d, f)))) {
  const path = join(docs, name);
  const dir = dirname(path);
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
