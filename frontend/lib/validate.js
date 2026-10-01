// Server-side whitelist validation for the booking form. Keep the option maps in
// sync with the landing page (index.html) — the page renders from the same ids.

export const CITIES = {
  gurgaon: 'Gurgaon',
  noida: 'Noida',
  'greater-noida-west': 'Greater Noida West',
  ghaziabad: 'Ghaziabad',
};

export const CONFIGS = {
  '2bhk': '2 BHK',
  '3bhk': '3 BHK',
  '4bhk': '4 BHK',
};

export const BUDGETS = {
  '0-8000000': 'Under ₹80 L',
  '8000000-12000000': '₹80 L – ₹1.2 Cr',
  '12000000-20000000': '₹1.2 – 2 Cr',
  '20000000-999900000': '₹2 Cr+',
};

// Move-in timeline (stored in the visit_when column). Optional on the booking sheet.
export const VISIT_WHEN = {
  'within-1-month': 'Within 1 month',
  '1-3-months': '1 to 3 months',
  '3-6-months': '3 to 6 months',
};

export const AREAS = {
  gurgaon: [
    ['sohna-road', 'Sohna Road (Sec 49–57)'],
    ['golf-course', 'Golf Course Road'],
    ['gc-ext', 'Golf Course Ext. (Sec 65–70)'],
    ['new-ggn', 'New Gurgaon (Sec 80–95)'],
    ['dwarka-expy', 'Dwarka Expressway (Sec 99–113)'],
    ['mg-road', 'MG Road & Sushant Lok'],
    ['palam-vihar', 'Palam Vihar & Sec 21–23'],
  ],
  noida: [
    ['expressway', 'Noida Expressway (Sec 137–150)'],
    ['sec-100-110', 'Sector 100–110'],
    ['sec-74-79', 'Sector 74–79'],
    ['gr-noida-west', 'Greater Noida West'],
    ['sec-44-52', 'Sector 44–52'],
    ['sec-62-70', 'Sector 62–70'],
  ],
  'greater-noida-west': [
    ['gr-noida-west', 'Greater Noida West'],
  ],
  ghaziabad: [
    ['indirapuram', 'Indirapuram'],
    ['vaishali', 'Vaishali & Vasundhara'],
    ['raj-nagar-ext', 'Raj Nagar Extension'],
    ['crossings', 'Crossings Republik'],
    ['nh9', 'NH-9 & Siddharth Vihar'],
  ],
};

export const MAX_AREAS = 4;
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid', 'variant'];

export function normalizePhone(raw) {
  if (raw === null || raw === undefined) return null;
  const digits = String(raw).replace(/\D+/g, '');
  if (digits.length < 10) return null;
  const last10 = digits.slice(-10);
  if (!/^[6-9]\d{9}$/.test(last10)) return null;
  return last10;
}

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export function validateBooking(input) {
  const src = input && typeof input === 'object' ? input : {};
  const errors = {};

  const name = str(src.name, 120);
  if (name.length < 2) errors.name = 'Enter your name.';

  const phone = normalizePhone(src.phone);
  if (!phone) errors.phone = 'Enter a valid 10-digit mobile number.';

  const email = str(src.email, 200); // optional: the booking sheet does not ask for it
  if (email && !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)) errors.email = 'Enter a valid email.';

  const city = str(src.city, 40);
  if (!CITIES[city]) errors.city = 'Choose a city.';

  const configuration = str(src.configuration, 40);
  if (!CONFIGS[configuration]) errors.configuration = 'Choose one.';

  const budget = str(src.budget, 40);
  if (!BUDGETS[budget]) errors.budget = 'Choose one.';

  const visit_when = str(src.visit_when, 40); // optional move-in timeline
  if (visit_when && !VISIT_WHEN[visit_when]) errors.visit_when = 'Choose one.';

  let areas = [];
  let areas_label = '';
  const noAreas = src.areas === undefined || src.areas === null || src.areas === '';
  if (noAreas || src.areas === 'any' || (Array.isArray(src.areas) && src.areas.length === 1 && src.areas[0] === 'any')) {
    areas = ['any'];
    areas_label = CITIES[city] ? `Anywhere in ${CITIES[city]}` : '';
  } else if (Array.isArray(src.areas) && CITIES[city]) {
    const valid = new Map(AREAS[city]);
    const ids = [...new Set(src.areas.map(a => str(a, 60)))];
    if (ids.length === 0 || ids.length > MAX_AREAS || ids.some(id => !valid.has(id))) {
      errors.areas = 'Pick at least one area.';
    } else {
      areas = ids;
      areas_label = ids.map(id => valid.get(id)).join(', ');
    }
  } else {
    errors.areas = 'Pick at least one area.';
  }

  const utm = {};
  if (src.utm && typeof src.utm === 'object' && !Array.isArray(src.utm)) {
    for (const k of UTM_KEYS) if (typeof src.utm[k] === 'string' && src.utm[k]) utm[k] = src.utm[k].slice(0, 200);
  }

  if (Object.keys(errors).length) return { ok: false, errors };

  const [budget_min, budget_max] = budget.split('-').map(Number);
  return {
    ok: true,
    value: {
      name, phone, email, city, configuration,
      budget_min, budget_max, budget_label: BUDGETS[budget],
      areas, areas_label, visit_when, utm,
    },
  };
}
