/**
 * POST /waitlist/join
 * Public endpoint — no auth required.
 * Called from the marketing website when someone submits the waitlist form.
 * Sends a WhatsApp invite via AiSensy.
 */

import { FastifyInstance } from 'fastify';
import { sendInviteWhatsApp, WHATSAPP_ENABLED, normalizePhone } from '../whatsapp.js';
import { query } from '../db.js';

const APP_LINK = process.env.APP_INVITE_LINK ?? 'https://github.com/vipul9811kumar/RasoiLink/releases/download/v1.0.0-beta/rasoilink-latest.apk';

async function ensureWaitlistTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS app.waitlist (
      waitlist_id  TEXT        NOT NULL PRIMARY KEY DEFAULT gen_ulid(),
      phone        TEXT        NOT NULL UNIQUE,
      name         TEXT        NOT NULL,
      user_type    TEXT        NOT NULL DEFAULT 'worker',
      joined_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

export async function waitlistRoutes(app: FastifyInstance) {

  await ensureWaitlistTable();

  app.post('/waitlist/join', async (req, reply) => {
    const { name, phone: rawPhone, type } = req.body as any;

    if (!name || !rawPhone) {
      return reply.status(400).send({ success: false, error: 'name and phone required', data: null });
    }

    const phone    = normalizePhone(rawPhone);
    const isWorker = type !== 'owner';
    const role     = isWorker ? 'worker' : 'restaurant owner';
    const userType = isWorker ? 'worker' : 'owner';

    // Save to local DB — INSERT OR IGNORE so re-submissions don't fail
    await query(`
      INSERT INTO app.waitlist (phone, name, user_type)
      VALUES ($1, $2, $3)
      ON CONFLICT (phone) DO UPDATE SET name = EXCLUDED.name, user_type = EXCLUDED.user_type
    `, [phone, name.trim(), userType]);

    // WHATSAPP TEMPORARILY DISABLED — re-enable when AiSensy templates approved
    // if (WHATSAPP_ENABLED) {
    //   sendInviteWhatsApp(phone, name, role, APP_LINK).catch(e =>
    //     console.error('[Waitlist WhatsApp] failed for', phone, e.message),
    //   );
    // }

    console.log(`[Waitlist] Join by ${name} (${phone}) as ${role} — saved to DB`);

    return reply.send({ success: true, data: { queued: false, whatsapp_sent: false, phone, app_link: APP_LINK }, error: null });
  });

  // GET /waitlist/check/:phone — used by admin to verify a phone is on the waitlist
  app.get('/waitlist/check/:phone', async (req: any, reply) => {
    const phone = normalizePhone(req.params.phone);
    const result = await query(`SELECT phone, name, user_type, joined_at FROM app.waitlist WHERE phone = $1`, [phone]);
    return reply.send({ success: true, data: result.rows[0] ?? null, error: null });
  });
}
