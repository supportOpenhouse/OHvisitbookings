import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDeps } from '../lib/deps.js';
import { loadConfig } from '../lib/config.js';

const env = {
  APP_SECRET: 's', KALEYRA_API_KEY: 'k', KALEYRA_ACCOUNT_ID: 'HXIN1', KALEYRA_OTP_TEMPLATE_ID: 't1', KALEYRA_SMS_SENDER: 'OHAVAN',
  RAZORPAY_KEY_ID: 'rk', RAZORPAY_KEY_SECRET: 'rs', INTERAKT_API_KEY: 'ik', INTERAKT_TEMPLATE_NAME: 'tpl', INTERAKT_BODY_FIELDS: 'first_name,city',
};

test('buildDeps wires the gateways to the configured credentials', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200, json: async () => ({ id: 'x', amount: 1, currency: 'INR' }) }; };
  const deps = buildDeps(loadConfig(env), { repo: { fake: true }, fetchImpl });
  assert.deepEqual(deps.repo, { fake: true });
  assert.equal(typeof deps.now(), 'number');

  await deps.sms.sendOtp({ phone10: '9876543210', body: 'b' });
  assert.equal(calls[0].url, 'https://api.in.kaleyra.io/v1/HXIN1/messages');
  assert.equal(calls[0].init.headers['api-key'], 'k');

  await deps.rzp.createOrder({ amountPaise: 1, receipt: 'r', notes: {} });
  assert.equal(calls[1].url, 'https://api.razorpay.com/v1/orders');
  assert.equal(calls[1].init.headers.Authorization, 'Basic ' + Buffer.from('rk:rs').toString('base64'));

  await deps.wa.sendTemplate({ id: 'b', name: 'Asha V', phone: '9876543210', city: 'noida' }, deps.config.interakt);
  assert.equal(calls[2].url, 'https://api.interakt.ai/v1/public/message/');
  assert.equal(calls[2].init.headers.Authorization, 'Basic ik');
  assert.deepEqual(JSON.parse(calls[2].init.body).template.bodyValues, ['Asha', 'Noida & Greater Noida']);
});
