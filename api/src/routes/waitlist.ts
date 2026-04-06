/**
 * POST /waitlist/join
 * Public endpoint — no auth required.
 * Called from the marketing website when someone submits the waitlist form.
 * Sends a WhatsApp invite via Twilio.
 */

import { FastifyInstance } from 'fastify';
import { sendWhatsApp, WHATSAPP_ENABLED, normalizePhone } from '../whatsapp.js';

const APP_LINK = process.env.APP_INVITE_LINK ?? 'https://expo.dev/artifacts/eas/mHiG8YPMZFLnCgis79sEQv.apk';

export async function waitlistRoutes(app: FastifyInstance) {

  app.post('/waitlist/join', async (req, reply) => {
    const { name, phone: rawPhone, type } = req.body as any;

    if (!name || !rawPhone) {
      return reply.status(400).send({ success: false, error: 'name and phone required', data: null });
    }

    const phone    = normalizePhone(rawPhone);
    const isWorker = type !== 'owner';
    const emoji    = isWorker ? '👨‍🍳' : '🏪';
    const role     = isWorker ? 'worker' : 'restaurant owner';

    const message =
      `${emoji} *Welcome to RasoiLink Beta, ${name}!*\n\n` +
      `You're one of our first ${role}s. Here's how to get started:\n\n` +
      `📲 *Download the app:*\n` +
      `${APP_LINK}\n\n` +
      `Open the link on your Android phone and tap *Download*.\n` +
      `(If asked, allow "Install from unknown sources")\n\n` +
      `Once installed:\n` +
      `1️⃣ Enter your phone number: *${phone}*\n` +
      `2️⃣ We'll send you a code here on WhatsApp\n` +
      `3️⃣ Set up your profile and you're live!\n\n` +
      `Questions? Just reply to this message.\n` +
      `_Reply STOP to unsubscribe_`;

    if (WHATSAPP_ENABLED) {
      sendWhatsApp(phone, message).catch(e =>
        console.error('[Waitlist WhatsApp] failed for', phone, e.message),
      );
    } else {
      console.log(`[Waitlist] WHATSAPP_ENABLED=false — would send to ${phone}:\n${message}`);
    }

    return reply.send({ success: true, data: { queued: true, phone }, error: null });
  });
}
