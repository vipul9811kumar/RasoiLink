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

export async function sendWhatsApp(toPhone: string, message: string): Promise<void> {
  if (!WHATSAPP_ENABLED) {
    console.log(`[WhatsApp] ${toPhone} → ${message.slice(0, 80)}...`);
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
      To:   `whatsapp:${toPhone}`,
      From: `whatsapp:${FROM}`,
      Body: message,
    }).toString(),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error(`[WhatsApp] Failed to send to ${toPhone}: ${err}`);
  }
}
