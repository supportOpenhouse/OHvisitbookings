// Creates the `visitbookings` table (idempotent). Touches nothing else in the database.
// Run: npm run db:migrate   (reads DATABASE_URL from .env; the URL is never printed)
import { neon } from '@neondatabase/serverless';

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL is not set'); process.exit(1); }
const sql = neon(url);

const statements = [
`create table if not exists visitbookings (
  id                  uuid primary key default gen_random_uuid(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  status              text not null default 'otp_sent',
  name                text not null,
  phone               text not null,
  email               text,
  city                text not null,
  configuration       text not null,
  budget_min          bigint,
  budget_max          bigint,
  budget_label        text,
  areas               jsonb not null default '[]'::jsonb,
  areas_label         text,
  visit_when          text,
  otp_hash            text,
  otp_salt            text,
  otp_expires_at      timestamptz,
  otp_attempts        integer not null default 0,
  otp_sms_id          text,
  phone_verified_at   timestamptz,
  amount_paise        integer not null default 99000,
  currency            text not null default 'INR',
  razorpay_order_id   text unique,
  razorpay_payment_id text,
  razorpay_signature  text,
  paid_at             timestamptz,
  paid_via            text,
  interakt_sent_at    timestamptz,
  interakt_message_id text,
  interakt_error      text,
  source              text not null default 'bookvisit-990',
  utm                 jsonb not null default '{}'::jsonb,
  page_url            text,
  referrer            text,
  user_agent          text,
  ip                  text,
  is_test             boolean not null default false,
  notes               text
)`,
`create index if not exists visitbookings_phone_created_idx on visitbookings (phone, created_at desc)`,
`create index if not exists visitbookings_status_idx on visitbookings (status)`,
`create index if not exists visitbookings_created_idx on visitbookings (created_at desc)`,
`comment on table visitbookings is 'bookvisit.openhouse.in — ₹990 guaranteed-visit bookings (OTP → Razorpay → Interakt). Owned by the OHvisitbookings app.'`,
];

for (const s of statements) await sql(s);
const cols = await sql`select count(*)::int as n from information_schema.columns where table_schema='public' and table_name='visitbookings'`;
console.log(`visitbookings ready (${cols[0].n} columns)`);
