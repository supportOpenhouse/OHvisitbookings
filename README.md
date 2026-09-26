# OHvisitbookings — bookvisit.openhouse.in

Landing page + backend for Openhouse's ₹990 "guaranteed 4–6 verified flat visits" offer.
Live at https://bookvisit.openhouse.in (Vercel, project root directory = `frontend/`).

## What's here

```
frontend/
  index.html            landing page (form → OTP → Razorpay → /thank-you)
  thank-you.html        post-payment page ("team will contact you within 24 hours")
  terms.html · privacy.html · refund-policy.html
  assets/               site.css (brand tokens from openhouse.in), logo, photos
  api/                  Vercel serverless functions (Node, Web Request/Response signature)
    otp/send.js         validate form → save booking → send Kaleyra OTP
    otp/verify.js       check OTP → create Razorpay order → set session cookie
    payments/verify.js  verify Razorpay signature → mark paid → fire Interakt template
    payments/webhook.js Razorpay webhook (payment.captured) safety net
    bookings/me.js      booking summary for the thank-you page (session cookie)
    export/bookings.js  token-protected export for the Google Sheets sync (Bearer EXPORT_API_KEY)
  lib/                  framework-free logic (validate, otp, session, razorpay, interakt, kaleyra, handlers, db)
  scripts/migrate.mjs   creates the `visitbookings` table (idempotent)
  scripts/dev-server.mjs local server for pages + functions
  scripts/google-sheets-sync.gs  Apps Script: pulls bookings into a Google Sheet every 5 minutes
  test/                 node --test unit tests
docs/superpowers/specs/ design spec
```

## Setup

```bash
cd frontend
cp .env.example .env     # then fill in values (never commit .env)
npm install
npm run db:migrate       # creates ONLY the visitbookings table in the shared Neon DB
npm test
OTP_DEV_MODE=1 npm run dev   # http://localhost:3000 — OTP is auto-filled, no SMS is sent
```

`OTP_DEV_MODE` is ignored when `VERCEL_ENV=production`.

## Environment variables

Existing: `DATABASE_URL`, `KALEYRA_API_KEY`, `KALEYRA_ACCOUNT_ID`, `KALEYRA_OTP_TEMPLATE_ID`, `KALEYRA_SMS_SENDER`, `KALEYRA_OTP_BODY`.

Add (locally in `frontend/.env` and in Vercel → Project → Settings → Environment Variables):

| Variable | Notes |
| --- | --- |
| `APP_SECRET` | `openssl rand -base64 32`. Signs session cookies and hashes OTPs. |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | Razorpay dashboard → API keys. Use `rzp_test_…` first. |
| `RAZORPAY_WEBHOOK_SECRET` | Dashboard → Webhooks → add `https://bookvisit.openhouse.in/api/payments/webhook`, event `payment.captured`. |
| `INTERAKT_API_KEY` | Interakt → Developer settings. Sent as `Authorization: Basic <key>`. |
| `INTERAKT_TEMPLATE_NAME` / `INTERAKT_TEMPLATE_LANG` | Approved WhatsApp template and language code (default `en`). |
| `INTERAKT_BODY_FIELDS` | Comma-separated fields for the template's `{{1}},{{2}}…` (default `name`). Allowed: `name, first_name, phone, email, city, configuration, budget, areas, visit_when, amount, booking_id`. |
| `BOOKING_AMOUNT_PAISE` | Default `99000`. |
| `PUBLIC_BASE_URL` | Default `https://bookvisit.openhouse.in`. |
| `EXPORT_API_KEY` | Bearer token for `/api/export/bookings`. `openssl rand -hex 24`. Same value goes into the Apps Script's Script Properties. |

## Booking lifecycle (`visitbookings.status`)

`otp_sent → verified → order_created → paid` (`refunded` reserved for ops). One row per attempt, so drop-offs are visible. OTPs are stored only as salted hashes; 10-minute expiry, 5 attempts, 5 sends per number per hour. Rows created in dev mode are flagged `is_test = true`.

## Google Sheets sync

`scripts/google-sheets-sync.gs` pulls the `visitbookings` table into a sheet tab called **Bookings** every 5 minutes, upserting by booking id. It calls `GET /api/export/bookings?updated_after=…&limit=500` with `Authorization: Bearer EXPORT_API_KEY`; the endpoint returns labelled, whitelisted columns (no OTP hashes, signatures, IPs or user agents) ordered by `updated_at`, with a cursor for paging. Setup steps are at the top of the script: paste it into Extensions → Apps Script, add `EXPORT_API_KEY` to Script Properties, run `setup` once.

## Notes

- The "matching stock" counter on the landing page is simulated (`OH.MOCK_COUNTER`) until a real inventory API exists.
- The showcase photos and customer stories are taken from openhouse.in (Sept 2026); refresh them when inventory changes.
- Legal pages mirror openhouse.in's Terms and Privacy Policy with booking-specific additions; the Refund Policy reflects the guarantees stated on the landing page. Have legal review before launch.
