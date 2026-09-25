export function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of String(header).split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k) continue;
    try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch { out[k] = part.slice(i + 1).trim(); }
  }
  return out;
}

export function serializeCookie(name, value, { maxAge, secure = false, path = '/', sameSite = 'Lax' } = {}) {
  let c = `${name}=${value}; Path=${path}`;
  if (maxAge !== undefined) c += `; Max-Age=${maxAge}`;
  c += '; HttpOnly';
  if (secure) c += '; Secure';
  c += `; SameSite=${sameSite}`;
  return c;
}

export async function readRawBody(req, limit = 65536) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('Request body too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function readJsonBody(req, limit = 65536) {
  if (req.body !== undefined && req.body !== null && typeof req.body === 'object') return req.body;
  const raw = typeof req.body === 'string' ? req.body : await readRawBody(req, limit);
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw new Error('Invalid JSON body'); }
}

export function clientIp(req) {
  const fwd = req.headers?.['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return req.socket?.remoteAddress || '';
}

export function json(res, status, body, extraHeaders = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  for (const [k, v] of Object.entries(extraHeaders)) res.setHeader(k, v);
  res.end(JSON.stringify(body));
}
