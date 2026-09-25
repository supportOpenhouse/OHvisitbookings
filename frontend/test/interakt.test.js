import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTemplatePayload, sendTemplate, resolveField } from '../lib/interakt.js';

const booking = {
  id: '11111111-2222-3333-4444-555555555555', name: 'Asha Verma', phone: '9876543210', email: 'a@x.com',
  city: 'gurgaon', configuration: '3bhk', budget_label: '₹1 Cr – ₹1.5 Cr', areas_label: 'Sohna Road (Sec 49–57)',
  visit_when: 'this-sat', amount_paise: 99000,
};

test('resolveField maps booking fields to human-readable values', () => {
  assert.equal(resolveField(booking, 'name'), 'Asha Verma');
  assert.equal(resolveField(booking, 'first_name'), 'Asha');
  assert.equal(resolveField(booking, 'city'), 'Gurgaon');
  assert.equal(resolveField(booking, 'configuration'), '3 BHK');
  assert.equal(resolveField(booking, 'visit_when'), 'This Saturday');
  assert.equal(resolveField(booking, 'amount'), '₹990');
  assert.equal(resolveField(booking, 'budget'), '₹1 Cr – ₹1.5 Cr');
  assert.equal(resolveField(booking, 'areas'), 'Sohna Road (Sec 49–57)');
  assert.equal(resolveField(booking, 'booking_id'), '11111111');
  assert.equal(resolveField(booking, 'unknown_thing'), '');
});

test('buildTemplatePayload defaults to the name as the only body value', () => {
  const p = buildTemplatePayload(booking, { templateName: 'visit_booked' });
  assert.deepEqual(p, {
    countryCode: '+91', phoneNumber: '9876543210', callbackData: booking.id, type: 'Template',
    template: { name: 'visit_booked', languageCode: 'en', bodyValues: ['Asha Verma'] },
  });
});

test('buildTemplatePayload resolves several body fields and a language code', () => {
  const p = buildTemplatePayload(booking, { templateName: 't', languageCode: 'hi', bodyFields: ['first_name', 'city', 'amount'] });
  assert.deepEqual(p.template.bodyValues, ['Asha', 'Gurgaon', '₹990']);
  assert.equal(p.template.languageCode, 'hi');
});

test('sendTemplate posts with Basic auth and returns the message id', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return { ok: true, status: 201, json: async () => ({ result: true, id: 'msg_1' }) }; };
  const r = await sendTemplate(booking, { templateName: 'visit_booked' }, { apiKey: 'KEY==', fetchImpl });
  assert.equal(r.id, 'msg_1');
  assert.equal(calls[0].url, 'https://api.interakt.ai/v1/public/message/');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.Authorization, 'Basic KEY==');
  assert.equal(JSON.parse(calls[0].init.body).template.name, 'visit_booked');
});

test('sendTemplate throws with the API message on failure or missing config', async () => {
  const fetchImpl = async () => ({ ok: false, status: 400, json: async () => ({ result: false, message: 'Template not found' }) });
  await assert.rejects(sendTemplate(booking, { templateName: 'x' }, { apiKey: 'k', fetchImpl }), /Template not found/);
  await assert.rejects(sendTemplate(booking, { templateName: '' }, { apiKey: 'k', fetchImpl }), /INTERAKT_TEMPLATE_NAME/);
  await assert.rejects(sendTemplate(booking, { templateName: 'x' }, { apiKey: '', fetchImpl }), /INTERAKT_API_KEY/);
});
