/**
 * POST /waitlist/join
 * Public endpoint — no auth required.
 * Called from the marketing website when someone submits the waitlist form.
 * Sends a WhatsApp invite via Twilio.
 */

import { FastifyInstance } from 'fastify';
import { sendWhatsApp, WHATSAPP_ENABLED } from '../whatsapp.js';

const APP_LINK = process.env.APP_INVITE_LINK ?? 'https://expo.dev/accounts/vipul9811karuna/projects/rasoilink/builds/fe78628a-6f6a-47bb-9996-4170838afc12';

export async function waitlistRoutes(app: FastifyInstance) {

  app.post('/waitlist/join', async (req, reply) => {
    const { name, phone, type } = req.body as any;

    if (!name || !phone) {
      return reply.status(400).send({ success: false, error: 'name and phone required', data: null });
    }

    const isWorker = type !== 'owner';
    const emoji    = isWorker ? '👨‍🍳' : '🏪';
    const role     = isWorker ? 'worker' : 'restaurant owner';

    const message =
      `${emoji} *Welcome to RasoiLink Beta, ${name}!*\n\n` +
      `You're one of our first ${role}s. Here's how to get started:\n\n` +
      `📲 *Install the app (Android):*\n` +
      `${APP_LINK}\n\n` +
      `Open the link on your Android phone and tap *Download*.\n` +
      `(If asked, allow "Install from unknown sources")\n\n` +
      `Once installed:\n` +
      `1️⃣ Enter your phone number\n` +
      `2️⃣ Enter the OTP code we'll send here on WhatsApp\n` +
      `3️⃣ Set up your profile and you're live!\n\n` +
      `Questions? Just reply here.\n` +
      `_Reply STOP to unsubscribe_`;

    if (WHATSAPP_ENABLED) {
      sendWhatsApp(phone, message).catch(e =>
        console.error('[Waitlist WhatsApp] failed:', e),
      );
    } else {
      console.log(`[Waitlist] Would send WhatsApp to ${phone}:\n${message}`);
    }

    return reply.send({ success: true, data: { queued: true }, error: null });
  });
}
