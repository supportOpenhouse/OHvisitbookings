import { CITIES, CONFIGS, VISIT_WHEN } from './validate.js';

const INTERAKT_URL = 'https://api.interakt.ai/v1/public/message/';

export function resolveField(booking, key) {
  switch (key) {
    case 'name': return booking.name || '';
    case 'first_name': return (booking.name || '').split(/\s+/)[0] || '';
    case 'phone': return booking.phone || '';
    case 'email': return booking.email || '';
    case 'city': return CITIES[booking.city] || booking.city || '';
    case 'configuration': return CONFIGS[booking.configuration] || booking.configuration || '';
    case 'budget': return booking.budget_label || '';
    case 'areas': return booking.areas_label || '';
    case 'visit_when': return VISIT_WHEN[booking.visit_when] || booking.visit_when || '';
    case 'amount': return '₹' + Math.round((booking.amount_paise || 0) / 100).toLocaleString('en-IN');
    case 'booking_id': return String(booking.id || '').split('-')[0];
    default: return '';
  }
}

export function buildTemplatePayload(booking, { templateName, languageCode = 'en', bodyFields = ['name'], headerFields = [] }) {
  const template = {
    name: templateName,
    languageCode,
    bodyValues: bodyFields.map(f => resolveField(booking, f)),
  };
  if (headerFields.length) template.headerValues = headerFields.map(f => resolveField(booking, f));
  return {
    countryCode: '+91',
    phoneNumber: booking.phone,
    callbackData: booking.id,
    type: 'Template',
    template,
  };
}

export async function sendTemplate(booking, cfg, { apiKey, fetchImpl = fetch }) {
  if (!apiKey) throw new Error('INTERAKT_API_KEY is not configured');
  if (!cfg?.templateName) throw new Error('INTERAKT_TEMPLATE_NAME is not configured');
  const res = await fetchImpl(INTERAKT_URL, {
    method: 'POST',
    headers: { Authorization: `Basic ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(buildTemplatePayload(booking, cfg)),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.result === false) {
    throw new Error(`Interakt send failed (${res.status}): ${data?.message || 'unknown error'}`);
  }
  return { id: data.id };
}
