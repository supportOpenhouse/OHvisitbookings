import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { otpSend, otpVerify, paymentsVerify, paymentsWebhook, bookingsMe } from '../lib/handlers.js';
import { createSessionToken, verifySessionToken } from '../lib/session.js';
import { otpMatches } from '../lib/otp.js';
import { fakeDeps, goodForm, seededOtpRow } from './helpers.js';

const meta = { ip: '1.2.3.4', userAgent: 'ua', referrer: 'https://fb.com', pageUrl: 'https://bookvisit.openhouse.in/?utm_source=meta' };

/* ---------------- otpSend ---------------- */
test('otpSend rejects an invalid form with field errors', async () => {
  const deps = fakeDeps();
  const r = await otpSend({ body: { ...goodForm(), phone: '123' }, ...meta }, deps);
  assert.equal(r.status, 400);
  assert.equal(r.body.ok, false);
  assert.equal(r.body.errors.phone, 'Enter a valid 10-digit mobile number.');
  assert.equal(deps.sent.sms.length, 0);
});

test('otpSend stores a hashed OTP, sends the DLT-formatted SMS and returns the booking id', async () => {
  const deps = fakeDeps();
  const r = await otpSend({ body: goodForm(), ...meta }, deps);
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.booking_id, 'bk_1');
  assert.equal(r.body.phone_masked, '•••••• 3210');
  assert.equal(r.body.dev_otp, undefined);

  const row = deps.repo.rows.get('bk_1');
  assert.equal(row.status, 'otp_sent');
  assert.equal(row.phone, '9876543210');
  assert.equal(row.otp_expires_at, deps.now() + deps.config.otpTtlMs);
  assert.equal(row.ip, '1.2.3.4');
  assert.equal(row.user_agent, 'ua');
  assert.equal(row.referrer, 'https://fb.com');
  assert.equal(row.page_url, meta.pageUrl);
  assert.deepEqual(row.utm, { utm_source: 'meta' });
  assert.equal(row.otp_sms_id, 'sms_1');
  assert.ok(!('otp' in row), 'plaintext otp must never be stored');

  assert.equal(deps.sent.sms.length, 1);
  const { phone10, body } = deps.sent.sms[0];
  assert.equal(phone10, '9876543210');
  const otp = body.match(/is (\d{6})\./)[1];
  assert.equal(body, `Your OTP for login is ${otp}. Avano Technologies Pvt Ltd.`);
  assert.equal(otpMatches(otp, row.otp_hash, row.otp_salt, deps.config.appSecret), true);
});

test('otpSend rate-limits repeated sends for the same phone', async () => {
  const deps = fakeDeps();
  for (let i = 0; i < 5; i++) await otpSend({ body: goodForm(), ...meta }, deps);
  const r = await otpSend({ body: goodForm(), ...meta }, deps);
  assert.equal(r.status, 429);
  assert.match(r.body.error, /Too many/);
  assert.equal(deps.sent.sms.length, 5);
});

test('otpSend returns 502 when the SMS gateway fails', async () => {
  const deps = fakeDeps({ sms: { async sendOtp() { throw new Error('Kaleyra SMS failed (400): Invalid template'); } } });
  const r = await otpSend({ body: goodForm(), ...meta }, deps);
  assert.equal(r.status, 502);
  assert.match(r.body.error, /could not send/i);
});

test('otpSend in dev mode (non-production only) skips the SMS and returns the OTP', async () => {
  const deps = fakeDeps({ config: { ...fakeDeps().config, otpDevMode: true, isProduction: false } });
  const r = await otpSend({ body: goodForm(), ...meta }, deps);
  assert.equal(r.status, 200);
  assert.match(r.body.dev_otp, /^\d{6}$/);
  assert.equal(deps.sent.sms.length, 0);

  const prod = fakeDeps({ config: { ...fakeDeps().config, otpDevMode: true, isProduction: true } });
  const r2 = await otpSend({ body: goodForm(), ...meta }, prod);
  assert.equal(r2.body.dev_otp, undefined);
  assert.equal(prod.sent.sms.length, 1);
});

/* ---------------- otpVerify ---------------- */
test('otpVerify returns 404 for an unknown booking and 400 for a malformed otp', async () => {
  const deps = fakeDeps();
  assert.equal((await otpVerify({ body: { booking_id: 'nope', otp: '123456' } }, deps)).status, 404);
  seededOtpRow(deps);
  assert.equal((await otpVerify({ body: { booking_id: 'bk_seed', otp: '12' } }, deps)).status, 400);
});

test('otpVerify rejects an expired OTP', async () => {
  const deps = fakeDeps();
  seededOtpRow(deps, { otp_expires_at: deps.now() - 1 });
  const r = await otpVerify({ body: { booking_id: 'bk_seed', otp: '123456' } }, deps);
  assert.equal(r.status, 410);
  assert.match(r.body.error, /expired/i);
});

test('otpVerify counts attempts and locks after the limit', async () => {
  const deps = fakeDeps();
  seededOtpRow(deps);
  for (let i = 0; i < 4; i++) {
    const r = await otpVerify({ body: { booking_id: 'bk_seed', otp: '000000' } }, deps);
    assert.equal(r.status, 401);
    assert.equal(r.body.attempts_left, 4 - i);
  }
  const fifth = await otpVerify({ body: { booking_id: 'bk_seed', otp: '000000' } }, deps);
  assert.equal(fifth.status, 429);
  const locked = await otpVerify({ body: { booking_id: 'bk_seed', otp: '123456' } }, deps);
  assert.equal(locked.status, 429, 'even the right otp is refused once locked');
});

test('otpVerify with the right OTP verifies the phone, creates the Razorpay order and sets a session cookie', async () => {
  const deps = fakeDeps();
  seededOtpRow(deps);
  const r = await otpVerify({ body: { booking_id: 'bk_seed', otp: '123456' }, secure: true }, deps);
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.order_id, 'order_1');
  assert.equal(r.body.key_id, 'rzp_test_key');
  assert.equal(r.body.amount, 99000);
  assert.equal(r.body.currency, 'INR');
  assert.deepEqual(r.body.prefill, { name: 'Asha Verma', contact: '+919876543210', email: 'asha@example.com' });

  const row = deps.repo.rows.get('bk_seed');
  assert.equal(row.status, 'order_created');
  assert.equal(row.phone_verified_at, deps.now());
  assert.equal(row.razorpay_order_id, 'order_1');

  assert.equal(deps.sent.orders.length, 1);
  assert.equal(deps.sent.orders[0].amountPaise, 99000);
  assert.equal(deps.sent.orders[0].receipt, 'vb_bk_seed');
  assert.deepEqual(deps.sent.orders[0].notes, { booking_id: 'bk_seed', phone: '9876543210', source: 'bookvisit-990' });

  assert.match(r.setCookie, /^ohvb_session=.+; Path=\/; Max-Age=86400; HttpOnly; Secure; SameSite=Lax$/);
  const token = r.setCookie.match(/^ohvb_session=([^;]+)/)[1];
  const sess = verifySessionToken(token, deps.config.appSecret, { now: deps.now() });
  assert.equal(sess.bookingId, 'bk_seed');
  assert.equal(sess.phone, '9876543210');
});

test('otpVerify reuses an existing order when retried after verification', async () => {
  const deps = fakeDeps();
  seededOtpRow(deps, { status: 'order_created', phone_verified_at: 1, razorpay_order_id: 'order_prev' });
  const r = await otpVerify({ body: { booking_id: 'bk_seed', otp: '123456' } }, deps);
  assert.equal(r.status, 200);
  assert.equal(r.body.order_id, 'order_prev');
  assert.equal(deps.sent.orders.length, 0);
});

test('otpVerify refuses a booking that is already paid and reports order failures', async () => {
  const deps = fakeDeps();
  seededOtpRow(deps, { status: 'paid' });
  assert.equal((await otpVerify({ body: { booking_id: 'bk_seed', otp: '123456' } }, deps)).status, 409);

  const failing = fakeDeps({ rzp: { async createOrder() { throw new Error('Razorpay order failed (401): Authentication failed'); } } });
  seededOtpRow(failing);
  const r = await otpVerify({ body: { booking_id: 'bk_seed', otp: '123456' } }, failing);
  assert.equal(r.status, 502);
  assert.match(r.body.error, /payment/i);
});

/* ---------------- paymentsVerify ---------------- */
function paidSetup(deps, extra = {}) {
  seededOtpRow(deps, { status: 'order_created', phone_verified_at: 1, razorpay_order_id: 'order_1', ...extra });
  const cookie = createSessionToken({ bookingId: 'bk_seed', phone: '9876543210' }, deps.config.appSecret, { now: deps.now() });
  const signature = createHmac('sha256', deps.config.razorpayKeySecret).update('order_1|pay_1').digest('hex');
  return { cookies: { ohvb_session: cookie }, body: { order_id: 'order_1', payment_id: 'pay_1', signature } };
}

test('paymentsVerify requires a valid session cookie', async () => {
  const deps = fakeDeps();
  const { body } = paidSetup(deps);
  assert.equal((await paymentsVerify({ body, cookies: {} }, deps)).status, 401);
  assert.equal((await paymentsVerify({ body, cookies: { ohvb_session: 'bad.token' } }, deps)).status, 401);
});

test('paymentsVerify rejects a mismatched order or a bad signature', async () => {
  const deps = fakeDeps();
  const { body, cookies } = paidSetup(deps);
  assert.equal((await paymentsVerify({ body: { ...body, order_id: 'order_x' }, cookies }, deps)).status, 400);
  const bad = await paymentsVerify({ body: { ...body, signature: 'deadbeef' }, cookies }, deps);
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /signature/i);
  assert.equal(deps.repo.rows.get('bk_seed').status, 'order_created');
});

test('paymentsVerify marks the booking paid, fires the Interakt template once and redirects to thank-you', async () => {
  const deps = fakeDeps();
  const { body, cookies } = paidSetup(deps);
  const r = await paymentsVerify({ body, cookies }, deps);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, redirect: '/thank-you' });
  const row = deps.repo.rows.get('bk_seed');
  assert.equal(row.status, 'paid');
  assert.equal(row.razorpay_payment_id, 'pay_1');
  assert.equal(row.paid_via, 'client');
  assert.equal(row.paid_at, deps.now());
  assert.equal(deps.sent.wa.length, 1);
  assert.equal(deps.sent.wa[0].booking.id, 'bk_seed');
  assert.equal(deps.sent.wa[0].cfg.templateName, 'visit_booked');
  assert.equal(row.interakt_message_id, 'wa_1');

  const again = await paymentsVerify({ body, cookies }, deps);
  assert.equal(again.status, 200, 'idempotent on retry');
  assert.equal(deps.sent.wa.length, 1, 'template is not sent twice');
});

test('paymentsVerify still succeeds when Interakt fails, recording the error', async () => {
  const deps = fakeDeps({ wa: { async sendTemplate() { throw new Error('Interakt send failed (400): Template not found'); } } });
  const { body, cookies } = paidSetup(deps);
  const r = await paymentsVerify({ body, cookies }, deps);
  assert.equal(r.status, 200);
  const row = deps.repo.rows.get('bk_seed');
  assert.equal(row.status, 'paid');
  assert.match(row.interakt_error, /Template not found/);
});

/* ---------------- paymentsWebhook ---------------- */
function webhookBody(orderId, paymentId = 'pay_wh', event = 'payment.captured') {
  return JSON.stringify({ event, payload: { payment: { entity: { id: paymentId, order_id: orderId, status: 'captured' } } } });
}
const sig = (raw, secret) => createHmac('sha256', secret).update(raw).digest('hex');

test('paymentsWebhook rejects a bad signature', async () => {
  const deps = fakeDeps();
  const raw = webhookBody('order_1');
  assert.equal((await paymentsWebhook({ rawBody: raw, signature: 'nope' }, deps)).status, 400);
  assert.equal((await paymentsWebhook({ rawBody: raw, signature: sig(raw, 'wrong') }, deps)).status, 400);
});

test('paymentsWebhook marks a captured payment paid and fires Interakt when the client never verified', async () => {
  const deps = fakeDeps();
  seededOtpRow(deps, { status: 'order_created', razorpay_order_id: 'order_1' });
  const raw = webhookBody('order_1');
  const r = await paymentsWebhook({ rawBody: raw, signature: sig(raw, deps.config.razorpayWebhookSecret) }, deps);
  assert.equal(r.status, 200);
  const row = deps.repo.rows.get('bk_seed');
  assert.equal(row.status, 'paid');
  assert.equal(row.paid_via, 'webhook');
  assert.equal(row.razorpay_payment_id, 'pay_wh');
  assert.equal(deps.sent.wa.length, 1);
});

test('paymentsWebhook ignores other events and unknown orders, and never double-sends', async () => {
  const deps = fakeDeps();
  seededOtpRow(deps, { status: 'paid', razorpay_order_id: 'order_1', interakt_sent_at: 1 });
  const other = webhookBody('order_1', 'p', 'payment.authorized');
  assert.deepEqual((await paymentsWebhook({ rawBody: other, signature: sig(other, 'wh_secret') }, deps)).body, { ok: true, ignored: true });
  const unknown = webhookBody('order_zzz');
  assert.equal((await paymentsWebhook({ rawBody: unknown, signature: sig(unknown, 'wh_secret') }, deps)).status, 200);
  const dup = webhookBody('order_1');
  assert.equal((await paymentsWebhook({ rawBody: dup, signature: sig(dup, 'wh_secret') }, deps)).status, 200);
  assert.equal(deps.sent.wa.length, 0);
});

/* ---------------- bookingsMe ---------------- */
test('bookingsMe requires a session and returns only safe, labelled fields', async () => {
  const deps = fakeDeps();
  seededOtpRow(deps, { status: 'paid', paid_at: 5, razorpay_payment_id: 'pay_1', otp_hash: 'secret-hash' });
  assert.equal((await bookingsMe({ cookies: {} }, deps)).status, 401);
  const cookie = createSessionToken({ bookingId: 'bk_seed', phone: '9876543210' }, deps.config.appSecret, { now: deps.now() });
  const r = await bookingsMe({ cookies: { ohvb_session: cookie } }, deps);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, {
    ok: true,
    booking: {
      id: 'bk_seed', ref: 'BK_SEED', name: 'Asha Verma', first_name: 'Asha', phone_masked: '•••••• 3210', email: 'asha@example.com',
      city: 'Gurgaon', configuration: '3 BHK', budget: '₹1 Cr – ₹1.5 Cr', areas: 'Sohna Road (Sec 49–57)', visit_when: 'This Saturday',
      status: 'paid', paid_at: 5, amount: '₹990', payment_id: 'pay_1',
    },
  });
  assert.equal(JSON.stringify(r.body).includes('secret-hash'), false);
});
