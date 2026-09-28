# Vendored libraries for the vault pages

Served from this repo (GitHub Pages, same origin as the pages) instead of a CDN,
so the vault pages load no third-party code at run time. Each page also pins
these files with Subresource Integrity hashes (`integrity=` attributes, checked
by `tests/deno/vault_pages_test.ts`).

| File | Package | Version | Source path in the npm package |
|---|---|---|---|
| `libsodium-sumo.mjs` | `libsodium-sumo` | 0.8.4 | `dist/modules-sumo-esm/libsodium-sumo.mjs` (unchanged) |
| `libsodium-wrappers.mjs` | `libsodium-wrappers-sumo` | 0.8.4 | `dist/modules-sumo-esm/libsodium-wrappers.mjs`, one change: `from"libsodium-sumo"` → `from"./libsodium-sumo.mjs"` |
| `supabase.js` | `@supabase/supabase-js` | 2.117.2 | `dist/umd/supabase.js` (unchanged) |

SHA-256 of the files as published on npm (before the one-line import change):

```
4c94708f7e78eac7a32b29e2ce0ff96f4bd599d78c129f27bf8a061e20776c8c  libsodium-sumo-0.8.4/package/dist/modules-sumo-esm/libsodium-sumo.mjs
40de1ef7cb8f2caae02c2a8f04809151904fa28cb9364cadedc57af89a6c9284  libsodium-wrappers-sumo-0.8.4/package/dist/modules-sumo-esm/libsodium-wrappers.mjs
59d39487c3589843b410322d8a3d562ce022aba1e5ccb16898ef3fb2a0da2ecd  supabase-supabase-js-2.117.2/package/dist/umd/supabase.js
```

To verify or update (from the repo root):

```bash
npm pack libsodium-sumo@0.8.4 libsodium-wrappers-sumo@0.8.4 @supabase/supabase-js@2.117.2
# unpack, compare / copy the paths above, re-apply the import change, then:
node scripts/vault-sri.mjs        # rewrite the integrity hashes in docs/vault/*.html
```

Licenses: `LICENSE.libsodium` (ISC), `LICENSE.supabase-js` (MIT).
