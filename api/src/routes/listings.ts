import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query } from '../db.js';
import { getPlanFeatures, getActiveListingCount, planGateResponse } from '../gates.js';

const CreateListingSchema = z.object({
  title:                    z.string().min(3),
  role_code:                z.string(),
  cuisine_required:         z.array(z.string()),
  state:                    z.string().length(2),
  city:                     z.string(),
  pay_min_cents:            z.number().int(),
  pay_max_cents:            z.number().int(),
  pay_frequency:            z.enum(['weekly','biweekly','semimonthly','monthly']).default('weekly'),
  hours_per_week:           z.number().int().default(40),
  years_exp_required:       z.number().int().default(0),
  accommodation_provided:   z.boolean().default(false),
  accommodation_address:    z.string().optional(),
  accommodation_cost_cents: z.number().int().default(0),
  description_en:           z.string(),
  notice_period_weeks:      z.number().int().default(2),
  languages_preferred:      z.array(z.string()).default([]),
});

export async function listingRoutes(app: FastifyInstance) {

  // GET /listings — search active listings (public)
  app.get<{ Querystring: { state?: string; role?: string; limit?: string } }>(
    '/listings', async (req, reply) => {
    const { state, role, limit = '20' } = req.query;
    let sql = `SELECT l.*, op.restaurant_name, u.trust_score as owner_trust_score
               FROM app.listings l
               JOIN app.owner_profiles op ON op.owner_id = l.owner_id
               JOIN app.users u ON u.user_id = l.owner_id
               WHERE l.status = 'active'`;
    const params: unknown[] = [];

    if (state) { params.push(state); sql += ` AND l.state = $${params.length}`; }
    if (role)  { params.push(role);  sql += ` AND l.role_code = $${params.length}`; }

    params.push(parseInt(limit));
    sql += ` ORDER BY l.created_at DESC LIMIT $${params.length}`;

    const result = await query(sql, params);
    return reply.send({ success: true, data: result.rows, error: null });
  });

  // GET /listings/:listing_id (public)
  app.get<{ Params: { listing_id: string } }>('/listings/:listing_id', async (req, reply) => {
    const result = await query(
      `SELECT l.*, op.restaurant_name, op.city as restaurant_city,
              u.name as owner_name, u.trust_score as owner_trust_score
       FROM app.listings l
       JOIN app.owner_profiles op ON op.owner_id = l.owner_id
       JOIN app.users u ON u.user_id = l.owner_id
       WHERE l.listing_id = $1`,
      [req.params.listing_id],
    );
    if (!result.rows[0]) {
      return reply.status(404).send({ success: false, error: 'Listing not found', data: null });
    }
    return reply.send({ success: true, data: result.rows[0], error: null });
  });

  // POST /listings — owner creates listing
  // ── GATE: max_job_posts ──────────────────────────────────────────────────
  app.post('/listings', {
    preHandler: [app.authenticate],
  }, async (req, reply) => {
    if (req.user!.user_type !== 'owner') {
      return reply.status(403).send({ success: false, error: 'Only owners can create listings', data: null });
    }

    // Check plan limits
    const [plan, activeCount] = await Promise.all([
      getPlanFeatures(req.user!.user_id),
      getActiveListingCount(req.user!.user_id),
    ]);

    if (plan.max_job_posts !== null && activeCount >= plan.max_job_posts) {
      return reply.status(402).send(planGateResponse(
        `You have ${activeCount} active listing${activeCount !== 1 ? 's' : ''} (limit: ${plan.max_job_posts} on ${plan.plan_id} plan)`,
        plan.plan_id === 'free' ? 'Starter' : 'Growth',
      ));
    }

    const parsed = CreateListingSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: parsed.error.message, data: null });
    }

    const d = parsed.data;
    const result = await query(
      `INSERT INTO app.listings
         (owner_id, title, role_code, cuisine_required, state, city,
          pay_min_cents, pay_max_cents, pay_frequency, hours_per_week,
          years_exp_required, accommodation_provided, accommodation_address,
          accommodation_cost_cents, description_en, notice_period_weeks,
          languages_preferred, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'active')
       RETURNING *`,
      [
        req.user!.user_id, d.title, d.role_code, d.cuisine_required,
        d.state, d.city, d.pay_min_cents, d.pay_max_cents, d.pay_frequency,
        d.hours_per_week, d.years_exp_required, d.accommodation_provided,
        d.accommodation_address ?? null, d.accommodation_cost_cents,
        d.description_en, d.notice_period_weeks, d.languages_preferred,
      ],
    );

    return reply.status(201).send({ success: true, data: result.rows[0], error: null });
  });

  // PATCH /listings/:listing_id/status
  app.patch<{ Params: { listing_id: string } }>('/listings/:listing_id/status', {
    preHandler: [app.authenticate],
  }, async (req, reply) => {
    const { status } = req.body as { status: string };
    const result = await query(
      `UPDATE app.listings SET status = $1, updated_at = now()
       WHERE listing_id = $2 AND owner_id = $3 RETURNING *`,
      [status, req.params.listing_id, req.user!.user_id],
    );
    if (!result.rows[0]) {
      return reply.status(404).send({ success: false, error: 'Listing not found', data: null });
    }
    return reply.send({ success: true, data: result.rows[0], error: null });
  });

  // GET /listings/:id/score — match score for logged-in worker
  app.get<{ Params: { id: string } }>('/listings/:id/score', {
    preHandler: [app.authenticate],
  }, async (req: any, reply) => {
    const worker_id = req.user.user_id;
    try {
      const resp = await fetch(
        `${process.env.MATCH_ENGINE_URL}/score/${worker_id}/${req.params.id}`
      );
      const data = await resp.json() as any;
      return reply.send({
        success: true,
        data: {
          score: data.data?.total_score ?? null,
          breakdown: data.data?.score_breakdown ?? null,
        },
        error: null,
      });
    } catch {
      return reply.send({ success: true, data: { score: null }, error: null });
    }
  });

  // POST /workers/:id/matches — AI matches for a worker
  // ── GATE: has_ai_match (owner must be on Starter+) ───────────────────────
  app.post<{ Params: { id: string } }>('/workers/:id/matches', {
    preHandler: [app.authenticate],
  }, async (req: any, reply) => {
    // Only gate owners — workers can always see their own matches
    if (req.user.user_type === 'owner') {
      const plan = await getPlanFeatures(req.user.user_id);
      if (!plan.has_ai_match) {
        return reply.status(402).send(planGateResponse('AI match engine', 'Starter'));
      }
    }

    const worker_id = req.params.id;
    try {
      const resp = await fetch(`${process.env.MATCH_ENGINE_URL}/matches/worker`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ worker_id, limit: 20, min_score: 0 }),
      });
      const data = await resp.json() as { success: boolean; data: unknown };
      return reply.send(data);
    } catch {
      return reply.send({ success: false, data: null, error: 'Match engine unavailable' });
    }
  });

}
