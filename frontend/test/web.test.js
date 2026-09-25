import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toResponse, requestMeta, methodNotAllowed } from '../lib/web.js';

test('toResponse serialises a handler result as JSON with no-store and an optional cookie', async () => {
  const res = toResponse({ status: 201, body: { ok: true }, setCookie: 'ohvb_session=t; Path=/; HttpOnly' });
  assert.equal(res.status, 201);
  assert.equal(res.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('set-cookie'), 'ohvb_session=t; Path=/; HttpOnly');
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(toResponse({ status: 200, body: {} }).headers.get('set-cookie'), null);
});

test('requestMeta extracts ip, user agent, referrer, cookies, page url and https-ness', () => {
  const req = new Request('https://bookvisit.openhouse.in/api/otp/send', {
    method: 'POST',
    headers: {
      'x-forwarded-for': '1.2.3.4, 10.0.0.1', 'user-agent': 'UA/1', referer: 'https://fb.com/ad',
      cookie: 'ohvb_session=abc.def; other=1', 'x-forwarded-proto': 'https',
    },
  });
  const m = requestMeta(req);
  assert.equal(m.ip, '1.2.3.4');
  assert.equal(m.userAgent, 'UA/1');
  assert.equal(m.referrer, 'https://fb.com/ad');
  assert.deepEqual(m.cookies, { ohvb_session: 'abc.def', other: '1' });
  assert.equal(m.secure, true);
  assert.equal(requestMeta(new Request('http://localhost:3000/api/x')).secure, false);
});

test('methodNotAllowed returns 405 with an Allow header', async () => {
  const res = methodNotAllowed('POST');
  assert.equal(res.status, 405);
  assert.equal(res.headers.get('allow'), 'POST');
});
