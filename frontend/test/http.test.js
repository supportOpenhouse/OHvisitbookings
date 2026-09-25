import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { parseCookies, serializeCookie, readJsonBody, readRawBody, clientIp } from '../lib/http.js';

test('parseCookies splits a Cookie header', () => {
  assert.deepEqual(parseCookies('a=1; ohvb_session=abc.def; c=%20x'), { a: '1', ohvb_session: 'abc.def', c: ' x' });
  assert.deepEqual(parseCookies(undefined), {});
});

test('serializeCookie builds a secure httpOnly cookie', () => {
  const c = serializeCookie('ohvb_session', 'tok', { maxAge: 60, secure: true });
  assert.equal(c, 'ohvb_session=tok; Path=/; Max-Age=60; HttpOnly; Secure; SameSite=Lax');
  assert.equal(serializeCookie('x', '', { maxAge: 0 }), 'x=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax');
});

test('readJsonBody parses a JSON stream and rejects oversized or invalid bodies', async () => {
  const req = Readable.from([Buffer.from('{"a":1}')]);
  assert.deepEqual(await readJsonBody(req), { a: 1 });
  await assert.rejects(readJsonBody(Readable.from([Buffer.from('nope')])), /Invalid JSON/);
  await assert.rejects(readJsonBody(Readable.from([Buffer.alloc(70000, 'x')]), 65536), /too large/);
});

test('readJsonBody uses a pre-parsed body when the platform already parsed it', async () => {
  const req = Readable.from([]); req.body = { pre: true };
  assert.deepEqual(await readJsonBody(req), { pre: true });
});

test('readRawBody returns the exact bytes as a string', async () => {
  assert.equal(await readRawBody(Readable.from([Buffer.from('ab'), Buffer.from('c')])), 'abc');
});

test('clientIp prefers the first x-forwarded-for entry', () => {
  assert.equal(clientIp({ headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' }, socket: { remoteAddress: '9.9.9.9' } }), '1.2.3.4');
  assert.equal(clientIp({ headers: {}, socket: { remoteAddress: '9.9.9.9' } }), '9.9.9.9');
});
