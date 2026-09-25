// Local stand-in for Vercel: serves the static pages with clean URLs and runs api/*.js
// (Web-signature handlers) on http://localhost:3000. Run: npm run dev
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 3000);
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2' };

async function serveStatic(req, res, pathname) {
  let file = pathname === '/' ? '/index.html' : pathname;
  let full = path.join(ROOT, file);
  try {
    const s = await stat(full);
    if (s.isDirectory()) full = path.join(full, 'index.html');
  } catch {
    full = path.join(ROOT, file + '.html'); // clean URLs: /thank-you -> thank-you.html
  }
  if (!full.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  try {
    const data = await readFile(full);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found');
  }
}

async function serveApi(req, res, url) {
  const modPath = path.join(ROOT, 'api', url.pathname.replace(/^\/api\//, '') + '.js');
  if (!modPath.startsWith(path.join(ROOT, 'api'))) { res.writeHead(403); return res.end(); }
  let mod;
  try { mod = await import(pathToFileURL(modPath).href + '?t=' + Date.now()); } catch (e) {
    res.writeHead(404, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ ok: false, error: 'No such route', detail: e.message }));
  }
  const fn = mod[req.method];
  if (!fn) { res.writeHead(405); return res.end(); }
  const chunks = []; for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const request = new Request(`http://localhost:${PORT}${url.pathname}${url.search}`, {
    method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body,
  });
  const response = await fn(request);
  const headers = {};
  response.headers.forEach((v, k) => { headers[k] = v; });
  res.writeHead(response.status, headers);
  res.end(Buffer.from(await response.arrayBuffer()));
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    if (url.pathname.startsWith('/api/')) await serveApi(req, res, url);
    else await serveStatic(req, res, url.pathname);
  } catch (e) {
    console.error(e); res.writeHead(500); res.end('Server error');
  }
}).listen(PORT, () => console.log(`bookvisit dev server → http://localhost:${PORT}  (OTP_DEV_MODE=${process.env.OTP_DEV_MODE || 'off'})`));
