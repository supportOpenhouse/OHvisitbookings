import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifyPaymentSignature, verifyWebhookSignature, createOrder } from '../lib/razorpay.js';

test('verifyPaymentSignature accepts HMAC-SHA256(order_id|payment_id) and rejects others', () => {
  const sig = createHmac('sha256', 'ks').update('order_1|pay_1').digest('hex');
  assert.equal(verifyPaymentSignature({ orderId: 'order_1', paymentId: 'pay_1', signature: sig }, 'ks'), true);
  assert.equal(verifyPaymentSignature({ orderId: 'order_1', paymentId: 'pay_2', signature: sig }, 'ks'), false);
  assert.equal(verifyPaymentSignature({ orderId: 'order_1', paymentId: 'pay_1', signature: 'bad' }, 'ks'), false);
  assert.equal(verifyPaymentSignature({ orderId: 'order_1', paymentId: 'pay_1', signature: undefined }, 'ks'), false);
});

test('verifyWebhookSignature checks the raw body against the webhook secret', () => {
  const body = '{"event":"payment.captured"}';
  const sig = createHmac('sha256', 'whs').update(body).digest('hex');
  assert.equal(verifyWebhookSignature(body, sig, 'whs'), true);
  assert.equal(verifyWebhookSignature(body + ' ', sig, 'whs'), false);
  assert.equal(verifyWebhookSignature(body, sig, 'nope'), false);
  assert.equal(verifyWebhookSignature(body, '', 'whs'), false);
});

test('createOrder posts to Razorpay with basic auth and returns the order', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, json: async () => ({ id: 'order_abc', amount: 99000, currency: 'INR', status: 'created' }) };
  };
  const order = await createOrder(
    { amountPaise: 99000, receipt: 'vb_1', notes: { booking_id: 'b1' } },
    { keyId: 'rzp_test_x', keySecret: 'sec', fetchImpl }
  );
  assert.equal(order.id, 'order_abc');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.razorpay.com/v1/orders');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.Authorization, 'Basic ' + Buffer.from('rzp_test_x:sec').toString('base64'));
  assert.equal(calls[0].init.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(calls[0].init.body), { amount: 99000, currency: 'INR', receipt: 'vb_1', notes: { booking_id: 'b1' } });
});

test('createOrder throws with the gateway error description on failure', async () => {
  const fetchImpl = async () => ({ ok: false, status: 401, json: async () => ({ error: { description: 'Authentication failed' } }) });
  await assert.rejects(
    createOrder({ amountPaise: 99000, receipt: 'r' }, { keyId: 'k', keySecret: 's', fetchImpl }),
    /Authentication failed/
  );
});

test('createOrder refuses to run without credentials', async () => {
  await assert.rejects(createOrder({ amountPaise: 1, receipt: 'r' }, { keyId: '', keySecret: '', fetchImpl: async () => {} }), /RAZORPAY_KEY_ID/);
});
