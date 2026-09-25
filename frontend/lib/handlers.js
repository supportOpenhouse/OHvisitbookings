// Framework-agnostic request handlers. Each takes a plain request description and
// injected deps ({ repo, config, sms, rzp, wa, now, log }) and returns { status, body, setCookie? }.
// api/*.js adapts these to Vercel's (req, res).
import { validateBooking, CITIES, CONFIGS, VISIT_WHEN } from './validate.js';
import { generateOtp, hashOtp, newSalt, otpMatches, renderOtpBody } from './otp.js';
import { createSessionToken, verifySessionToken } from './session.js';
import { verifyPaymentSignature, verifyWebhookSignature } from './razorpay.js';
import { serializeCookie } from './http.js';

export const SESSION_COOKIE = 'ohvb_session';
const SESSION_TTL_S = 24 * 60 * 60;
const SOURCE = 'bookvisit-990';

const maskPhone = p => `•••••• ${String(p).slice(-4)}`;
const reply = (status, body, extra = {}) => ({ status, body, ...extra });
const fail = (status, error, extra = {}) => reply(status, { ok: false, error, ...extra });

function sessionFrom(cookies, deps) {
  return verifySessionToken(cookies?.[SESSION_COOKIE], deps.config.appSecret, { now: deps.now() });
}

/* ---------------- OTP: send ---------------- */
export async function otpSend({ body, ip, userAgent, referrer, pageUrl }, deps) {
  const { repo, config, sms, now, log = () => {} } = deps;
  const v = validateBooking(body);
  if (!v.ok) return reply(400, { ok: false, errors: v.errors });
  const b = v.value;

  const sends = await repo.countRecentOtpSends(b.phone, now() - 60 * 60 * 1000);
  if (sends >= config.otpMaxSendsPerHour) {
    return fail(429, 'Too many OTP requests for this number. Please try again in an hour.');
  }

  const otp = generateOtp();
  const salt = newSalt();
  const devMode = config.otpDevMode && !config.isProduction;
  const row = await repo.createBooking({
    ...b,
    status: 'otp_sent',
    otp_hash: hashOtp(otp, salt, config.appSecret),
    otp_salt: salt,
    otp_expires_at: now() + config.otpTtlMs,
    otp_attempts: 0,
    amount_paise: config.amountPaise,
    currency: 'INR',
    source: SOURCE,
    ip: ip || null,
    user_agent: (userAgent || '').slice(0, 500) || null,
    referrer: (referrer || '').slice(0, 500) || null,
    page_url: (pageUrl || '').slice(0, 1000) || null,
    created_at: now(),
    is_test: devMode,
  });

  if (devMode) {
    log('OTP_DEV_MODE: otp for', maskPhone(b.phone), 'is', otp);
    return reply(200, { ok: true, booking_id: row.id, phone_masked: maskPhone(b.phone), resend_after: 30, dev_otp: otp });
  }

  try {
    const r = await sms.sendOtp({ phone10: b.phone, body: renderOtpBody(config.otpBody, otp) });
    if (r?.id) await repo.setOtpSmsId(row.id, r.id);
  } catch (e) {
    log('otp sms failed', e.message);
    return fail(502, 'We could not send the OTP right now. Please try again in a minute.');
  }
  return reply(200, { ok: true, booking_id: row.id, phone_masked: maskPhone(b.phone), resend_after: 30 });
}

/* ---------------- OTP: verify + create Razorpay order ---------------- */
export async function otpVerify({ body, secure = false }, deps) {
  const { repo, config, rzp, now, log = () => {} } = deps;
  const bookingId = typeof body?.booking_id === 'string' ? body.booking_id : '';
  const otp = typeof body?.otp === 'string' ? body.otp.replace(/\D/g, '') : '';
  if (!bookingId) return fail(400, 'Missing booking.');
  const row = await repo.getBooking(bookingId);
  if (!row) return fail(404, 'Booking not found. Please start again.');
  if (row.status === 'paid') return fail(409, 'This booking is already paid.');

  const alreadyVerified = !!row.phone_verified_at;
  if (!alreadyVerified) {
    if (otp.length !== 6) return fail(400, 'Enter the 6-digit OTP.');
    if (row.otp_attempts >= config.otpMaxAttempts) return fail(429, 'Too many wrong attempts. Please request a new OTP.');
    if (!row.otp_expires_at || row.otp_expires_at <= now()) return fail(410, 'This OTP has expired. Please request a new one.');
    if (!otpMatches(otp, row.otp_hash, row.otp_salt, config.appSecret)) {
      const attempts = await repo.incrementOtpAttempts(row.id);
      const left = config.otpMaxAttempts - attempts;
      if (left <= 0) return fail(429, 'Too many wrong attempts. Please request a new OTP.');
      return fail(401, 'Incorrect OTP. Please check and try again.', { attempts_left: left });
    }
    await repo.markVerified(row.id, now());
  }

  let orderId = row.razorpay_order_id;
  let amount = row.amount_paise || config.amountPaise;
  let currency = row.currency || 'INR';
  if (!orderId) {
    try {
      const order = await rzp.createOrder({
        amountPaise: amount,
        receipt: `vb_${row.id}`.slice(0, 40),
        notes: { booking_id: row.id, phone: row.phone, source: SOURCE },
      });
      orderId = order.id; amount = order.amount ?? amount; currency = order.currency ?? currency;
      await repo.attachOrder(row.id, { orderId, amountPaise: amount, currency });
    } catch (e) {
      log('razorpay order failed', e.message);
      return fail(502, 'We could not start the payment. Please try again in a minute.');
    }
  }

  const token = createSessionToken({ bookingId: row.id, phone: row.phone }, config.appSecret, { now: now(), ttlMs: SESSION_TTL_S * 1000 });
  return reply(200, {
    ok: true,
    booking_id: row.id,
    order_id: orderId,
    key_id: config.razorpayKeyId,
    amount,
    currency,
    prefill: { name: row.name, contact: row.phone, email: row.email || '' },
  }, { setCookie: serializeCookie(SESSION_COOKIE, token, { maxAge: SESSION_TTL_S, secure }) });
}

/* ---------------- Shared: mark paid + WhatsApp ---------------- */
async function settlePayment(row, { paymentId, signature, via }, deps) {
  const { repo, config, wa, now, log = () => {} } = deps;
  const paid = await repo.markPaid(row.id, { paymentId, signature, via, at: now() });
  if (!paid) return; // already paid earlier — nothing more to do
  const claimed = await repo.claimInteraktSend(row.id, now());
  if (!claimed) return;
  try {
    const r = await wa.sendTemplate(claimed, config.interakt);
    await repo.recordInterakt(row.id, { messageId: r?.id || null });
  } catch (e) {
    log('interakt failed', e.message);
    await repo.recordInterakt(row.id, { error: String(e.message || e).slice(0, 500) });
  }
}

/* ---------------- Payments: browser-side verify ---------------- */
export async function paymentsVerify({ body, cookies }, deps) {
  const { repo, config } = deps;
  const sess = sessionFrom(cookies, deps);
  if (!sess) return fail(401, 'Your session has expired. Please verify your number again.');
  const row = await repo.getBooking(sess.bookingId);
  if (!row) return fail(404, 'Booking not found.');
  const orderId = body?.order_id, paymentId = body?.payment_id, signature = body?.signature;
  if (!orderId || orderId !== row.razorpay_order_id) return fail(400, 'Order does not match this booking.');
  if (!verifyPaymentSignature({ orderId, paymentId, signature }, config.razorpayKeySecret)) {
    return fail(400, 'Payment signature could not be verified.');
  }
  await settlePayment(row, { paymentId, signature, via: 'client' }, deps);
  return reply(200, { ok: true, redirect: '/thank-you' });
}

/* ---------------- Payments: Razorpay webhook ---------------- */
export async function paymentsWebhook({ rawBody, signature }, deps) {
  const { repo, config } = deps;
  if (!verifyWebhookSignature(rawBody || '', signature, config.razorpayWebhookSecret)) return fail(400, 'Invalid signature.');
  let evt;
  try { evt = JSON.parse(rawBody); } catch { return fail(400, 'Invalid JSON.'); }
  if (evt?.event !== 'payment.captured') return reply(200, { ok: true, ignored: true });
  const p = evt?.payload?.payment?.entity || {};
  if (!p.order_id) return reply(200, { ok: true, ignored: true });
  const row = await repo.findByOrderId(p.order_id);
  if (!row) return reply(200, { ok: true, ignored: true });
  await settlePayment(row, { paymentId: p.id, signature: null, via: 'webhook' }, deps);
  return reply(200, { ok: true });
}

/* ---------------- Bookings: current session's booking ---------------- */
export async function bookingsMe({ cookies }, deps) {
  const sess = sessionFrom(cookies, deps);
  if (!sess) return fail(401, 'No active session.');
  const row = await deps.repo.getBooking(sess.bookingId);
  if (!row) return fail(404, 'Booking not found.');
  return reply(200, {
    ok: true,
    booking: {
      id: row.id,
      ref: String(row.id).split('-')[0].toUpperCase(),
      name: row.name,
      first_name: (row.name || '').split(/\s+/)[0] || '',
      phone_masked: maskPhone(row.phone),
      email: row.email || '',
      city: CITIES[row.city] || row.city,
      configuration: CONFIGS[row.configuration] || row.configuration,
      budget: row.budget_label || '',
      areas: row.areas_label || '',
      visit_when: VISIT_WHEN[row.visit_when] || row.visit_when || '',
      status: row.status,
      paid_at: row.paid_at || null,
      amount: '₹' + Math.round((row.amount_paise || 0) / 100).toLocaleString('en-IN'),
      payment_id: row.razorpay_payment_id || null,
    },
  });
}
