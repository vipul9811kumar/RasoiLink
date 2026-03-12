import { FastifyInstance } from 'fastify';
import { query } from '../db.js';

export async function payRoutes(app: FastifyInstance) {

  // GET /workers/:id/pay — worker's full pay history
  app.get<{ Params: { id: string } }>('/workers/:id/pay', {
    preHandler: [app.authenticate],
  }, async (req, reply) => {
    const result = await query(`
      SELECT
        pc.cycle_id, pc.status, pc.period_start, pc.period_end, pc.due_date,
        pc.expected_amount_cents, pc.owner_amount_paid_cents,
        pc.payment_method, pc.owner_confirmed_at, pc.worker_confirmed_at,
        op.restaurant_name, u.name as owner_name
      FROM app.pay_cycles pc
      JOIN app.agreements a ON pc.agreement_id = a.agreement_id
      JOIN app.owner_profiles op ON pc.owner_id = op.owner_id
      JOIN app.users u ON pc.owner_id = u.user_id
      WHERE pc.worker_id = $1
      ORDER BY pc.period_start DESC
    `, [req.params.id]);

    // Summary stats
    const cycles = result.rows;
    const totalEarned = cycles
      .filter((c:any) => ['owner_confirmed','worker_confirmed','resolved'].includes(c.status))
      .reduce((sum:number, c:any) => sum + (c.owner_amount_paid_cents ?? 0), 0);
    const onTimeCount = cycles.filter((c:any) => c.status === 'worker_confirmed' || c.status === 'owner_confirmed').length;
    const lateCount   = cycles.filter((c:any) => c.status === 'late' || c.status === 'disputed').length;

    return reply.send({
      success: true,
      data: { cycles, summary: { totalEarned, onTimeCount, lateCount, totalCycles: cycles.length } },
      error: null,
    });
  });

  // GET /workers/:id/ratings — worker's trust score breakdown
  app.get<{ Params: { id: string } }>('/workers/:id/ratings', {
    preHandler: [app.authenticate],
  }, async (req, reply) => {
    const [ratingsRes, userRes] = await Promise.all([
      query(`
        SELECT
          r.rating_id, r.period_month, r.rater_type,
          r.dim_pay_reliability, r.dim_communication, r.dim_overall,
          r.dim_reliability, r.dim_skill_level, r.dim_punctuality,
          r.private_note, r.submitted_at,
          u.name as rater_name, op.restaurant_name
        FROM app.ratings r
        JOIN app.users u ON r.rater_id = u.user_id
        LEFT JOIN app.owner_profiles op ON r.rater_id = op.owner_id
        WHERE r.rated_id = $1
        ORDER BY r.submitted_at DESC
      `, [req.params.id]),
      query(`SELECT trust_score, is_verified FROM app.users WHERE user_id = $1`, [req.params.id]),
    ]);

    const ratings = ratingsRes.rows;
    const user    = userRes.rows[0];

    // Compute dimension averages
    const avg = (key: string) => {
      const vals = ratings.map((r:any) => r[key]).filter((v:any) => v != null);
      return vals.length ? (vals.reduce((a:number,b:number) => a+b, 0) / vals.length).toFixed(1) : null;
    };

    return reply.send({
      success: true,
      data: {
        trust_score: user?.trust_score,
        is_verified: user?.is_verified,
        ratings,
        averages: {
          overall:         avg('dim_overall'),
          pay_reliability: avg('dim_pay_reliability'),
          communication:   avg('dim_communication'),
          reliability:     avg('dim_reliability'),
          skill_level:     avg('dim_skill_level'),
          punctuality:     avg('dim_punctuality'),
        },
        total_ratings: ratings.length,
      },
      error: null,
    });
  });

  // PATCH /pay/:id/confirm — worker confirms they received pay
  app.patch<{ Params: { id: string } }>('/pay/:id/confirm', {
    preHandler: [app.authenticate],
  }, async (req, reply) => {
    const result = await query(`
      UPDATE app.pay_cycles
      SET status = 'worker_confirmed', worker_confirmed_at = now()
      WHERE cycle_id = $1 AND status = 'owner_confirmed'
      RETURNING *
    `, [req.params.id]);
    if (!result.rows.length) {
      return reply.status(400).send({ success: false, error: 'Cannot confirm — pay not yet marked as sent by owner', data: null });
    }
    return reply.send({ success: true, data: result.rows[0], error: null });
  });

  // PATCH /pay/:id/owner-confirm — owner marks pay as sent
  app.patch<{ Params: { id: string } }>('/pay/:id/owner-confirm', {
    preHandler: [app.authenticate],
  }, async (req, reply) => {
    const { amount_cents, payment_method } = req.body as any;
    const result = await query(`
      UPDATE app.pay_cycles
      SET status = 'owner_confirmed',
          owner_confirmed_at = now(),
          owner_amount_paid_cents = $1,
          payment_method = $2
      WHERE cycle_id = $3 AND status IN ('scheduled','late')
      RETURNING *
    `, [amount_cents, payment_method ?? 'cash', req.params.id]);
    if (!result.rows.length) {
      return reply.status(400).send({ success: false, error: 'Cannot update pay cycle', data: null });
    }
    return reply.send({ success: true, data: result.rows[0], error: null });
  });

  // GET /owners/:id/pay — owner's pay obligations
  app.get<{ Params: { id: string } }>('/owners/:id/pay', {
    preHandler: [app.authenticate],
  }, async (req, reply) => {
    const result = await query(`
      SELECT
        pc.cycle_id, pc.agreement_id, pc.worker_id, pc.status,
        pc.period_start, pc.period_end, pc.due_date,
        pc.expected_amount_cents, pc.owner_amount_paid_cents, pc.payment_method,
        pc.owner_confirmed_at, pc.worker_confirmed_at,
        u.name as worker_name, u.phone as worker_phone,
        EXISTS (
          SELECT 1 FROM app.ratings r
          WHERE r.agreement_id = pc.agreement_id
          AND r.rater_id = pc.owner_id
          AND r.period_month = to_char(pc.period_start, 'YYYY-MM')
        ) as already_rated
      FROM app.pay_cycles pc
      JOIN app.users u ON pc.worker_id = u.user_id
      WHERE pc.owner_id = $1
      ORDER BY pc.due_date DESC
    `, [req.params.id]);

    const cycles = result.rows;
    const totalPaid    = cycles.filter((c:any) => c.owner_amount_paid_cents).reduce((s:number,c:any) => s + c.owner_amount_paid_cents, 0);
    const pendingCount = cycles.filter((c:any) => c.status === 'scheduled' || c.status === 'late').length;

    return reply.send({
      success: true,
      data: { cycles, summary: { totalPaid, pendingCount, totalCycles: cycles.length } },
      error: null,
    });
  });

  // POST /ratings — submit a rating
  app.post('/ratings', {
    preHandler: [app.authenticate],
  }, async (req: any, reply) => {
    const {
      agreement_id, rated_id, period_month, rater_type,
      dim_overall, dim_communication, dim_reliability,
      dim_skill_level, dim_punctuality, dim_pay_reliability,
      private_note,
    } = req.body as any;
    const rater_id = (req as any).user.user_id;


    const result = await query(`
      INSERT INTO app.ratings (
        agreement_id, rater_id, rated_id, period_month, rater_type,
        dim_overall, dim_communication, dim_reliability,
        dim_skill_level, dim_punctuality, dim_pay_reliability,
        private_note, window_closes_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now() + interval '30 days')
      RETURNING *
    `, [
      agreement_id, rater_id, rated_id, period_month, rater_type,
      dim_overall, dim_communication, dim_reliability,
      dim_skill_level, dim_punctuality, dim_pay_reliability ?? null,
      private_note ?? null,
    ]);

    return reply.status(201).send({ success: true, data: result.rows[0], error: null });
  });

}