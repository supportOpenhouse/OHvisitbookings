import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateOtp, hashOtp, otpMatches, renderOtpBody, newSalt } from '../lib/otp.js';

test('generateOtp returns a 6-digit string, zero padded', () => {
  for (let i = 0; i < 50; i++) assert.match(generateOtp(), /^\d{6}$/);
  assert.equal(generateOtp(() => 42), '000042');
});

test('hashOtp is deterministic for the same inputs and differs by salt or secret', () => {
  const a = hashOtp('123456', 'salt1', 'secret');
  assert.equal(a, hashOtp('123456', 'salt1', 'secret'));
  assert.notEqual(a, hashOtp('123456', 'salt2', 'secret'));
  assert.notEqual(a, hashOtp('123456', 'salt1', 'other'));
  assert.notEqual(a, hashOtp('123457', 'salt1', 'secret'));
  assert.match(a, /^[0-9a-f]{64}$/);
});

test('otpMatches compares safely and tolerates junk input', () => {
  const salt = newSalt();
  const hash = hashOtp('654321', salt, 's');
  assert.equal(otpMatches('654321', hash, salt, 's'), true);
  assert.equal(otpMatches('654322', hash, salt, 's'), false);
  assert.equal(otpMatches('', hash, salt, 's'), false);
  assert.equal(otpMatches(undefined, hash, salt, 's'), false);
  assert.equal(otpMatches('654321', null, salt, 's'), false);
});

test('newSalt is random hex', () => {
  assert.notEqual(newSalt(), newSalt());
  assert.match(newSalt(), /^[0-9a-f]{32}$/);
});

test('renderOtpBody substitutes {otp} exactly as the DLT template expects', () => {
  assert.equal(
    renderOtpBody('Your OTP for login is {otp}. Avano Technologies Pvt Ltd.', '482913'),
    'Your OTP for login is 482913. Avano Technologies Pvt Ltd.'
  );
});

test('renderOtpBody throws when the template has no {otp} placeholder', () => {
  assert.throws(() => renderOtpBody('Hello there', '123456'), /\{otp\}/);
});
