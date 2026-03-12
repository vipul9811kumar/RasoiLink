import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query } from '../db.js';

const UpdateOwnerSchema = z.object({
  restaurant_name:    z.string().optional(),
  restaurant_address: z.string().optional(),
  city:               z.string().optional(),
  state:              z.string().length(2).optional(),
  zip_code:           z.string().optional(),
  cuisine_types:      z.array(z.string()).optional(),
  seat_count:         z.number().int().optional(),
});

export async function ownerRoutes(app: FastifyInstance) {

  // GET /owners/:owner_id
  app.get<{ Params: { owner_id: string } }>('/owners/:owner_id', {
    preHandler: [app.authenticate],
  }, async (req, reply) => {
    const result = await query(
      `SELECT u.user_id, u.name, u.trust_score, u.is_verified,
              op.restaurant_name, op.restaurant_address, op.city, op.state,
              op.cuisine_types, op.seat_count, op.staff_count,
              op.biz_verified, op.pay_reliability_score
       FROM app.users u
       JOIN app.owner_profiles op ON op.owner_id = u.user_id
       WHERE u.user_id = $1 AND u.user_type = 'owner'`,
      [req.params.owner_id],
    );
    if (!result.rows[0]) {
      return reply.status(404).send({ success: false, error: 'Owner not found', data: null });
    }
    return reply.send({ success: true, data: result.rows[0], error: null });
  });

  // PATCH /owners/:owner_id
  app.patch<{ Params: { owner_id: string } }>('/owners/:owner_id', {
    preHandler: [app.authenticate],
  }, async (req, reply) => {
    const { owner_id } = req.params;
    if (req.user!.user_id !== owner_id) {
      return reply.status(403).send({ success: false, error: 'Forbidden', data: null });
    }

    const parsed = UpdateOwnerSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: parsed.error.message, data: null });
    }

    const fields = parsed.data;
    const setClauses: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    for (const [key, val] of Object.entries(fields)) {
      if (val !== undefined) { setClauses.push(`${key} = $${i++}`); values.push(val); }
    }
    if (setClauses.length === 0) {
      return reply.status(400).send({ success: false, error: 'No fields to update', data: null });
    }

    setClauses.push(`updated_at = now()`);
    values.push(owner_id);
    await query(
      `UPDATE app.owner_profiles SET ${setClauses.join(', ')} WHERE owner_id = $${i}`,
      values,
    );

    const result = await query(
      `SELECT * FROM app.owner_profiles WHERE owner_id = $1`, [owner_id],
    );
    return reply.send({ success: true, data: result.rows[0], error: null });
  });

  // GET /owners/:owner_id/listings
  app.get<{ Params: { owner_id: string } }>('/owners/:owner_id/listings', {
    preHandler: [app.authenticate],
  }, async (req, reply) => {
    const result = await query(
      `SELECT * FROM app.listings WHERE owner_id = $1 ORDER BY created_at DESC`,
      [req.params.owner_id],
    );
    return reply.send({ success: true, data: result.rows, error: null });
  });
}
