import { getDeps } from '../../lib/deps.js';
import { paymentsVerify } from '../../lib/handlers.js';
import { toResponse, requestMeta, methodNotAllowed, readJson, route } from '../../lib/web.js';

export const POST = route(async request => {
  const body = await readJson(request);
  if (!body) return toResponse({ status: 400, body: { ok: false, error: 'Invalid request body.' } });
  const { cookies } = requestMeta(request);
  return toResponse(await paymentsVerify({ body, cookies }, getDeps()));
});
export const GET = () => methodNotAllowed('POST');
