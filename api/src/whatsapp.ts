/**
 * WhatsApp Business sender via AiSensy API.
 * No SDK needed — uses Node 18+ built-in fetch.
 *
 * Required env vars (set in Railway):
 *   AISENSY_API_KEY          — JWT API key from AiSensy dashboard
 *   AISENSY_OTP_CAMPAIGN     — AiSensy campaign/template name for OTP  (default: rasoilink_otp)
 *   AISENSY_INVITE_CAMPAIGN  — AiSensy campaign/template name for invite (default: rasoilink_invite)
 *
 * When env vars are not set messages are logged to console only (safe for dev/staging).
 */

const API_KEY        = process.env.AISENSY_API_KEY;
const OTP_CAMPAIGN    = process.env.AISENSY_OTP_CAMPAIGN    ?? 'rl_code_v2';
const INVITE_CAMPAIGN = process.env.AISENSY_INVITE_CAMPAIGN ?? 'rl_invite_v2';

const AISENSY_URL = 'https://backend.aisensy.com/campaign/t1/api/v2';

export const WHATSAPP_ENABLED = !!API_KEY;

/**
 * Normalize a phone number to E.164 format.
 * - Already has '+': use as-is
 * - 10 digits (US): prepend +1
 * - 11 digits starting with 1 (US with country code): prepend +
 * - Otherwise: prepend +
 */
export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (phone.startsWith('+')) return phone;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return `+${digits}`;
}

/** Strip leading + for AiSensy — it expects digits only, no + prefix */
function toAisensyPhone(e164: string): string {
  return e164.replace(/^\+/, '');
}

async function callAisensy(
  campaignName: string,
  destination: string,
  userName: string,
  templateParams: string[],
): Promise<void> {
  const res = await fetch(AISENSY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiKey: API_KEY,
      campaignName,
      destination,
      userName,
      templateParams,
      source: 'new-landing-page form',
      media: {},
      buttons: [],
      carouselCards: [],
      location: {},
    }),
  });

  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(`AiSensy error ${res.status}: ${JSON.stringify(body)}`);
  }
  console.log(`[WhatsApp] AiSensy ${campaignName} → ${destination} queued`, body);
}

/**
 * Send OTP login code via WhatsApp.
 * Template: rasoilink_otp
 * Params:   {{1}} = code
 */
export async function sendOtpWhatsApp(phone: string, code: string): Promise<void> {
  const normalized = normalizePhone(phone);
  if (!WHATSAPP_ENABLED) {
    console.log(`[WhatsApp OTP] disabled — ${normalized} code=${code}`);
    return;
  }
  await callAisensy(OTP_CAMPAIGN, toAisensyPhone(normalized), 'User', [code]);
}

/**
 * Send waitlist invite with app download link via WhatsApp.
 * Template: rasoilink_invite
 * Params:   {{1}} = name, {{2}} = role, {{3}} = appLink, {{4}} = phone
 */
export async function sendInviteWhatsApp(
  phone: string,
  name: string,
  role: string,
  appLink: string,
): Promise<void> {
  const normalized = normalizePhone(phone);
  if (!WHATSAPP_ENABLED) {
    console.log(`[WhatsApp Invite] disabled — ${normalized} name=${name}`);
    return;
  }
  await callAisensy(INVITE_CAMPAIGN, toAisensyPhone(normalized), name, [name, role, appLink, normalized]);
}

/**
 * Generic fallback — kept so any future callers compile.
 * Logs the message; for structured sends use sendOtpWhatsApp / sendInviteWhatsApp.
 */
export async function sendWhatsApp(toPhone: string, message: string): Promise<void> {
  const normalized = normalizePhone(toPhone);
  console.log(`[WhatsApp] generic send to ${normalized}: ${message.slice(0, 80)}...`);
}
