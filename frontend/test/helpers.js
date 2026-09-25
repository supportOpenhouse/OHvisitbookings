// In-memory stand-in for lib/db.js's repo, plus canned gateway deps for handler tests.
import { hashOtp, newSalt } from '../lib/otp.js';

export function fakeRepo(seed = []) {
  const rows = new Map(seed.map(r => [r.id, { ...r }]));
  let n = 0;
  const repo = {
    rows,
    calls: [],
    async countRecentOtpSends(phone, sinceMs) {
      return [...rows.values()].filter(r => r.phone === phone && r.created_at >= sinceMs).length;
    },
    async createBooking(fields) {
      const row = { id: 'bk_' + (++n), otp_attempts: 0, status: 'otp_sent', ...fields };
      rows.set(row.id, row);
      repo.calls.push(['createBooking', row]);
      return row;
    },
    async getBooking(id) { return rows.get(id) || null; },
    async incrementOtpAttempts(id) { const r = rows.get(id); r.otp_attempts += 1; return r.otp_attempts; },
    async markVerified(id, at) { const r = rows.get(id); r.status = 'verified'; r.phone_verified_at = at; return r; },
    async attachOrder(id, { orderId, amountPaise, currency }) {
      const r = rows.get(id); Object.assign(r, { razorpay_order_id: orderId, amount_paise: amountPaise, currency, status: 'order_created' }); return r;
    },
    async findByOrderId(orderId) { return [...rows.values()].find(r => r.razorpay_order_id === orderId) || null; },
    async markPaid(id, { paymentId, signature, via, at }) {
      const r = rows.get(id); if (!r || r.status === 'paid') return null;
      Object.assign(r, { status: 'paid', razorpay_payment_id: paymentId, razorpay_signature: signature || null, paid_via: via, paid_at: at });
      repo.calls.push(['markPaid', id, via]);
      return r;
    },
    async claimInteraktSend(id, at) {
      const r = rows.get(id); if (!r || r.interakt_sent_at) return null;
      r.interakt_sent_at = at; return r;
    },
    async recordInterakt(id, { messageId, error }) {
      const r = rows.get(id); r.interakt_message_id = messageId || null; r.interakt_error = error || null;
      repo.calls.push(['recordInterakt', id, messageId || null, error || null]);
    },
    async setOtpSmsId(id, smsId) { rows.get(id).otp_sms_id = smsId; },
  };
  return repo;
}

export const baseConfig = {
  appSecret: 'app-secret',
  otpBody: 'Your OTP for login is {otp}. Avano Technologies Pvt Ltd.',
  otpTtlMs: 10 * 60 * 1000,
  otpMaxAttempts: 5,
  otpMaxSendsPerHour: 5,
  otpDevMode: false,
  isProduction: true,
  amountPaise: 99000,
  razorpayKeyId: 'rzp_test_key',
  razorpayKeySecret: 'rzp_secret',
  razorpayWebhookSecret: 'wh_secret',
  interakt: { templateName: 'visit_booked', languageCode: 'en', bodyFields: ['name'] },
};

export function fakeDeps(overrides = {}) {
  const sent = { sms: [], orders: [], wa: [] };
  return {
    sent,
    repo: fakeRepo(),
    config: { ...baseConfig },
    now: () => 1_700_000_000_000,
    sms: { async sendOtp(args) { sent.sms.push(args); return { id: 'sms_1' }; } },
    rzp: { async createOrder(args) { sent.orders.push(args); return { id: 'order_' + (sent.orders.length), amount: args.amountPaise, currency: 'INR' }; } },
    wa: { async sendTemplate(booking, cfg) { sent.wa.push({ booking, cfg }); return { id: 'wa_1' }; } },
    log: () => {},
    ...overrides,
  };
}

export function goodForm() {
  return {
    name: 'Asha Verma', phone: '9876543210', email: 'asha@example.com', city: 'gurgaon', configuration: '3bhk',
    budget: '10000000-15000000', areas: ['sohna-road'], visit_when: 'this-sat', utm: { utm_source: 'meta' },
  };
}

// Seed a booking row that is waiting for OTP "123456".
export function seededOtpRow(deps, extra = {}) {
  const salt = newSalt();
  const row = {
    id: 'bk_seed', name: 'Asha Verma', phone: '9876543210', email: 'asha@example.com', city: 'gurgaon', configuration: '3bhk',
    budget_min: 10000000, budget_max: 15000000, budget_label: '₹1 Cr – ₹1.5 Cr', areas: ['sohna-road'], areas_label: 'Sohna Road (Sec 49–57)',
    visit_when: 'this-sat', status: 'otp_sent', otp_salt: salt, otp_hash: hashOtp('123456', salt, deps.config.appSecret),
    otp_expires_at: deps.now() + 5 * 60 * 1000, otp_attempts: 0, created_at: deps.now(), amount_paise: 99000, currency: 'INR', ...extra,
  };
  deps.repo.rows.set(row.id, row);
  return row;
}
