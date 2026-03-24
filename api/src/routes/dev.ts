/**
 * Dev/test routes — only active when NODE_ENV !== 'production'
 * or when DEV_ROUTES=true env var is set.
 *
 * POST /dev/whatsapp-test
 *   Sends a WhatsApp alert for a given listing to a specific phone number,
 *   bypassing the worker_boost subscription check.
 *   Body: { phone: string, listing_id: string }
 */

import { FastifyInstance } from 'fastify';
import { query } from '../db.js';
import { sendWhatsApp, WHATSAPP_ENABLED } from '../whatsapp.js';

const ENABLED = process.env.NODE_ENV !== 'production' || process.env.DEV_ROUTES === 'true';

export async function devRoutes(app: FastifyInstance) {
  if (!ENABLED) return;

  app.post('/dev/whatsapp-test', async (req: any, reply) => {
    const { phone, listing_id } = req.body as { phone: string; listing_id: string };

    if (!phone || !listing_id) {
      return reply.status(400).send({ success: false, error: 'phone and listing_id required', data: null });
    }

    const listingRes = await query(
      `SELECT title, city, state, pay_min_cents, pay_max_cents FROM app.listings WHERE listing_id = $1`,
      [listing_id]
    );
    if (!listingRes.rows.length) {
      return reply.status(404).send({ success: false, error: 'Listing not found', data: null });
    }

    const l = listingRes.rows[0];
    const pay = `$${Math.round(l.pay_min_cents / 100)}–$${Math.round(l.pay_max_cents / 100)}/week`;
    const msg =
      `🍳 *New Job Alert — RasoiLink*\n\n` +
      `*${l.title}* in ${l.city}, ${l.state}\n` +
      `💰 ${pay}\n\n` +
      `This job matches your profile! Open RasoiLink to view details and apply.\n` +
      `Reply STOP to unsubscribe.`;

    await sendWhatsApp(phone, msg);

    return reply.send({
      success: true,
      data: {
        whatsapp_enabled: WHATSAPP_ENABLED,
        phone,
        message_preview: msg.slice(0, 120) + '...',
        note: WHATSAPP_ENABLED
          ? 'Message sent via Twilio'
          : 'Twilio not configured — check Railway logs for console output',
      },
      error: null,
    });
  });
}
