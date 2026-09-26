// Postgres repository for the `visitbookings` table (Neon HTTP driver — one short-lived
// query per call, which suits serverless). This is the ONLY table this app touches.
// Timestamps cross this boundary as epoch milliseconds (what the handlers use);
// jsonb columns cross as plain objects/arrays.
import { neon } from '@neondatabase/serverless';

export const TABLE = 'visitbookings';

const TS_FIELDS = ['created_at', 'updated_at', 'otp_expires_at', 'phone_verified_at', 'paid_at', 'interakt_sent_at'];

function out(row) {
  if (!row) return null;
  const r = { ...row };
  for (const f of TS_FIELDS) if (r[f] instanceof Date) r[f] = r[f].getTime();
  if (typeof r.areas === 'string') r.areas = JSON.parse(r.areas);
  if (typeof r.utm === 'string') r.utm = JSON.parse(r.utm);
  return r;
}
const ts = ms => (ms === null || ms === undefined ? null : new Date(ms).toISOString());

export function makeRepo(sql) {
  return {
    async countRecentOtpSends(phone, sinceMs) {
      const rows = await sql`select count(*)::int as n from visitbookings where phone = ${phone} and created_at >= ${ts(sinceMs)}`;
      return rows[0]?.n ?? 0;
    },

    async createBooking(f) {
      const rows = await sql`
        insert into visitbookings (
          status, name, phone, email, city, configuration, budget_min, budget_max, budget_label,
          areas, areas_label, visit_when, otp_hash, otp_salt, otp_expires_at, otp_attempts,
          amount_paise, currency, source, utm, page_url, referrer, user_agent, ip, is_test
        ) values (
          ${f.status}, ${f.name}, ${f.phone}, ${f.email ?? null}, ${f.city}, ${f.configuration},
          ${f.budget_min ?? null}, ${f.budget_max ?? null}, ${f.budget_label ?? null},
          ${JSON.stringify(f.areas ?? [])}::jsonb, ${f.areas_label ?? null}, ${f.visit_when ?? null},
          ${f.otp_hash}, ${f.otp_salt}, ${ts(f.otp_expires_at)}, ${f.otp_attempts ?? 0},
          ${f.amount_paise}, ${f.currency ?? 'INR'}, ${f.source ?? 'bookvisit-990'},
          ${JSON.stringify(f.utm ?? {})}::jsonb, ${f.page_url ?? null}, ${f.referrer ?? null},
          ${f.user_agent ?? null}, ${f.ip ?? null}, ${!!f.is_test}
        ) returning *`;
      return out(rows[0]);
    },

    async getBooking(id) {
      if (!/^[0-9a-f-]{36}$/i.test(String(id))) return null;
      const rows = await sql`select * from visitbookings where id = ${id}`;
      return out(rows[0]);
    },

    async incrementOtpAttempts(id) {
      const rows = await sql`update visitbookings set otp_attempts = otp_attempts + 1, updated_at = now() where id = ${id} returning otp_attempts`;
      return rows[0]?.otp_attempts ?? 0;
    },

    async markVerified(id, atMs) {
      const rows = await sql`update visitbookings set status = 'verified', phone_verified_at = ${ts(atMs)}, updated_at = now() where id = ${id} returning *`;
      return out(rows[0]);
    },

    async attachOrder(id, { orderId, amountPaise, currency }) {
      const rows = await sql`update visitbookings set razorpay_order_id = ${orderId}, amount_paise = ${amountPaise}, currency = ${currency},
        status = 'order_created', updated_at = now() where id = ${id} returning *`;
      return out(rows[0]);
    },

    async findByOrderId(orderId) {
      const rows = await sql`select * from visitbookings where razorpay_order_id = ${orderId}`;
      return out(rows[0]);
    },

    // Atomic: only the first caller flips the row to paid; later callers get null.
    async markPaid(id, { paymentId, signature, via, at }) {
      const rows = await sql`update visitbookings set status = 'paid', razorpay_payment_id = ${paymentId ?? null},
        razorpay_signature = ${signature ?? null}, paid_via = ${via}, paid_at = ${ts(at)}, updated_at = now()
        where id = ${id} and status <> 'paid' returning *`;
      return out(rows[0]);
    },

    // Atomic claim so the WhatsApp template is sent at most once per booking.
    async claimInteraktSend(id, atMs) {
      const rows = await sql`update visitbookings set interakt_sent_at = ${ts(atMs)}, updated_at = now()
        where id = ${id} and interakt_sent_at is null returning *`;
      return out(rows[0]);
    },

    async recordInterakt(id, { messageId, error }) {
      await sql`update visitbookings set interakt_message_id = ${messageId ?? null}, interakt_error = ${error ?? null}, updated_at = now() where id = ${id}`;
    },

    async setOtpSmsId(id, smsId) {
      await sql`update visitbookings set otp_sms_id = ${smsId}, updated_at = now() where id = ${id}`;
    },

    // Rows changed after `sinceMs`, oldest change first (Google Sheets export cursor).
    async listUpdatedAfter(sinceMs, limit) {
      const rows = await sql`select * from visitbookings where updated_at > ${ts(sinceMs || 0)} order by updated_at asc, id asc limit ${limit}`;
      return rows.map(out);
    },
  };
}

let cached;
export function getRepo(databaseUrl = process.env.DATABASE_URL) {
  if (!cached) {
    if (!databaseUrl) throw new Error('DATABASE_URL is not set');
    cached = makeRepo(neon(databaseUrl));
  }
  return cached;
}
