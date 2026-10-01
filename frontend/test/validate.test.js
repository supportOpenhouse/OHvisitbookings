import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateBooking, normalizePhone, AREAS } from '../lib/validate.js';

const good = () => ({
  name: 'Asha Verma', phone: '+91 98765 43210', email: 'asha@example.com',
  city: 'gurgaon', configuration: '3bhk', budget: '8000000-12000000',
  areas: ['sohna-road', 'golf-course'], visit_when: 'within-1-month',
  utm: { utm_source: 'meta', fbclid: 'abc', junk: 'x' },
});

test('normalizePhone keeps the last 10 digits and rejects non-Indian mobiles', () => {
  assert.equal(normalizePhone('+91 98765 43210'), '9876543210');
  assert.equal(normalizePhone('09876543210'), '9876543210');
  assert.equal(normalizePhone('1234567890'), null);
  assert.equal(normalizePhone('98765'), null);
  assert.equal(normalizePhone(null), null);
});

test('validateBooking accepts a good payload and normalises it', () => {
  const r = validateBooking(good());
  assert.equal(r.ok, true);
  assert.equal(r.value.phone, '9876543210');
  assert.equal(r.value.name, 'Asha Verma');
  assert.equal(r.value.budget_min, 8000000);
  assert.equal(r.value.budget_max, 12000000);
  assert.equal(r.value.budget_label, '₹80 L – ₹1.2 Cr');
  assert.deepEqual(r.value.areas, ['sohna-road', 'golf-course']);
  assert.equal(r.value.areas_label, 'Sohna Road (Sec 49–57), Golf Course Road');
  assert.deepEqual(r.value.utm, { utm_source: 'meta', fbclid: 'abc' });
});

test('validateBooking accepts "any" areas', () => {
  const r = validateBooking({ ...good(), areas: 'any' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.value.areas, ['any']);
  assert.equal(r.value.areas_label, 'Anywhere in Gurgaon');
});

test('validateBooking rejects bad fields with per-field errors', () => {
  const r = validateBooking({ ...good(), phone: '12345', email: 'nope', city: 'mumbai', name: 'A' });
  assert.equal(r.ok, false);
  assert.equal(r.errors.phone, 'Enter a valid 10-digit mobile number.');
  assert.equal(r.errors.email, 'Enter a valid email.');
  assert.equal(r.errors.city, 'Choose a city.');
  assert.equal(r.errors.name, 'Enter your name.');
});

test('validateBooking rejects an area that does not belong to the chosen city', () => {
  const r = validateBooking({ ...good(), city: 'noida', areas: ['sohna-road'] });
  assert.equal(r.ok, false);
  assert.equal(r.errors.areas, 'Pick at least one area.');
});

test('validateBooking rejects more than 4 areas and empty areas', () => {
  const five = AREAS.gurgaon.slice(0, 5).map(a => a[0]);
  assert.equal(validateBooking({ ...good(), areas: five }).ok, false);
  assert.equal(validateBooking({ ...good(), areas: [] }).ok, false);
});

test('validateBooking rejects unknown configuration, budget and visit window', () => {
  assert.equal(validateBooking({ ...good(), configuration: '5bhk' }).errors.configuration, 'Choose one.');
  assert.equal(validateBooking({ ...good(), budget: '1-2' }).errors.budget, 'Choose one.');
  assert.equal(validateBooking({ ...good(), visit_when: 'never' }).errors.visit_when, 'Choose one.');
});

test('validateBooking truncates over-long strings and ignores non-object utm', () => {
  const r = validateBooking({ ...good(), name: 'x'.repeat(500), utm: 'nope' });
  assert.equal(r.ok, true);
  assert.equal(r.value.name.length, 120);
  assert.deepEqual(r.value.utm, {});
});

test('validateBooking treats areas, email and timeline as optional (new booking sheet has none)', () => {
  const r = validateBooking({ name: 'Asha Verma', phone: '9876543210', city: 'noida', configuration: '2bhk', budget: '0-8000000' });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.deepEqual(r.value.areas, ['any']);
  assert.equal(r.value.areas_label, 'Anywhere in Noida');
  assert.equal(r.value.email, '');
  assert.equal(r.value.visit_when, '');
  assert.equal(r.value.budget_label, 'Under ₹80 L');
});

test('validateBooking still rejects a malformed email when one is given', () => {
  assert.equal(validateBooking({ ...good(), email: 'nope' }).errors.email, 'Enter a valid email.');
});

test('validateBooking accepts Greater Noida West and the four new budget bands and three timelines', () => {
  assert.equal(validateBooking({ ...good(), city: 'greater-noida-west', areas: 'any' }).value.areas_label, 'Anywhere in Greater Noida West');
  for (const b of ['0-8000000', '8000000-12000000', '12000000-20000000', '20000000-999900000']) assert.equal(validateBooking({ ...good(), budget: b }).ok, true, b);
  assert.equal(validateBooking({ ...good(), budget: '10000000-15000000' }).ok, false, 'old band is gone');
  for (const t of ['within-1-month', '1-3-months', '3-6-months']) assert.equal(validateBooking({ ...good(), visit_when: t }).ok, true, t);
  assert.equal(validateBooking({ ...good(), visit_when: 'this-sat' }).ok, false, 'old visit window is gone');
});

test('validateBooking keeps the variant in utm', () => {
  const r = validateBooking({ ...good(), utm: { utm_source: 'meta', variant: 'B-home-in-30-days' } });
  assert.deepEqual(r.value.utm, { utm_source: 'meta', variant: 'B-home-in-30-days' });
});
