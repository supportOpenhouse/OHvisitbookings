import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendOtpSms } from '../lib/kaleyra.js';

const cfg = { apiKey: 'A123', sid: 'HXIN1', sender: 'OHAVAN', templateId: '1107', fetchImpl: null };

test('sendOtpSms posts a form-encoded OTP message to the India endpoint', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return { ok: true, status: 202, json: async () => ({ id: 'sms_1' }) }; };
  const r = await sendOtpSms({ phone10: '9876543210', body: 'Your OTP for login is 123456. Avano Technologies Pvt Ltd.' }, { ...cfg, fetchImpl });
  assert.equal(r.id, 'sms_1');
  assert.equal(calls[0].url, 'https://api.in.kaleyra.io/v1/HXIN1/messages');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers['api-key'], 'A123');
  assert.equal(calls[0].init.headers['Content-Type'], 'application/x-www-form-urlencoded');
  const params = new URLSearchParams(calls[0].init.body);
  assert.equal(params.get('to'), '+919876543210');
  assert.equal(params.get('type'), 'OTP');
  assert.equal(params.get('sender'), 'OHAVAN');
  assert.equal(params.get('template_id'), '1107');
  assert.equal(params.get('body'), 'Your OTP for login is 123456. Avano Technologies Pvt Ltd.');
});

test('sendOtpSms honours a custom base URL', async () => {
  let seen;
  const fetchImpl = async (url) => { seen = url; return { ok: true, json: async () => ({ id: 'x' }) }; };
  await sendOtpSms({ phone10: '9876543210', body: 'b' }, { ...cfg, baseUrl: 'https://api.kaleyra.io', fetchImpl });
  assert.equal(seen, 'https://api.kaleyra.io/v1/HXIN1/messages');
});

test('sendOtpSms surfaces gateway errors and missing config', async () => {
  const fetchImpl = async () => ({ ok: false, status: 400, json: async () => ({ error: { message: 'Invalid template' } }) });
  await assert.rejects(sendOtpSms({ phone10: '9876543210', body: 'b' }, { ...cfg, fetchImpl }), /Invalid template/);
  await assert.rejects(sendOtpSms({ phone10: '9876543210', body: 'b' }, { ...cfg, apiKey: '', fetchImpl }), /KALEYRA_API_KEY/);
});
