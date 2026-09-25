// Razorpay → https://bookvisit.openhouse.in/api/payments/webhook  (event: payment.captured)
import { getDeps } from '../../lib/deps.js';
import { paymentsWebhook } from '../../lib/handlers.js';
import { toResponse, methodNotAllowed, route } from '../../lib/web.js';

export const POST = route(async request => {
  const rawBody = await request.text();
  const signature = request.headers.get('x-razorpay-signature') || '';
  return toResponse(await paymentsWebhook({ rawBody, signature }, getDeps()));
});
export const GET = () => methodNotAllowed('POST');
