// Builds the dependency bundle handed to lib/handlers.js. Production wiring lives here;
// tests pass fakes instead.
import { loadConfig } from './config.js';
import { getRepo } from './db.js';
import { sendOtpSms } from './kaleyra.js';
import { createOrder } from './razorpay.js';
import { sendTemplate } from './interakt.js';

export function buildDeps(config, { repo, fetchImpl = fetch, log = (...a) => console.error('[bookvisit]', ...a) } = {}) {
  return {
    config,
    repo,
    now: () => Date.now(),
    log,
    sms: { sendOtp: args => sendOtpSms(args, { ...config.kaleyra, fetchImpl }) },
    rzp: { createOrder: args => createOrder(args, { keyId: config.razorpayKeyId, keySecret: config.razorpayKeySecret, fetchImpl }) },
    wa: { sendTemplate: (booking, cfg) => sendTemplate(booking, cfg, { apiKey: config.interaktApiKey, fetchImpl }) },
  };
}

let cached;
export function getDeps() {
  if (!cached) {
    const config = loadConfig(process.env);
    cached = buildDeps(config, { repo: getRepo(config.databaseUrl) });
  }
  return cached;
}
