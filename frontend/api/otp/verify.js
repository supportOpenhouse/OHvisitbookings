import { getDeps } from '../../lib/deps.js';
import { otpVerify } from '../../lib/handlers.js';
import { toResponse, requestMeta, methodNotAllowed, readJson, route } from '../../lib/web.js';

export const POST = route(async request => {
  const body = await readJson(request);
  if (!body) return toResponse({ status: 400, body: { ok: false, error: 'Invalid request body.' } });
  const { secure } = requestMeta(request);
  return toResponse(await otpVerify({ body, secure }, getDeps()));
});
export const GET = () => methodNotAllowed('POST');
