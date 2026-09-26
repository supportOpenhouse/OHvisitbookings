import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { otpSend, otpVerify, paymentsVerify, paymentsWebhook, bookingsMe, exportBookings } from '../lib/handlers.js';
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

/* ---------------- exportBookings (Google Sheets sync) ---------------- */
function exportRow(deps, id, extra = {}) {
  deps.repo.rows.set(id, {
    id, status: 'paid', is_test: false, name: 'Asha Verma', phone: '9876543210', email: 'asha@example.com', city: 'gurgaon', configuration: '3bhk',
    budget_min: 10000000, budget_max: 15000000, budget_label: '₹1 Cr – ₹1.5 Cr', areas: ['sohna-road'], areas_label: 'Sohna Road (Sec 49–57)', visit_when: 'this-sat',
    amount_paise: 99000, currency: 'INR', razorpay_order_id: 'order_1', razorpay_payment_id: 'pay_1', razorpay_signature: 'sig-secret', paid_via: 'client',
    otp_hash: 'hash-secret', otp_salt: 'salt-secret', otp_attempts: 1, otp_sms_id: 'sms_1', interakt_message_id: 'wa_1', interakt_error: null,
    source: 'bookvisit-990', utm: { utm_source: 'meta', utm_campaign: 'sept', fbclid: 'x' }, page_url: 'https://bookvisit.openhouse.in/', referrer: 'https://fb.com',
    user_agent: 'UA', ip: '1.2.3.4', notes: null, created_at: deps.now() - 3600_000, updated_at: deps.now() - 1800_000, paid_at: deps.now() - 1700_000, phone_verified_at: deps.now() - 1750_000,
    ...extra,
  });
}
const auth = 'Bearer export-key-123';

test('exportBookings requires the export API key', async () => {
  const deps = fakeDeps();
  exportRow(deps, 'a');
  assert.equal((await exportBookings({ query: {}, authorization: '' }, deps)).status, 401);
  assert.equal((await exportBookings({ query: {}, authorization: 'Bearer wrong' }, deps)).status, 401);
  assert.equal((await exportBookings({ query: {}, authorization: 'export-key-123' }, deps)).status, 401, 'must be a Bearer token');
  const none = fakeDeps({ config: { ...fakeDeps().config, exportApiKey: '' } });
  assert.equal((await exportBookings({ query: {}, authorization: 'Bearer ' }, none)).status, 401, 'unset key never matches');
});

test('exportBookings returns whitelisted, labelled columns and never secrets', async () => {
  const deps = fakeDeps();
  exportRow(deps, 'a');
  const r = await exportBookings({ query: {}, authorization: auth }, deps);
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.deepEqual(r.body.columns, ['id', 'created_at', 'updated_at', 'status', 'name', 'phone', 'email', 'city', 'configuration', 'budget', 'areas', 'visit_when',
    'amount_inr', 'paid_at', 'paid_via', 'razorpay_order_id', 'razorpay_payment_id', 'phone_verified_at', 'whatsapp_message_id', 'whatsapp_error',
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'source', 'page_url', 'referrer', 'is_test', 'notes']);
  const row = r.body.rows[0];
  assert.equal(row.id, 'a');
  assert.equal(row.city, 'Gurgaon');
  assert.equal(row.configuration, '3 BHK');
  assert.equal(row.visit_when, 'This Saturday');
  assert.equal(row.budget, '₹1 Cr – ₹1.5 Cr');
  assert.equal(row.amount_inr, 990);
  assert.equal(row.utm_source, 'meta');
  assert.equal(row.utm_campaign, 'sept');
  assert.equal(row.utm_medium, '');
  assert.equal(row.created_at, new Date(deps.now() - 3600_000).toISOString());
  assert.equal(row.paid_at, new Date(deps.now() - 1700_000).toISOString());
  assert.equal(row.whatsapp_message_id, 'wa_1');
  const json = JSON.stringify(r.body);
  for (const secret of ['hash-secret', 'salt-secret', 'sig-secret', 'fbclid', 'user_agent', '"ip"']) assert.equal(json.includes(secret), false, secret + ' must not be exported');
  assert.deepEqual(Object.keys(row), r.body.columns, 'row keys follow the column order');
});

test('exportBookings pages by updated_after, oldest change first, and returns a cursor', async () => {
  const deps = fakeDeps();
  exportRow(deps, 'a', { updated_at: 1000 });
  exportRow(deps, 'b', { updated_at: 3000 });
  exportRow(deps, 'c', { updated_at: 2000 });
  const all = await exportBookings({ query: {}, authorization: auth }, deps);
  assert.deepEqual(all.body.rows.map(x => x.id), ['a', 'c', 'b']);
  assert.equal(all.body.next_after, new Date(3000).toISOString());
  assert.equal(all.body.has_more, false);
  const since = await exportBookings({ query: { updated_after: new Date(1000).toISOString() }, authorization: auth }, deps);
  assert.deepEqual(since.body.rows.map(x => x.id), ['c', 'b']);
  const limited = await exportBookings({ query: { limit: '2' }, authorization: auth }, deps);
  assert.deepEqual(limited.body.rows.map(x => x.id), ['a', 'c']);
  assert.equal(limited.body.has_more, true);
  assert.equal(limited.body.next_after, new Date(2000).toISOString());
  const bad = await exportBookings({ query: { updated_after: 'not-a-date' }, authorization: auth }, deps);
  assert.equal(bad.status, 400);
});

test('exportBookings caps the page size and tolerates empty tables', async () => {
  const deps = fakeDeps();
  for (let i = 0; i < 5; i++) exportRow(deps, 'r' + i, { updated_at: i + 1 });
  const r = await exportBookings({ query: { limit: '99999' }, authorization: auth }, deps);
  assert.equal(r.body.rows.length, 5);
  const empty = await exportBookings({ query: {}, authorization: auth }, fakeDeps());
  assert.deepEqual(empty.body.rows, []);
  assert.equal(empty.body.next_after, null);
});
