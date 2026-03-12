import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query } from '../db.js';

export async function offerRoutes(app: FastifyInstance) {

  // GET /owners/:id/applications — workers who applied to owner's listings
  app.get<{ Params: { id: string } }>('/owners/:id/applications', {
    preHandler: [app.authenticate],
  }, async (req, reply) => {
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
    `, [req.params.id]);
    return reply.send({ success: true, data: result.rows, error: null });
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
    return reply.status(201).send({ success: true, data: result.rows[0], error: null });
  });


  // POST /listings/:id/offer — owner proactively sends offer to a worker
  app.post('/listings/:id/offer', {
    preHandler: [app.authenticate],
  }, async (req: any, reply) => {
    const { worker_id } = req.body as { worker_id: string };
    const listing_id = req.params.id;

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
  app.post<{ Params: { id: string } }>('/offers/:id/agreement', {
    preHandler: [app.authenticate],
  }, async (req, reply) => {
    const offer_id = req.params.id;
    const offerRes = await query(`
      SELECT o.*, l.role_code, l.pay_frequency, l.hours_per_week,
             l.accommodation_provided, l.accommodation_address, l.notice_period_weeks
      FROM app.offers o
      JOIN app.listings l ON o.listing_id = l.listing_id
      WHERE o.offer_id = $1
    `, [offer_id]);
    if (!offerRes.rows.length) return reply.status(404).send({ success: false, error: 'Offer not found', data: null });
    const offer = offerRes.rows[0];
    const existing = await query(`SELECT agreement_id FROM app.agreements WHERE offer_id = $1`, [offer_id]);
    if (existing.rows.length > 0) return reply.send({ success: true, data: existing.rows[0], error: null });
    const startDate = new Date();
    startDate.setDate(startDate.getDate() + 7);
    const result = await query(`
      INSERT INTO app.agreements (
        offer_id, worker_id, owner_id, role_code_snapshot,
        agreed_pay_cents, agreed_hours_pw, pay_frequency,
        start_date, notice_period_weeks, accommodation_provided, accommodation_address
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *
    `, [
      offer_id, offer.worker_id, offer.owner_id, offer.role_code,
      offer.offered_pay_cents, offer.offered_hours_pw, offer.pay_frequency ?? 'weekly',
      startDate.toISOString().split('T')[0], offer.notice_period_weeks ?? 2,
      offer.accommodation_provided ?? false,
      offer.accommodation_provided ? (offer.accommodation_address ?? 'To be confirmed') : null,
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
