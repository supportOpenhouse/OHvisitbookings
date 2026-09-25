# ₹990 Visit Bookings — landing page, backend, payments (design spec)

Date: 2026-09-25 · Status: approved in chat (build authorised)

## Goal
Rebuild https://bookvisit.openhouse.in as a polished, mobile-first-but-desktop-great customer page on the openhouse.in brand, and add a backend so a visitor can fill the form, verify their phone by OTP, pay ₹990 via Razorpay, land on a Thank You page, and receive an Interakt WhatsApp template — with every attempt recorded in one new Postgres table.

## Decisions (from the user)
- Keep the mock "live stock" counter / mock society data until a real inventory API exists (marked MOCK in code).
- Razorpay + Interakt keys are not yet available: build with env placeholders + `.env.example`; test with mocked gateways.
- OTP is verified inline right before payment (form → Pay → OTP sheet → Razorpay → Thank You).
- Only the `visitbookings` table is created; nothing else in the shared CRM database is touched.
- `DATABASE_URL` and all keys are never printed; always masked.

## Architecture
- **Hosting:** Vercel, project root `frontend/`. Static HTML pages + Node serverless functions in `frontend/api/`.
- **DB:** Neon Postgres via `@neondatabase/serverless` (HTTP driver, fits serverless).
- **SMS OTP:** Kaleyra India endpoint `POST https://api.in.kaleyra.io/v1/{SID}/messages`, form-encoded, `type=OTP`, `sender`, `template_id`, `body` = `KALEYRA_OTP_BODY` with `{otp}` replaced.
- **Payments:** Razorpay Orders API (server) + Checkout.js (browser). Signature verification server-side; webhook `payment.captured` as a safety net.
- **WhatsApp:** Interakt `POST https://api.interakt.ai/v1/public/message/`, `Authorization: Basic {INTERAKT_API_KEY}`, type `Template`.

## Pages (`frontend/`)
`/` landing (`index.html`), `/thank-you`, `/terms`, `/privacy`, `/refund-policy`. Clean URLs via `vercel.json`. Brand: DM Sans, orange `#FA541C`, ink `#1A1F2C`, warm `#FFF8F5`; real logo, hero photos, property photos and customer testimonials from openhouse.in; real contact details (Avano Technologies Pvt Ltd, Sector 65 Gurugram, info@openhouse.in, +91 70421 18400).

## Flow
1. Visitor fills the form. Client validates. Tap **Pay ₹990**.
2. `POST /api/otp/send` — validates, rate-limits (≤5 sends per phone/hour), inserts a `visitbookings` row (`status=otp_sent`, salted OTP hash, 10-min expiry), sends the Kaleyra OTP. Returns `{ booking_id }`.
3. OTP sheet. `POST /api/otp/verify { booking_id, otp }` — ≤5 attempts; on success sets `phone_verified_at`, `status=verified`, creates the Razorpay order (`status=order_created`), sets an httpOnly signed session cookie (`ohvb_session`, 24 h), returns `{ order_id, key_id, amount, currency, prefill }`.
4. Razorpay Checkout opens. On success the browser calls `POST /api/payments/verify { order_id, payment_id, signature }` (session cookie required). Server verifies HMAC, atomically marks `paid`, fires Interakt once (`claim` via `UPDATE … WHERE interakt_sent_at IS NULL`), responds `{ ok, redirect:'/thank-you' }`.
5. `POST /api/payments/webhook` — verifies `x-razorpay-signature`, marks paid + fires Interakt if the client never called verify. Idempotent.
6. `/thank-you` reads `GET /api/bookings/me` (cookie) to show the name + summary; "Our team will contact you within 24 hours."

## Table `visitbookings`
id uuid pk · created_at/updated_at · status (otp_sent|verified|order_created|paid|refunded) · name · phone (10 digits) · email · city · configuration · budget_min/max/label · areas jsonb · areas_label · visit_when · otp_hash/otp_salt/otp_expires_at/otp_attempts/otp_sms_id · phone_verified_at · amount_paise · currency · razorpay_order_id (unique) · razorpay_payment_id · razorpay_signature · paid_at · paid_via · interakt_sent_at/interakt_message_id/interakt_error · source · utm jsonb · page_url · referrer · user_agent · ip · is_test · notes. Indexes on (phone, created_at) and (status). Created by `npm run db:migrate` (idempotent `CREATE TABLE IF NOT EXISTS`).

## Security
OTP stored only as HMAC-SHA256 hash with per-row salt; timing-safe compare; expiry + attempt limits. Session cookie = HMAC-signed payload, httpOnly, Secure, SameSite=Lax. Razorpay/Interakt/Kaleyra secrets server-only. Input whitelisted against known cities/configs/budgets/areas. JSON body limit 64 KB. No secrets in git (`.gitignore`).

## Config (`frontend/.env`, mirrored in Vercel)
Existing: DATABASE_URL, KALEYRA_API_KEY, KALEYRA_ACCOUNT_ID, KALEYRA_OTP_TEMPLATE_ID, KALEYRA_SMS_SENDER, KALEYRA_OTP_BODY.
New: APP_SECRET, RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET, INTERAKT_API_KEY, INTERAKT_TEMPLATE_NAME, INTERAKT_TEMPLATE_LANG (en), INTERAKT_BODY_FIELDS (name), BOOKING_AMOUNT_PAISE (99000), PUBLIC_BASE_URL, optional KALEYRA_BASE_URL, OTP_DEV_MODE (non-production only: log OTP instead of sending).

## Testing
`node --test` unit tests for validation, OTP hashing, session tokens, Razorpay signatures, Interakt/Kaleyra payload builders and the handler cores (fake repo + fake fetch). Local dev server (`npm run dev`) serves pages + functions for an end-to-end run with OTP_DEV_MODE. Playwright screenshots at 390 px and 1280 px.
