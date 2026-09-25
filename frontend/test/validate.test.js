import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateBooking, normalizePhone, AREAS } from '../lib/validate.js';

const good = () => ({
  name: 'Asha Verma', phone: '+91 98765 43210', email: 'asha@example.com',
  city: 'gurgaon', configuration: '3bhk', budget: '10000000-15000000',
  areas: ['sohna-road', 'golf-course'], visit_when: 'this-sat',
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
  assert.equal(r.value.budget_min, 10000000);
  assert.equal(r.value.budget_max, 15000000);
  assert.equal(r.value.budget_label, '₹1 Cr – ₹1.5 Cr');
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
  assert.equal(validateBooking({ ...good(), visit_when: 'never' }).errors.visit_when, 'Tell us when you are free.');
});

test('validateBooking truncates over-long strings and ignores non-object utm', () => {
  const r = validateBooking({ ...good(), name: 'x'.repeat(500), utm: 'nope' });
  assert.equal(r.ok, true);
  assert.equal(r.value.name.length, 120);
  assert.deepEqual(r.value.utm, {});
});
