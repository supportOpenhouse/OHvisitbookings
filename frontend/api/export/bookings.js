// Token-protected export for the Google Sheets sync (scripts/google-sheets-sync.gs).
// GET /api/export/bookings?updated_after=<ISO>&limit=500   Authorization: Bearer <EXPORT_API_KEY>
import { getDeps } from '../../lib/deps.js';
import { exportBookings } from '../../lib/handlers.js';
import { toResponse, methodNotAllowed, route } from '../../lib/web.js';

export const GET = route(async request => {
  const url = new URL(request.url);
  const query = Object.fromEntries(url.searchParams);
  return toResponse(await exportBookings({ query, authorization: request.headers.get('authorization') || '' }, getDeps()));
});
export const POST = () => methodNotAllowed('GET');
