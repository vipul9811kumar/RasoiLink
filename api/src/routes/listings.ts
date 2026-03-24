import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query } from '../db.js';
import { getPlanFeatures, getActiveListingCount, planGateResponse } from '../gates.js';
import { stripe } from '../stripe.js';
import { notifyMatchingWorkers } from '../alerting.js';

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
    await query('SELECT app.expire_boosts()').catch(() => {});
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
    sql += ` ORDER BY l.is_boosted DESC, l.boosted_until DESC NULLS LAST, l.created_at DESC LIMIT $${params.length}`;

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

    const listing = result.rows[0];

    // Fire WhatsApp alerts to matching workers in the background — don't block response
    notifyMatchingWorkers(
      listing.listing_id, listing.state, listing.role_code,
      listing.title, listing.city, listing.pay_min_cents, listing.pay_max_cents,
    ).catch(e => req.log.warn({ err: e }, 'WhatsApp worker alert failed'));

    return reply.status(201).send({ success: true, data: listing, error: null });
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

  // POST /listings/:listing_id/boost — owner boosts listing for 7 days ($29)
  app.post<{ Params: { listing_id: string } }>('/listings/:listing_id/boost', {
    preHandler: [app.authenticate],
  }, async (req: any, reply) => {
    const { listing_id } = req.params;

    const listingRes = await query(
      'SELECT owner_id FROM app.listings WHERE listing_id = $1',
      [listing_id]
    );
    if (!listingRes.rows.length) {
      return reply.status(404).send({ success: false, error: 'Listing not found', data: null });
    }
    if (listingRes.rows[0].owner_id !== req.user.user_id) {
      return reply.status(403).send({ success: false, error: 'Forbidden', data: null });
    }

    const subRes = await query(
      'SELECT stripe_customer_id FROM app.subscriptions WHERE user_id = $1 LIMIT 1',
      [req.user.user_id]
    );
    let stripe_customer_id = (subRes.rows[0] as any)?.stripe_customer_id;
    if (!stripe_customer_id) {
      const userRes = await query('SELECT name, phone FROM app.users WHERE user_id = $1', [req.user.user_id]);
      const u = (userRes.rows[0] as any);
      const customer = await stripe.customers.create({
        name: u.name, phone: u.phone,
        metadata: { user_id: req.user.user_id },
      });
      stripe_customer_id = customer.id;
    }

    const session = await stripe.checkout.sessions.create({
      customer: stripe_customer_id,
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{ price: process.env.STRIPE_PRICE_JOB_BOOST ?? '', quantity: 1 }],
      success_url: (req.body?.success_url ?? 'https://rasoilink-production.up.railway.app/health') + '?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: req.body?.cancel_url ?? 'https://rasoilink-production.up.railway.app/health',
      metadata: {
        user_id: req.user.user_id,
        tx_type: 'job_boost',
        listing_id,
        price_id: process.env.STRIPE_PRICE_JOB_BOOST ?? '',
      },
    });

    return reply.send({ success: true, data: { url: session.url, session_id: session.id }, error: null });
  });

  // PATCH /listings/:listing_id — owner edits a listing
  app.patch<{ Params: { listing_id: string } }>('/listings/:listing_id', {
    preHandler: [app.authenticate],
  }, async (req: any, reply) => {
    const { listing_id } = req.params;

    // Verify owner owns this listing
    const check = await query(
      'SELECT owner_id FROM app.listings WHERE listing_id = $1',
      [listing_id]
    );
    if (!check.rows.length) {
      return reply.status(404).send({ success: false, error: 'Listing not found', data: null });
    }
    if (check.rows[0].owner_id !== req.user.user_id) {
      return reply.status(403).send({ success: false, error: 'Forbidden', data: null });
    }

    const allowed = [
      'title', 'city', 'state', 'pay_min_cents', 'pay_max_cents',
      'hours_per_week', 'description_en', 'role_code', 'cuisine_required',
      'accommodation_provided', 'accommodation_address', 'accommodation_cost_cents',
      'years_exp_required', 'notice_period_weeks', 'languages_preferred', 'pay_frequency',
    ];

    const body = req.body as any;
    const setClauses: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    for (const key of allowed) {
      if (body[key] !== undefined) {
        setClauses.push(key + ' = $' + i++);
        values.push(body[key]);
      }
    }

    if (setClauses.length === 0) {
      return reply.status(400).send({ success: false, error: 'No fields to update', data: null });
    }

    setClauses.push('updated_at = now()');
    values.push(listing_id);

    const result = await query(
      'UPDATE app.listings SET ' + setClauses.join(', ') + ' WHERE listing_id = $' + i + ' RETURNING *',
      values,
    );

    return reply.send({ success: true, data: result.rows[0], error: null });
  });

}