import { createHmac, timingSafeEqual } from 'node:crypto';

const RZP_ORDERS_URL = 'https://api.razorpay.com/v1/orders';

function hmacEquals(expectedHex, givenHex) {
  if (typeof givenHex !== 'string' || !givenHex) return false;
  const a = Buffer.from(expectedHex, 'hex');
  const b = Buffer.from(givenHex, 'hex');
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

export function verifyPaymentSignature({ orderId, paymentId, signature }, keySecret) {
  if (!orderId || !paymentId || !keySecret) return false;
  const expected = createHmac('sha256', keySecret).update(`${orderId}|${paymentId}`).digest('hex');
  return hmacEquals(expected, signature);
}

export function verifyWebhookSignature(rawBody, signature, webhookSecret) {
  if (!webhookSecret) return false;
  const expected = createHmac('sha256', webhookSecret).update(rawBody).digest('hex');
  return hmacEquals(expected, signature);
}

export async function createOrder({ amountPaise, receipt, notes = {} }, { keyId, keySecret, fetchImpl = fetch }) {
  if (!keyId || !keySecret) throw new Error('RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are not configured');
  const res = await fetchImpl(RZP_ORDERS_URL, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64'),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ amount: amountPaise, currency: 'INR', receipt, notes }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Razorpay order failed (${res.status}): ${data?.error?.description || 'unknown error'}`);
  }
  return data;
}
