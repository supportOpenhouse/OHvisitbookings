import { getDeps } from '../../lib/deps.js';
import { otpSend } from '../../lib/handlers.js';
import { toResponse, requestMeta, methodNotAllowed, readJson, route } from '../../lib/web.js';

export const POST = route(async request => {
  const body = await readJson(request);
  if (!body) return toResponse({ status: 400, body: { ok: false, error: 'Invalid request body.' } });
  const meta = requestMeta(request);
  const result = await otpSend({
    body,
    ip: meta.ip,
    userAgent: meta.userAgent,
    referrer: typeof body.referrer === 'string' ? body.referrer : '',
    pageUrl: typeof body.page_url === 'string' ? body.page_url : meta.referrer,
  }, getDeps());
  return toResponse(result);
});
export const GET = () => methodNotAllowed('POST');
