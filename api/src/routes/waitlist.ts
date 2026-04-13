/**
 * POST /waitlist/join
 * Public endpoint — no auth required.
 * Called from the marketing website when someone submits the waitlist form.
 * Sends a WhatsApp invite via AiSensy.
 */

import { FastifyInstance } from 'fastify';
import { sendInviteWhatsApp, WHATSAPP_ENABLED, normalizePhone } from '../whatsapp.js';

const APP_LINK = process.env.APP_INVITE_LINK ?? 'https://expo.dev/artifacts/eas/mHiG8YPMZFLnCgis79sEQv.apk';

export async function waitlistRoutes(app: FastifyInstance) {

  app.post('/waitlist/join', async (req, reply) => {
    const { name, phone: rawPhone, type } = req.body as any;

    if (!name || !rawPhone) {
      return reply.status(400).send({ success: false, error: 'name and phone required', data: null });
    }

    const phone    = normalizePhone(rawPhone);
    const isWorker = type !== 'owner';
    const role     = isWorker ? 'worker' : 'restaurant owner';

    if (WHATSAPP_ENABLED) {
      sendInviteWhatsApp(phone, name, role, APP_LINK).catch(e =>
        console.error('[Waitlist WhatsApp] failed for', phone, e.message),
      );
    } else {
      console.log(`[Waitlist] WHATSAPP_ENABLED=false — would send invite to ${phone}`);
    }

    return reply.send({ success: true, data: { queued: WHATSAPP_ENABLED, whatsapp_sent: WHATSAPP_ENABLED, phone, app_link: APP_LINK }, error: null });
  });
}
