import { createHmac, timingSafeEqual } from 'node:crypto';

const DAY_MS = 24 * 60 * 60 * 1000;

const sign = (data, secret) => createHmac('sha256', String(secret)).update(data).digest('base64url');

export function createSessionToken(payload, secret, { now = Date.now(), ttlMs = DAY_MS } = {}) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: now + ttlMs }), 'utf8').toString('base64url');
  return `${body}.${sign(body, secret)}`;
}

export function verifySessionToken(token, secret, { now = Date.now() } = {}) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [body, sig] = parts;
  const expected = Buffer.from(sign(body, secret));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (typeof payload.exp !== 'number' || payload.exp <= now) return null;
    return payload;
  } catch {
    return null;
  }
}
