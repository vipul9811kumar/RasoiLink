/**
 * WhatsApp alerting logic for two key events:
 *
 * 1. notifyMatchingWorkers — called after a new listing is published.
 *    Finds workers who (a) have an active worker_boost subscription (has_whatsapp=true)
 *    and (b) match the listing's state/role criteria, then sends each a WhatsApp message.
 *    Capped at 20 workers per listing. Runs fire-and-forget (caller does not await).
 *
 * 2. notifyOwnerNewApplication — called after a worker applies to a listing.
 *    Checks if the listing owner has a Growth plan (has_whatsapp=true) and, if so,
 *    sends a WhatsApp alert to the owner's phone.
 */

import { query } from './db.js';
import { sendWhatsApp } from './whatsapp.js';

export async function notifyMatchingWorkers(
  listing_id: string,
  state: string,
  role_code: string,
  title: string,
  city: string,
  pay_min_cents: number,
  pay_max_cents: number,
): Promise<void> {
  // Find up to 20 workers who:
  //   • Have an active worker_boost subscription (has_whatsapp = true)
  //   • Are in the listing's state OR willing to relocate
  //   • Have a matching role_code OR have overlapping cuisine specializations
  //   • Haven't already been alerted for this listing (dedup via app.notifications)
  const res = await query(`
    SELECT u.phone, u.name, u.user_id
    FROM app.users u
    JOIN app.worker_profiles wp ON wp.worker_id = u.user_id
    JOIN app.subscriptions sub   ON sub.user_id = u.user_id AND sub.status = 'active'
    JOIN app.plans p             ON p.plan_id = sub.plan_id AND p.has_whatsapp = true
    WHERE u.user_type = 'worker'
      AND (wp.current_state = $1 OR wp.willing_to_relocate = true)
      AND (wp.role_code = $2 OR wp.cuisine_specializations && $3::TEXT[])
      AND NOT EXISTS (
        SELECT 1 FROM app.notifications n
        WHERE n.user_id = u.user_id
          AND n.event_type = 'new_listing_alert'
          AND n.related_entity_id = $4
      )
    ORDER BY u.trust_score DESC
    LIMIT 20
  `, [state, role_code, [role_code], listing_id]);

  const pay = `$${Math.round(pay_min_cents / 100)}–$${Math.round(pay_max_cents / 100)}/week`;

  await Promise.allSettled(res.rows.map(async (worker: any) => {
    const msg =
      `🍳 *New Job Alert — RasoiLink*\n\n` +
      `*${title}* in ${city}, ${state}\n` +
      `💰 ${pay}\n\n` +
      `This job matches your profile! Open RasoiLink to view details and apply.\n` +
      `Reply STOP to unsubscribe.`;

    await sendWhatsApp(worker.phone, msg);

    // Record notification so we don't send duplicate alerts
    await query(`
      INSERT INTO app.notifications
        (user_id, event_type, channel, title, body, related_entity_id, related_entity_type, dedup_key, status)
      VALUES ($1,'new_listing_alert','whatsapp','New Job Alert',
              $2, $3, 'listing', $4, 'sent')
      ON CONFLICT DO NOTHING
    `, [
      worker.user_id,
      `${title} in ${city}, ${state} — ${pay}`,
      listing_id,
      `listing_alert_${listing_id}_${worker.user_id}`,
    ]);
  }));
}

export async function notifyOwnerNewApplication(
  owner_id: string,
  worker_name: string,
  listing_title: string,
): Promise<void> {
  // Check owner has Growth plan (has_whatsapp = true)
  const planRes = await query(`
    SELECT u.phone
    FROM app.users u
    JOIN app.subscriptions sub ON sub.user_id = u.user_id AND sub.status = 'active'
    JOIN app.plans p           ON p.plan_id = sub.plan_id AND p.has_whatsapp = true
    WHERE u.user_id = $1
    LIMIT 1
  `, [owner_id]);

  if (!planRes.rows.length) return; // Not on Growth plan — skip

  const { phone } = planRes.rows[0];
  const msg =
    `👨‍🍳 *New Application — RasoiLink*\n\n` +
    `*${worker_name}* just applied for your posting:\n` +
    `*${listing_title}*\n\n` +
    `Open RasoiLink to review their profile and respond.\n` +
    `Reply STOP to unsubscribe.`;

  await sendWhatsApp(phone, msg);
}
