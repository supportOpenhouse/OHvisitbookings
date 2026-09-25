// Adapters between Web-standard Request/Response (Vercel Node functions) and the handler cores.
import { parseCookies } from './http.js';

export function toResponse({ status = 200, body = {}, setCookie }) {
  const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  if (setCookie) headers.set('Set-Cookie', setCookie);
  return new Response(JSON.stringify(body), { status, headers });
}

export function requestMeta(request) {
  const h = request.headers;
  const fwd = h.get('x-forwarded-for');
  const url = new URL(request.url);
  return {
    ip: fwd ? fwd.split(',')[0].trim() : '',
    userAgent: h.get('user-agent') || '',
    referrer: h.get('referer') || '',
    cookies: parseCookies(h.get('cookie')),
    secure: h.get('x-forwarded-proto') === 'https' || url.protocol === 'https:',
  };
}

export function methodNotAllowed(allow) {
  return new Response(JSON.stringify({ ok: false, error: 'Method not allowed' }), {
    status: 405, headers: { 'Content-Type': 'application/json; charset=utf-8', Allow: allow },
  });
}

export async function readJson(request) {
  try { return await request.json(); } catch { return null; }
}

// Wraps a route so unexpected errors become a clean 500 instead of a crash.
export function route(fn) {
  return async request => {
    try { return await fn(request); } catch (e) {
      console.error('[api]', request.method, new URL(request.url).pathname, e);
      return toResponse({ status: 500, body: { ok: false, error: 'Something went wrong on our side. Please try again.' } });
    }
  };
}
