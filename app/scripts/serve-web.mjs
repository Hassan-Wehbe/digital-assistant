// Serves the exported web build (`npx expo export --platform web`, in dist/) on this computer, for
// trying the app in a browser: `npm run web:preview`, then open http://localhost:8080.
//
// Two things a plain file server does not do:
// - The cross-origin isolation headers, which the web version of the app's local database
//   (expo-sqlite) needs to run.
// - Screen addresses: /chat is chat.html, and /vault/<id> is the vault/[id].html page.
// Only this computer can reach it (localhost).
import { createServer } from 'node:http';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';

const root = normalize(process.argv[2] ?? 'dist');
const port = Number(process.env.PORT ?? 8080);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
};

const isFile = (p) => existsSync(p) && statSync(p).isFile();

/** The file for a URL path: the file itself, its .html page, or a [placeholder].html page. */
function resolve(urlPath) {
  const parts = decodeURIComponent(urlPath).split('/').filter(Boolean);
  if (parts.some((p) => p === '..' || p.includes(sep))) return null;
  const direct = join(root, ...parts);
  if (isFile(direct)) return direct;
  if (isFile(`${direct}.html`)) return `${direct}.html`;
  if (isFile(join(direct, 'index.html'))) return join(direct, 'index.html');
  // Walk the folders, letting a [name] folder or [name].html page stand for any one part.
  let dir = root;
  for (const [i, part] of parts.entries()) {
    const last = i === parts.length - 1;
    if (!existsSync(dir) || !statSync(dir).isDirectory()) return null;
    const entries = readdirSync(dir);
    if (last) {
      if (entries.includes(`${part}.html`)) return join(dir, `${part}.html`);
      const page = entries.find((e) => /^\[[^\]]+\]\.html$/.test(e));
      return page ? join(dir, page) : null;
    }
    if (entries.includes(part)) dir = join(dir, part);
    else {
      const folder = entries.find((e) => /^\[[^\]]+\]$/.test(e));
      if (!folder) return null;
      dir = join(dir, folder);
    }
  }
  return null;
}

createServer((req, res) => {
  const path = new URL(req.url ?? '/', 'http://localhost').pathname;
  const found = resolve(path);
  const file = found ?? join(root, '+not-found.html');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  if (!isFile(file)) {
    res.writeHead(404).end('Not found');
    return;
  }
  res.writeHead(found ? 200 : 404, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
}).listen(port, '127.0.0.1', () => {
  console.log(`Wilma (web preview) at http://localhost:${port}  (Ctrl+C to stop)`);
});
