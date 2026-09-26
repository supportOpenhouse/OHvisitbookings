import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../lib/config.js';

const env = {
  APP_SECRET: 's', DATABASE_URL: 'postgresql://x', KALEYRA_API_KEY: 'k', KALEYRA_ACCOUNT_ID: 'sid', KALEYRA_OTP_TEMPLATE_ID: 't',
  KALEYRA_SMS_SENDER: 'OHAVAN', KALEYRA_OTP_BODY: 'Your OTP for login is {otp}. Avano Technologies Pvt Ltd.',
  RAZORPAY_KEY_ID: 'rk', RAZORPAY_KEY_SECRET: 'rs', RAZORPAY_WEBHOOK_SECRET: 'ws',
  INTERAKT_API_KEY: 'ik', INTERAKT_TEMPLATE_NAME: 'tpl',
};

test('loadConfig applies defaults', () => {
  const c = loadConfig(env);
  assert.equal(c.amountPaise, 99000);
  assert.equal(c.otpTtlMs, 10 * 60 * 1000);
  assert.equal(c.otpMaxAttempts, 5);
  assert.equal(c.otpMaxSendsPerHour, 5);
  assert.equal(c.kaleyra.baseUrl, 'https://api.in.kaleyra.io');
  assert.deepEqual(c.interakt, { templateName: 'tpl', languageCode: 'en', bodyFields: ['name'] });
  assert.equal(c.otpDevMode, false);
  assert.equal(c.isProduction, false);
  assert.equal(c.exportApiKey, '');
});

test('loadConfig parses overrides and treats Vercel production as production', () => {
  const c = loadConfig({ ...env, VERCEL_ENV: 'production', BOOKING_AMOUNT_PAISE: '50000', INTERAKT_BODY_FIELDS: ' first_name, city ,amount ', INTERAKT_TEMPLATE_LANG: 'hi', OTP_DEV_MODE: '1' });
  assert.equal(c.isProduction, true);
  assert.equal(c.amountPaise, 50000);
  assert.deepEqual(c.interakt.bodyFields, ['first_name', 'city', 'amount']);
  assert.equal(c.interakt.languageCode, 'hi');
  assert.equal(c.otpDevMode, true, 'flag is read; handlers gate it by isProduction');
});

test('loadConfig reads EXPORT_API_KEY', () => {
  assert.equal(loadConfig({ ...env, EXPORT_API_KEY: 'k1' }).exportApiKey, 'k1');
});

test('loadConfig throws when APP_SECRET is missing', () => {
  assert.throws(() => loadConfig({ ...env, APP_SECRET: '' }), /APP_SECRET/);
});
