/**
 * Netlify Function: POST /.netlify/functions/waitlist
 *
 * Receives waitlist form submission, sends a WhatsApp invite via Twilio.
 * Airtable + EmailJS are still handled client-side.
 *
 * Required Netlify env vars (set in Netlify dashboard → Site settings → Env vars):
 *   TWILIO_ACCOUNT_SID
 *   TWILIO_AUTH_TOKEN
 *   TWILIO_WHATSAPP_FROM   (e.g. +14155238886 for sandbox)
 *   APP_INVITE_LINK        (your Expo / EAS build link)
 */

const EXPO_LINK = process.env.APP_INVITE_LINK || 'https://expo.dev/@vipul9811karuna/rasoilink';

async function sendWhatsApp(phone, message) {
  const SID   = process.env.TWILIO_ACCOUNT_SID;
  const TOKEN = process.env.TWILIO_AUTH_TOKEN;
  const FROM  = process.env.TWILIO_WHATSAPP_FROM || '+14155238886';

  if (!SID || !TOKEN) {
    console.log(`[WhatsApp invite] Would send to ${phone}: ${message.slice(0, 60)}...`);
    return;
  }

  const auth = Buffer.from(`${SID}:${TOKEN}`).toString('base64');
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        To:   `whatsapp:${phone}`,
        From: `whatsapp:${FROM}`,
        Body: message,
      }).toString(),
    },
  );

  if (!res.ok) {
    const err = await res.text();
    console.error(`[WhatsApp] Failed for ${phone}: ${err}`);
  }
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: 'Method Not Allowed' };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { name, phone, type } = body;

  if (!phone || !name) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ success: false, error: 'name and phone required' }),
    };
  }

  const isWorker = type === 'worker';
  const emoji    = isWorker ? '👨‍🍳' : '🏪';
  const role     = isWorker ? 'worker' : 'restaurant owner';

  const message =
    `${emoji} *Welcome to RasoiLink Beta, ${name}!*\n\n` +
    `You're on our waitlist as a ${role}. We're onboarding in batches and will send your invite soon.\n\n` +
    `📲 *To get ready, install Expo Go now:*\n` +
    `• iOS → https://apps.apple.com/app/expo-go/id982107779\n` +
    `• Android → https://play.google.com/store/apps/details?id=host.exp.exponent\n\n` +
    `When your invite is ready, open this link:\n` +
    `${EXPO_LINK}\n\n` +
    `Questions? Just reply to this message.\n` +
    `_Reply STOP to unsubscribe_`;

  await sendWhatsApp(phone, message);

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ success: true }),
  };
};
