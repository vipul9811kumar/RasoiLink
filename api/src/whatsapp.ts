/**
 * WhatsApp Business sender via Twilio REST API.
 * No SDK needed — uses Node 18+ built-in fetch.
 *
 * Required env vars (set in Railway):
 *   TWILIO_ACCOUNT_SID   — Twilio account SID
 *   TWILIO_AUTH_TOKEN    — Twilio auth token
 *   TWILIO_WHATSAPP_FROM — WhatsApp-enabled number, e.g. +14155238886 (sandbox default)
 *
 * When env vars are not set the message is logged to console only (safe for dev/staging).
 */

const SID   = process.env.TWILIO_ACCOUNT_SID;
const TOKEN = process.env.TWILIO_AUTH_TOKEN;
const FROM  = process.env.TWILIO_WHATSAPP_FROM ?? '+14155238886'; // Twilio sandbox default

export const WHATSAPP_ENABLED = !!(SID && TOKEN);

/**
 * Normalize a phone number to E.164 format required by Twilio.
 * - Already has '+': use as-is
 * - 10 digits (US): prepend +1
 * - 11 digits starting with 1 (US with country code): prepend +
 * - Otherwise: prepend + and hope for the best
 */
export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (phone.startsWith('+')) return phone; // already E.164
  if (digits.length === 10) return `+1${digits}`; // US 10-digit
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`; // US 11-digit
  return `+${digits}`;
}

export async function sendWhatsApp(toPhone: string, message: string): Promise<void> {
  const normalized = normalizePhone(toPhone);

  if (!WHATSAPP_ENABLED) {
    console.log(`[WhatsApp] ${normalized} → ${message.slice(0, 80)}...`);
    return;
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${SID}:${TOKEN}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      To:   `whatsapp:${normalized}`,
      From: `whatsapp:${FROM}`,
      Body: message,
    }).toString(),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Twilio error ${res.status}: ${err}`);
  }
}
