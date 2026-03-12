import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query } from '../db.js';

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
    return reply.send({ success: true, data: result.rows[0], error: null });
  });

  // PATCH /workers/:worker_id
  app.patch<{ Params: { worker_id: string } }>('/workers/:worker_id', {
    preHandler: [app.authenticate],
  }, async (req, reply) => {
    const { worker_id } = req.params;

    // Only the worker themselves can update their profile
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

    // Return updated profile
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
    const limit = parseInt(req.query.limit ?? '20');

    // Call match engine
    const resp = await fetch(`${process.env.MATCH_ENGINE_URL}/matches/worker`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ worker_id, min_score: minScore, limit }),
    });
    const data = await resp.json() as { success: boolean; data: unknown };

    return reply.send(data);
  });
}
