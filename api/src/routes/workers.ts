import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query } from '../db.js';
import { getPlanFeatures, planGateResponse } from '../gates.js';

const UpdateProfileSchema = z.object({
  role_code:               z.string().optional(),
  years_experience:        z.number().int().min(0).optional(),
  cuisine_specializations: z.array(z.string()).optional(),
  current_city:            z.string().optional(),
  current_state:           z.string().length(2).optional(),
  preferred_states:        z.array(z.string()).optional(),
  willing_to_relocate:     z.boolean().optional(),
  salary_min_cents:        z.number().int().optional(),
  salary_max_cents:        z.number().int().optional(),
  needs_accommodation:     z.boolean().optional(),
  bio_text:                z.string().optional(),
});

export async function workerRoutes(app: FastifyInstance) {

  // GET /workers/:worker_id
  // ── GATE: can_view_contacts — phone hidden for free owners ───────────────
  app.get<{ Params: { worker_id: string } }>('/workers/:worker_id', {
    preHandler: [app.authenticate],
  }, async (req, reply) => {
    const { worker_id } = req.params;
    const result = await query(
      `SELECT u.user_id, u.name, u.language_code, u.trust_score, u.is_verified,
              wp.*
       FROM app.users u
       JOIN app.worker_profiles wp ON wp.worker_id = u.user_id
       WHERE u.user_id = $1 AND u.user_type = 'worker'`,
      [worker_id],
    );
    if (!result.rows[0]) {
      return reply.status(404).send({ success: false, error: 'Worker not found', data: null });
    }

    const worker = result.rows[0];

    // If caller is an owner on free plan — strip phone & contact info
    if (req.user!.user_type === 'owner') {
      const plan = await getPlanFeatures(req.user!.user_id);
      if (!plan.can_view_contacts) {
        // Return profile but mask contact details
        return reply.send({
          success: true,
          data: {
            ...worker,
            phone:         null,
            contact_masked: true,
            upgrade_hint:  'Upgrade to Starter to view contact details and reach out directly.',
          },
          error: null,
        });
      }
    }

    return reply.send({ success: true, data: worker, error: null });
  });

  // PATCH /workers/:worker_id
  app.patch<{ Params: { worker_id: string } }>('/workers/:worker_id', {
    preHandler: [app.authenticate],
  }, async (req, reply) => {
    const { worker_id } = req.params;

    if (req.user!.user_id !== worker_id) {
      return reply.status(403).send({ success: false, error: 'Forbidden', data: null });
    }

    const parsed = UpdateProfileSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: parsed.error.message, data: null });
    }

    const fields = parsed.data;
    const setClauses: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    for (const [key, val] of Object.entries(fields)) {
      if (val !== undefined) {
        setClauses.push(`${key} = $${i++}`);
        values.push(val);
      }
    }

    if (setClauses.length === 0) {
      return reply.status(400).send({ success: false, error: 'No fields to update', data: null });
    }

    setClauses.push(`updated_at = now()`);
    values.push(worker_id);

    await query(
      `UPDATE app.worker_profiles SET ${setClauses.join(', ')} WHERE worker_id = $${i}`,
      values,
    );

    const result = await query(
      `SELECT * FROM app.worker_profiles WHERE worker_id = $1`,
      [worker_id],
    );

    return reply.send({ success: true, data: result.rows[0], error: null });
  });

  // GET /workers/:worker_id/matches
  app.get<{ Params: { worker_id: string }; Querystring: { min_score?: string; limit?: string } }>(
    '/workers/:worker_id/matches', {
    preHandler: [app.authenticate],
  }, async (req, reply) => {
    const { worker_id } = req.params;
    if (req.user!.user_id !== worker_id) {
      return reply.status(403).send({ success: false, error: 'Forbidden', data: null });
    }

    const minScore = parseInt(req.query.min_score ?? '50');
    const limit    = parseInt(req.query.limit    ?? '20');

    const resp = await fetch(`${process.env.MATCH_ENGINE_URL}/matches/worker`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ worker_id, min_score: minScore, limit }),
    });
    const data = await resp.json() as { success: boolean; data: unknown };
    return reply.send(data);
  });

  // GET /workers/search — owner browses available workers
  // ── GATE: can_view_contacts — free owners see redacted profiles ──────────
  app.get('/workers/search', {
    preHandler: [app.authenticate],
  }, async (req: any, reply) => {
    if (req.user.user_type !== 'owner') {
      return reply.status(403).send({ success: false, error: 'Only owners can search workers', data: null });
    }

    const plan = await getPlanFeatures(req.user.user_id);

    const { state, role_code, limit = 20 } = req.query as any;
    const where = ["u.user_type = 'worker'", "wp.salary_min_cents > 0"];
    const params: any[] = [];

    if (state)     { params.push(state);     where.push(`wp.current_state = $${params.length}`); }
    if (role_code) { params.push(role_code); where.push(`wp.role_code = $${params.length}`); }
    params.push(limit);

    const result = await query(`
      SELECT
        u.user_id, u.name, u.trust_score, u.is_verified,
        wp.role_code, wp.years_experience, wp.cuisine_specializations,
        wp.current_state, wp.preferred_states, wp.willing_to_relocate,
        wp.salary_min_cents, wp.salary_max_cents, wp.needs_accommodation,
        wp.profile_completeness
      FROM app.users u
      JOIN app.worker_profiles wp ON u.user_id = wp.worker_id
      WHERE ${where.join(' AND ')}
      ORDER BY u.trust_score DESC, wp.years_experience DESC
      LIMIT $${params.length}
    `, params);

    const workers = result.rows;

    // Free plan — return workers but mask contact info and add upgrade hint
    if (!plan.can_view_contacts) {
      const redacted = workers.map((w: any) => ({
        ...w,
        contact_masked: true,
        upgrade_hint: 'Upgrade to Starter to contact this worker directly.',
      }));
      return reply.send({
        success: true,
        data: redacted,
        meta: {
          plan_id: plan.plan_id,
          contacts_visible: false,
          upgrade_required: true,
          upgrade_message: `You're on the free plan. Upgrade to Starter ($39/mo) to view contact details and reach out to workers.`,
        },
        error: null,
      });
    }

    // Paid plan — full profiles
    return reply.send({
      success: true,
      data: workers,
      meta: { plan_id: plan.plan_id, contacts_visible: true },
      error: null,
    });
  });

}
