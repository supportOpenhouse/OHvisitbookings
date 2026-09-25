const DEFAULT_BASE = 'https://api.in.kaleyra.io';

export async function sendOtpSms({ phone10, body }, { apiKey, sid, sender, templateId, baseUrl = DEFAULT_BASE, fetchImpl = fetch }) {
  if (!apiKey) throw new Error('KALEYRA_API_KEY is not configured');
  if (!sid) throw new Error('KALEYRA_ACCOUNT_ID is not configured');
  const params = new URLSearchParams({
    to: `+91${phone10}`,
    type: 'OTP',
    sender: sender || '',
    body,
    template_id: templateId || '',
  });
  const res = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/v1/${sid}/messages`, {
    method: 'POST',
    headers: { 'api-key': apiKey, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || data?.message || JSON.stringify(data);
    throw new Error(`Kaleyra SMS failed (${res.status}): ${msg}`);
  }
  return { id: data.id };
}
