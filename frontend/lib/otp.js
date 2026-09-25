import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

export function generateOtp(random = () => randomInt(0, 1_000_000)) {
  return String(random()).padStart(6, '0');
}

export function newSalt() {
  return randomBytes(16).toString('hex');
}

export function hashOtp(otp, salt, secret) {
  return createHmac('sha256', String(secret)).update(`${salt}:${otp}`).digest('hex');
}

export function otpMatches(otp, hash, salt, secret) {
  if (typeof otp !== 'string' || !otp || typeof hash !== 'string' || !hash) return false;
  const a = Buffer.from(hashOtp(otp, salt, secret), 'hex');
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function renderOtpBody(template, otp) {
  if (typeof template !== 'string' || !template.includes('{otp}')) {
    throw new Error('KALEYRA_OTP_BODY must contain the {otp} placeholder');
  }
  return template.split('{otp}').join(otp);
}
