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
}
