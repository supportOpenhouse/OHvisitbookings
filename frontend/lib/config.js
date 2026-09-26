// Central place that reads process.env. Everything else receives a config object.
const int = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };
const list = (v, d) => (typeof v === 'string' && v.trim() ? v.split(',').map(s => s.trim()).filter(Boolean) : d);

export function loadConfig(env = process.env) {
  if (!env.APP_SECRET) throw new Error('APP_SECRET is not set (generate with: openssl rand -base64 32)');
  const isProduction = env.VERCEL_ENV === 'production' || env.NODE_ENV === 'production';
  return {
    isProduction,
    appSecret: env.APP_SECRET,
    databaseUrl: env.DATABASE_URL || '',
    publicBaseUrl: env.PUBLIC_BASE_URL || 'https://bookvisit.openhouse.in',
    amountPaise: int(env.BOOKING_AMOUNT_PAISE, 99000),
    otpBody: env.KALEYRA_OTP_BODY || 'Your OTP for login is {otp}. Avano Technologies Pvt Ltd.',
    otpTtlMs: int(env.OTP_TTL_MINUTES, 10) * 60 * 1000,
    otpMaxAttempts: int(env.OTP_MAX_ATTEMPTS, 5),
    otpMaxSendsPerHour: int(env.OTP_MAX_SENDS_PER_HOUR, 5),
    otpDevMode: env.OTP_DEV_MODE === '1' || env.OTP_DEV_MODE === 'true',
    kaleyra: {
      apiKey: env.KALEYRA_API_KEY || '',
      sid: env.KALEYRA_ACCOUNT_ID || '',
      sender: env.KALEYRA_SMS_SENDER || '',
      templateId: env.KALEYRA_OTP_TEMPLATE_ID || '',
      baseUrl: env.KALEYRA_BASE_URL || 'https://api.in.kaleyra.io',
    },
    razorpayKeyId: env.RAZORPAY_KEY_ID || '',
    razorpayKeySecret: env.RAZORPAY_KEY_SECRET || '',
    razorpayWebhookSecret: env.RAZORPAY_WEBHOOK_SECRET || '',
    interaktApiKey: env.INTERAKT_API_KEY || '',
    exportApiKey: env.EXPORT_API_KEY || '',
    interakt: {
      templateName: env.INTERAKT_TEMPLATE_NAME || '',
      languageCode: env.INTERAKT_TEMPLATE_LANG || 'en',
      bodyFields: list(env.INTERAKT_BODY_FIELDS, ['name']),
    },
  };
}
