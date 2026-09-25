import { getDeps } from '../../lib/deps.js';
import { bookingsMe } from '../../lib/handlers.js';
import { toResponse, requestMeta, methodNotAllowed, route } from '../../lib/web.js';

export const GET = route(async request => {
  const { cookies } = requestMeta(request);
  return toResponse(await bookingsMe({ cookies }, getDeps()));
});
export const POST = () => methodNotAllowed('GET');
