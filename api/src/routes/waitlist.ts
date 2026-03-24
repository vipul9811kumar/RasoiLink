/**
 * POST /waitlist/join
 * Public endpoint — no auth required.
 * Called from the marketing website when someone submits the waitlist form.
 * Sends a WhatsApp invite via Twilio.
 */

import { FastifyInstance } from 'fastify';
import { sendWhatsApp, WHATSAPP_ENABLED } from '../whatsapp.js';

const APP_LINK = process.env.APP_INVITE_LINK ?? 'https://expo.dev/@vipul9811karuna/rasoilink';

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
      `You're on our waitlist as a ${role}. We're onboarding in batches and will send your invite soon.\n\n` +
      `📲 *Get ready — install Expo Go:*\n` +
      `• iOS: https://apps.apple.com/app/expo-go/id982107779\n` +
      `• Android: https://play.google.com/store/apps/details?id=host.exp.exponent\n\n` +
      `Your app link when invited:\n${APP_LINK}\n\n` +
      `Questions? Reply to this message.\n` +
      `_Reply STOP to unsubscribe_`;

    let whatsapp_error: string | null = null;
    if (WHATSAPP_ENABLED) {
      try {
        await sendWhatsApp(phone, message);
      } catch(e: any) {
        whatsapp_error = e?.message ?? 'unknown error';
        console.error('[Waitlist WhatsApp] failed:', e);
      }
    } else {
      console.log(`[Waitlist] Would send WhatsApp to ${phone}:\n${message}`);
    }

    return reply.send({ success: true, data: { queued: true, whatsapp_enabled: WHATSAPP_ENABLED, whatsapp_error }, error: null });
  });
}
