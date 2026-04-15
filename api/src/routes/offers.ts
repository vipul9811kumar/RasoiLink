import { createNotification } from './notifications.js';
import { notifyOwnerNewApplication } from '../alerting.js';
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query } from '../db.js';

export async function offerRoutes(app: FastifyInstance) {

  // GET /owners/:id/applications — workers who applied to owner's listings
  app.get<{ Params: { id: string } }>('/owners/:id/applications', {
    preHandler: [app.authenticate],
  }, async (req, reply) => {
    const owner_id = req.params.id;
    // Check if owner's plan allows seeing contact info
    const planRes = await query(
      `SELECT plan FROM app.owner_profiles WHERE owner_id = $1`, [owner_id]
    );
    const plan = planRes.rows[0]?.plan ?? 'free';
    const contactsVisible = plan === 'starter' || plan === 'growth';

    const result = await query(`
      SELECT
        o.offer_id, o.listing_id, o.worker_id, o.status, o.created_at,
        l.title as listing_title,
        u.name as worker_name, u.phone as worker_phone,
        wp.role_code, wp.years_experience, wp.cuisine_specializations,
        wp.salary_min_cents, wp.salary_max_cents,
        u.trust_score
      FROM app.offers o
      JOIN app.listings l ON o.listing_id = l.listing_id
      JOIN app.users u ON o.worker_id = u.user_id
      JOIN app.worker_profiles wp ON o.worker_id = wp.worker_id
      WHERE l.owner_id = $1
      ORDER BY o.created_at DESC
    `, [owner_id]);

    // Mask phone if plan doesn't include contacts
    const rows = result.rows.map((r: any) => ({
      ...r,
      worker_phone: contactsVisible ? r.worker_phone : '🔒 Upgrade to view',
    }));
    return reply.send({ success: true, data: rows, error: null });
  });

  // POST /listings/:id/apply — worker applies to a listing
  app.post<{ Params: { id: string } }>('/listings/:id/apply', {
    preHandler: [app.authenticate],
  }, async (req, reply) => {
    const user_id = req.user!.user_id;
    // Check not already applied
    const existing = await query(
      `SELECT offer_id FROM app.offers WHERE listing_id = $1 AND worker_id = $2`,
      [req.params.id, user_id]
    );
    if (existing.rows.length > 0) {
      return reply.status(400).send({ success: false, error: 'Already applied', data: null });
    }
    const result = await query(`
      INSERT INTO app.offers (listing_id, worker_id, owner_id, offered_pay_cents, offered_hours_pw, status)
      SELECT $1, $2, owner_id, pay_min_cents, hours_per_week, 'pending'
      FROM app.listings WHERE listing_id = $1
      RETURNING *
    `, [req.params.id, user_id]);
    // Notify owner of new application
    const listingRes = await query('SELECT owner_id, title FROM app.listings WHERE listing_id = $1', [req.params.id]);
    const workerRes  = await query('SELECT name FROM app.users WHERE user_id = $1', [user_id]);
    if (listingRes.rows.length) {
      const owner_id    = listingRes.rows[0].owner_id;
      const workerName  = workerRes.rows[0]?.name ?? 'A worker';
      const listingTitle = listingRes.rows[0].title;

      await createNotification({
        user_id: owner_id,
        event_type: 'new_application',
        title: '👨‍🍳 New Application!',
        body: `${workerName} applied for ${listingTitle}`,
        related_entity_id: result.rows[0].offer_id,
        related_entity_type: 'offer',
        dedup_key: `apply_${req.params.id}_${user_id}`,
      });

      // WhatsApp alert to owner if on Growth plan — fire and forget
      notifyOwnerNewApplication(owner_id, workerName, listingTitle)
        .catch(e => console.error('WhatsApp owner alert failed:', e));
    }
    return reply.status(201).send({ success: true, data: result.rows[0], error: null });
  });

  // GET /workers/:id/applications — listing_ids the worker has already applied to
  app.get<{ Params: { id: string } }>('/workers/:id/applications', {
    preHandler: [app.authenticate],
  }, async (req, reply) => {
    const result = await query(
      `SELECT listing_id FROM app.offers WHERE worker_id = $1`,
      [req.params.id]
    );
    return reply.send({ success: true, data: result.rows.map((r: any) => r.listing_id), error: null });
  });

  // POST /listings/:id/offer — owner proactively sends offer to a worker
  app.post('/listings/:id/offer', {
    preHandler: [app.authenticate],
  }, async (req: any, reply) => {
    const { worker_id } = req.body as { worker_id: string };
    const listing_id = req.params.id;

    // ── GATE: hire fee must be paid before sending offer ─────────────────────
    const listingRes = await query(
      `SELECT hire_fee_paid, owner_id FROM app.listings WHERE listing_id = $1`,
      [listing_id]
    );
    if (!listingRes.rows.length) {
      return reply.status(404).send({ success: false, error: 'Listing not found', data: null });
    }
    if (!listingRes.rows[0].hire_fee_paid) {
      return reply.status(402).send({
        success: false,
        error: 'A one-time hire fee of $149 is required to send offers. This covers unlimited offers for this listing.',
        data: null,
        upgrade_required: true,
        required_plan: 'hire_fee',
        listing_id,
      });
    }

    // Check not already offered
    const existing = await query(
      `SELECT offer_id FROM app.offers WHERE listing_id = $1 AND worker_id = $2`,
      [listing_id, worker_id]
    );
    if (existing.rows.length > 0) {
      return reply.status(400).send({ success: false, error: 'Offer already sent', data: null });
    }

    const result = await query(`
      INSERT INTO app.offers (listing_id, worker_id, owner_id, offered_pay_cents, offered_hours_pw, status)
      SELECT $1, $2, owner_id, pay_min_cents, hours_per_week, 'pending'
      FROM app.listings WHERE listing_id = $1
      RETURNING *
    `, [listing_id, worker_id]);

    // Notify worker
    const offerOwnerRes  = await query('SELECT name FROM app.users WHERE user_id = $1', [(req as any).user.user_id]);
    const offerListingRes = await query('SELECT title FROM app.listings WHERE listing_id = $1', [listing_id]);
    await createNotification({
      user_id: worker_id,
      event_type: 'offer_received',
      title: '📩 New Job Offer!',
      body: `${offerOwnerRes.rows[0]?.name} sent you an offer for ${offerListingRes.rows[0]?.title}`,
      related_entity_id: result.rows[0].offer_id,
      related_entity_type: 'offer',
      dedup_key: `offer_${listing_id}_${worker_id}`,
    });
    return reply.status(201).send({ success: true, data: result.rows[0], error: null });
  });

  // GET /workers/:id/offers — worker sees all offers made to them
  app.get('/workers/:id/offers', {
    preHandler: [app.authenticate],
  }, async (req: any, reply) => {
    const result = await query(`
      SELECT
        o.offer_id, o.status, o.offered_pay_cents, o.offered_hours_pw,
        o.created_at, o.responded_at, o.expires_at,
        l.title as listing_title, l.city, l.state, l.accommodation_provided,
        l.description_en,
        u.name as owner_name, u.trust_score as owner_trust_score,
        op.restaurant_name
      FROM app.offers o
      JOIN app.listings l ON o.listing_id = l.listing_id
      JOIN app.users u ON o.owner_id = u.user_id
      JOIN app.owner_profiles op ON o.owner_id = op.owner_id
      WHERE o.worker_id = $1
      ORDER BY o.created_at DESC
    `, [req.params.id]);
    return reply.send({ success: true, data: result.rows, error: null });
  });

  // PATCH /offers/:id — owner updates offer status (accept/reject)
  app.patch<{ Params: { id: string } }>('/offers/:id', {
    preHandler: [app.authenticate],
  }, async (req, reply) => {
    const { status } = req.body as { status: string };
    const result = await query(`
      UPDATE app.offers SET status = $1, responded_at = now()
      WHERE offer_id = $2 RETURNING *
    `, [status, req.params.id]);
    if (!result.rows.length) {
      return reply.status(404).send({ success: false, error: 'Offer not found', data: null });
    }
    return reply.send({ success: true, data: result.rows[0], error: null });
  });


  // POST /offers/:id/agreement — create agreement when owner accepts
  // Body fields are all optional; defaults come from the offer/listing.
  app.post<{ Params: { id: string } }>('/offers/:id/agreement', {
    preHandler: [app.authenticate],
  }, async (req, reply) => {
    const offer_id = req.params.id;
    const offerRes = await query(`
      SELECT o.*, l.role_code, l.pay_frequency, l.hours_per_week,
             l.accommodation_provided, l.accommodation_address,
             l.accommodation_cost_cents, l.notice_period_weeks
      FROM app.offers o
      JOIN app.listings l ON o.listing_id = l.listing_id
      WHERE o.offer_id = $1
    `, [offer_id]);
    if (!offerRes.rows.length) return reply.status(404).send({ success: false, error: 'Offer not found', data: null });
    const offer = offerRes.rows[0];
    const existing = await query(`SELECT agreement_id FROM app.agreements WHERE offer_id = $1`, [offer_id]);
    if (existing.rows.length > 0) return reply.send({ success: true, data: existing.rows[0], error: null });

    // Owner can override defaults by passing body fields
    const b = req.body as {
      start_date?: string;
      agreed_pay_cents?: number;
      agreed_hours_pw?: number;
      pay_frequency?: string;
      pay_day?: string;
      notice_period_weeks?: number;
      accommodation_provided?: boolean;
      accommodation_address?: string;
      accommodation_cost_cents?: number;
      end_date?: string;
    };

    const defaultStart = new Date();
    defaultStart.setDate(defaultStart.getDate() + 7);

    const startDate         = b.start_date           ?? defaultStart.toISOString().split('T')[0];
    const agreedPay         = b.agreed_pay_cents      ?? offer.offered_pay_cents;
    const agreedHours       = b.agreed_hours_pw       ?? offer.offered_hours_pw;
    const payFrequency      = b.pay_frequency         ?? offer.pay_frequency ?? 'weekly';
    const payDay            = b.pay_day               ?? 'friday';
    const noticePeriod      = b.notice_period_weeks   ?? offer.notice_period_weeks ?? 2;
    const accomProvided     = b.accommodation_provided ?? offer.accommodation_provided ?? false;
    const accomAddress      = accomProvided
      ? (b.accommodation_address ?? offer.accommodation_address ?? 'To be confirmed')
      : null;
    const accomCost         = b.accommodation_cost_cents ?? offer.accommodation_cost_cents ?? 0;
    const endDate           = b.end_date ?? null;

    const result = await query(`
      INSERT INTO app.agreements (
        offer_id, worker_id, owner_id, role_code_snapshot,
        agreed_pay_cents, agreed_hours_pw, pay_frequency, pay_day,
        start_date, end_date, notice_period_weeks,
        accommodation_provided, accommodation_address, accommodation_cost_cents
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *
    `, [
      offer_id, offer.worker_id, offer.owner_id, offer.role_code,
      agreedPay, agreedHours, payFrequency, payDay,
      startDate, endDate, noticePeriod,
      accomProvided, accomAddress, accomCost,
    ]);
    await query(`UPDATE app.offers SET status='accepted', responded_at=now() WHERE offer_id=$1`, [offer_id]);
    return reply.status(201).send({ success: true, data: result.rows[0], error: null });
  });

  // GET /offers/:id/agreement
  app.get<{ Params: { id: string } }>('/offers/:id/agreement', {
    preHandler: [app.authenticate],
  }, async (req, reply) => {
    const result = await query(`
      SELECT a.*,
        uw.name as worker_name, uw.phone as worker_phone,
        uo.name as owner_name,
        op.restaurant_name, op.restaurant_address, op.city, op.state
      FROM app.agreements a
      JOIN app.users uw ON a.worker_id = uw.user_id
      JOIN app.users uo ON a.owner_id = uo.user_id
      JOIN app.owner_profiles op ON a.owner_id = op.owner_id
      WHERE a.offer_id = $1
    `, [req.params.id]);
    if (!result.rows.length) return reply.status(404).send({ success: false, error: 'Agreement not found', data: null });
    return reply.send({ success: true, data: result.rows[0], error: null });
  });

  // PATCH /agreements/:id/sign
  app.patch<{ Params: { id: string } }>('/agreements/:id/sign', {
    preHandler: [app.authenticate],
  }, async (req, reply) => {
    const user_type = (req.user as any).user_type;
    const col = user_type === 'worker' ? 'worker_signed_at' : 'owner_signed_at';
    const result = await query(`
      UPDATE app.agreements SET ${col} = now() WHERE agreement_id = $1 RETURNING *
    `, [req.params.id]);
    if (!result.rows.length) return reply.status(404).send({ success: false, error: 'Agreement not found', data: null });
    const agr = result.rows[0];
    const signerUserId = (req as any).user.user_id;
    const signerType   = (req as any).user.user_type;
    const otherUserId  = signerType === 'worker' ? agr.owner_id : agr.worker_id;
    const signerRes    = await query('SELECT name FROM app.users WHERE user_id = $1', [signerUserId]);
    await createNotification({
      user_id: otherUserId,
      event_type: 'agreement_signed',
      title: '✍️ Agreement Signed!',
      body: `${signerRes.rows[0]?.name} has signed the employment agreement. Please review and sign.`,
      related_entity_id: agr.agreement_id,
      related_entity_type: 'agreement',
      dedup_key: `signed_${agr.agreement_id}_${signerUserId}`,
    });
    return reply.send({ success: true, data: result.rows[0], error: null });
  });

  // GET /workers/:id/agreements
  app.get<{ Params: { id: string } }>('/workers/:id/agreements', {
    preHandler: [app.authenticate],
  }, async (req, reply) => {
    const result = await query(`
      SELECT a.*, uo.name as owner_name, op.restaurant_name, op.city, op.state
      FROM app.agreements a
      JOIN app.users uo ON a.owner_id = uo.user_id
      JOIN app.owner_profiles op ON a.owner_id = op.owner_id
      WHERE a.worker_id = $1 ORDER BY a.created_at DESC
    `, [req.params.id]);
    return reply.send({ success: true, data: result.rows, error: null });
  });

  // GET /owners/:id/agreements
  app.get<{ Params: { id: string } }>('/owners/:id/agreements', {
    preHandler: [app.authenticate],
  }, async (req, reply) => {
    const result = await query(`
      SELECT a.*, uw.name as worker_name, uw.phone as worker_phone, op.restaurant_name
      FROM app.agreements a
      JOIN app.users uw ON a.worker_id = uw.user_id
      JOIN app.owner_profiles op ON a.owner_id = op.owner_id
      WHERE a.owner_id = $1 ORDER BY a.created_at DESC
    `, [req.params.id]);
    return reply.send({ success: true, data: result.rows, error: null });
  });
}
