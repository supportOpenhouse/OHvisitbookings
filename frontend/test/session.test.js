import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSessionToken, verifySessionToken } from '../lib/session.js';

const secret = 'test-secret';

test('session token round-trips its payload', () => {
  const tok = createSessionToken({ bookingId: 'b1', phone: '9876543210' }, secret, { now: 1000 });
  const p = verifySessionToken(tok, secret, { now: 2000 });
  assert.equal(p.bookingId, 'b1');
  assert.equal(p.phone, '9876543210');
});

test('session token expires after ttl', () => {
  const tok = createSessionToken({ bookingId: 'b1' }, secret, { now: 1000, ttlMs: 500 });
  assert.equal(verifySessionToken(tok, secret, { now: 1400 }).bookingId, 'b1');
  assert.equal(verifySessionToken(tok, secret, { now: 1600 }), null);
});

test('tampered, wrong-secret and malformed tokens verify to null', () => {
  const tok = createSessionToken({ bookingId: 'b1' }, secret, { now: 1000 });
  const [payload, sig] = tok.split('.');
  assert.equal(verifySessionToken(payload + 'x.' + sig, secret, { now: 1000 }), null);
  assert.equal(verifySessionToken(tok, 'other', { now: 1000 }), null);
  assert.equal(verifySessionToken('garbage', secret, { now: 1000 }), null);
  assert.equal(verifySessionToken('', secret, { now: 1000 }), null);
  assert.equal(verifySessionToken(undefined, secret, { now: 1000 }), null);
});

test('token is URL-safe (no dots inside parts, no + or /)', () => {
  const tok = createSessionToken({ bookingId: 'b1', phone: '9999999999', extra: '~~~???' }, secret);
  assert.equal(tok.split('.').length, 2);
  assert.doesNotMatch(tok, /[+/=]/);
});
