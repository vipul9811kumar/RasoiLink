/**
 * Admin analytics routes — protected by x-admin-key header matching INTERNAL_SECRET.
 *
 * GET /admin/overview     — KPIs: users, listings, offers, subscriptions, recent signups
 * GET /admin/users        — paginated user list with active plan
 * GET /admin/listings     — paginated listings with owner + application count
 * GET /admin/activity     — recent platform activity feed
 */

import { FastifyInstance } from 'fastify';
import { query } from '../db.js';

function checkAdminKey(req: any, reply: any): boolean {
  const key = req.headers['x-admin-key'];
  if (!key || key !== process.env.INTERNAL_SECRET) {
    reply.status(401).send({ success: false, error: 'Unauthorized', data: null });
    return false;
  }
  return true;
}

export async function adminRoutes(app: FastifyInstance) {
  // ── Overview ────────────────────────────────────────────────────────────────
  app.get('/admin/overview', async (req: any, reply) => {
    if (!checkAdminKey(req, reply)) return;

    const [
      totalRes, workersRes, ownersRes, verifiedRes, newTodayRes, new7dRes,
      listingsTotalRes, listingsActiveRes, listingsFilledRes, listingsNew7dRes,
      offersTotalRes, offersByStatusRes,
      subsActiveRes, mrrRes,
      recentSignupsRes,
    ] = await Promise.all([
      query(`SELECT COUNT(*) FROM app.users`),
      query(`SELECT COUNT(*) FROM app.users WHERE user_type='worker'`),
      query(`SELECT COUNT(*) FROM app.users WHERE user_type='owner'`),
      query(`SELECT COUNT(*) FROM app.users WHERE is_verified=true`),
      query(`SELECT COUNT(*) FROM app.users WHERE created_at >= now() - interval '24 hours'`),
      query(`SELECT COUNT(*) FROM app.users WHERE created_at >= now() - interval '7 days'`),
      query(`SELECT COUNT(*) FROM app.listings`),
      query(`SELECT COUNT(*) FROM app.listings WHERE status='active'`),
      query(`SELECT COUNT(*) FROM app.listings WHERE status='filled'`),
      query(`SELECT COUNT(*) FROM app.listings WHERE created_at >= now() - interval '7 days'`),
      query(`SELECT COUNT(*) FROM app.offers`),
      query(`SELECT status, COUNT(*) as count FROM app.offers GROUP BY status`),
      query(`SELECT plan_id, COUNT(*) as count FROM app.subscriptions WHERE status='active' GROUP BY plan_id`),
      query(`
        SELECT COALESCE(SUM(p.price_cents),0) as mrr
        FROM app.subscriptions s
        JOIN app.plans p ON p.plan_id = s.plan_id
        WHERE s.status='active' AND p.interval='month' AND p.user_type != 'any'
      `),
      query(`
        SELECT DATE(created_at) as date, COUNT(*) as count
        FROM app.users
        WHERE created_at >= now() - interval '14 days'
        GROUP BY DATE(created_at) ORDER BY date ASC
      `),
    ]);

    // offers by status
    const offersByStatus: Record<string, number> = {};
    for (const row of offersByStatusRes.rows) {
      offersByStatus[row.status] = parseInt(row.count, 10);
    }

    // subscriptions by plan
    const byPlan: Record<string, number> = { free: 0, starter: 0, growth: 0, worker_boost: 0 };
    let activeSubs = 0;
    for (const row of subsActiveRes.rows) {
      const planKey = row.plan_id?.toLowerCase().replace(/-/g, '_') ?? 'free';
      byPlan[planKey] = (byPlan[planKey] ?? 0) + parseInt(row.count, 10);
      activeSubs += parseInt(row.count, 10);
    }

    // recent signups: format date as YYYY-MM-DD
    const recentSignups = recentSignupsRes.rows.map((r: any) => ({
      date: new Date(r.date).toISOString().slice(0, 10),
      count: parseInt(r.count, 10),
    }));

    return reply.send({
      success: true,
      data: {
        users: {
          total: parseInt(totalRes.rows[0].count, 10),
          workers: parseInt(workersRes.rows[0].count, 10),
          owners: parseInt(ownersRes.rows[0].count, 10),
          verified: parseInt(verifiedRes.rows[0].count, 10),
          new_today: parseInt(newTodayRes.rows[0].count, 10),
          new_7d: parseInt(new7dRes.rows[0].count, 10),
        },
        listings: {
          total: parseInt(listingsTotalRes.rows[0].count, 10),
          active: parseInt(listingsActiveRes.rows[0].count, 10),
          filled: parseInt(listingsFilledRes.rows[0].count, 10),
          new_7d: parseInt(listingsNew7dRes.rows[0].count, 10),
        },
        offers: {
          total: parseInt(offersTotalRes.rows[0].count, 10),
          pending: offersByStatus['pending'] ?? 0,
          accepted: offersByStatus['accepted'] ?? 0,
          rejected: offersByStatus['rejected'] ?? 0,
        },
        subscriptions: {
          active: activeSubs,
          by_plan: byPlan,
          mrr_cents: parseInt(mrrRes.rows[0].mrr, 10),
        },
        recent_signups: recentSignups,
      },
      error: null,
    });
  });

  // ── Users (paginated) ────────────────────────────────────────────────────────
  app.get('/admin/users', async (req: any, reply) => {
    if (!checkAdminKey(req, reply)) return;

    const page   = Math.max(1, parseInt(req.query.page  ?? '1',  10));
    const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit ?? '20', 10)));
    const offset = (page - 1) * limit;
    const type   = req.query.type   as string | undefined;
    const search = req.query.search as string | undefined;

    // Build WHERE clause using filterParams ($1, $2, ...) for the count query.
    // The main query prepends limit/offset, so we shift indices by +2 for it.
    const filterParams: unknown[] = [];
    const conditions: string[] = [];

    if (type && type !== '') {
      filterParams.push(type);
      conditions.push(`u.user_type = $${filterParams.length}`);
    }
    if (search && search !== '') {
      filterParams.push(`%${search}%`);
      conditions.push(`(u.name ILIKE $${filterParams.length} OR u.phone ILIKE $${filterParams.length})`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    // Shift $N -> $N+2 so LIMIT=$1 OFFSET=$2 don't conflict
    const whereShifted = whereClause.replace(/\$(\d+)/g, (_: string, n: string) => `$${parseInt(n, 10) + 2}`);

    const [rowsRes, countRes] = await Promise.all([
      query(
        `SELECT u.user_id, u.name, u.phone, u.user_type, u.trust_score, u.is_verified, u.created_at,
                s.plan_id as plan,
                CASE
                  WHEN u.user_type = 'owner' THEN
                    NULLIF(TRIM(COALESCE(op.city,'') || CASE WHEN op.city IS NOT NULL AND op.state IS NOT NULL THEN ', ' ELSE '' END || COALESCE(op.state,'')), '')
                  ELSE wp.current_state
                END as location
         FROM app.users u
         LEFT JOIN app.subscriptions s ON s.user_id = u.user_id AND s.status = 'active'
         LEFT JOIN app.worker_profiles wp ON wp.worker_id = u.user_id
         LEFT JOIN app.owner_profiles op ON op.owner_id = u.user_id
         ${whereShifted}
         ORDER BY u.created_at DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset, ...filterParams],
      ),
      query(
        `SELECT COUNT(*) FROM app.users u ${whereClause}`,
        filterParams,
      ),
    ]);

    return reply.send({
      success: true,
      data: {
        users: rowsRes.rows,
        total: parseInt(countRes.rows[0].count, 10),
        page,
        limit,
      },
      error: null,
    });
  });

  // ── Listings (paginated) ─────────────────────────────────────────────────────
  app.get('/admin/listings', async (req: any, reply) => {
    if (!checkAdminKey(req, reply)) return;

    const page   = Math.max(1, parseInt(req.query.page   ?? '1',  10));
    const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit ?? '20', 10)));
    const offset = (page - 1) * limit;
    const status = req.query.status as string | undefined;

    const params: unknown[] = [limit, offset];
    let whereClause = '';
    if (status && status !== '') {
      params.push(status);
      whereClause = `WHERE l.status = $${params.length}`;
    }

    const [rowsRes, countRes] = await Promise.all([
      query(
        `SELECT l.listing_id, l.title, l.role_code, l.city, l.state, l.status,
                l.created_at, l.pay_min_cents, l.pay_max_cents,
                u.name as owner_name,
                COUNT(o.offer_id) as application_count
         FROM app.listings l
         JOIN app.users u ON u.user_id = l.owner_id
         LEFT JOIN app.offers o ON o.listing_id = l.listing_id
         ${whereClause}
         GROUP BY l.listing_id, u.name
         ORDER BY l.created_at DESC
         LIMIT $1 OFFSET $2`,
        params,
      ),
      query(
        `SELECT COUNT(*) FROM app.listings l ${whereClause}`,
        params.slice(2),
      ),
    ]);

    return reply.send({
      success: true,
      data: {
        listings: rowsRes.rows,
        total: parseInt(countRes.rows[0].count, 10),
        page,
        limit,
      },
      error: null,
    });
  });

  // ── Delete user by phone ─────────────────────────────────────────────────────
  app.delete('/admin/users/by-phone/:phone', async (req: any, reply) => {
    if (!checkAdminKey(req, reply)) return;
    const phone = decodeURIComponent(req.params.phone);
    const userRes = await query(`SELECT user_id, user_type FROM app.users WHERE phone = $1`, [phone]);
    if (!userRes.rows.length) {
      return reply.status(404).send({ success: false, error: 'User not found', data: null });
    }
    const { user_id, user_type } = userRes.rows[0];
    await query(`DELETE FROM app.otps WHERE phone = $1`, [phone]);
    if (user_type === 'worker') {
      await query(`DELETE FROM app.agreements WHERE offer_id IN (SELECT offer_id FROM app.offers WHERE worker_id = $1)`, [user_id]);
      await query(`DELETE FROM app.offers WHERE worker_id = $1`, [user_id]);
      await query(`DELETE FROM app.worker_profiles WHERE worker_id = $1`, [user_id]);
    }
    if (user_type === 'owner') {
      await query(`DELETE FROM app.agreements WHERE offer_id IN (SELECT offer_id FROM app.offers WHERE listing_id IN (SELECT listing_id FROM app.listings WHERE owner_id = $1))`, [user_id]);
      await query(`DELETE FROM app.offers WHERE listing_id IN (SELECT listing_id FROM app.listings WHERE owner_id = $1)`, [user_id]);
      await query(`DELETE FROM app.listings WHERE owner_id = $1`, [user_id]);
      await query(`DELETE FROM app.owner_profiles WHERE owner_id = $1`, [user_id]);
    }
    await query(`DELETE FROM app.users WHERE user_id = $1`, [user_id]);
    return reply.send({ success: true, data: { deleted: user_id, phone }, error: null });
  });

  // ── Activity feed ────────────────────────────────────────────────────────────
  app.get('/admin/activity', async (req: any, reply) => {
    if (!checkAdminKey(req, reply)) return;

    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit ?? '50', 10)));

    const result = await query(
      `SELECT * FROM (
        SELECT 'signup' as type, name as title,
               user_type || ' joined' as subtitle,
               created_at as ts
        FROM app.users ORDER BY created_at DESC LIMIT 10
      ) u
      UNION ALL
      SELECT * FROM (
        SELECT 'listing' as type, title,
               'New listing in ' || COALESCE(city,'') || ', ' || COALESCE(state,'') as subtitle,
               created_at as ts
        FROM app.listings ORDER BY created_at DESC LIMIT 10
      ) l
      UNION ALL
      SELECT * FROM (
        SELECT 'offer' as type, 'New Application' as title,
               'Status: ' || status as subtitle,
               created_at as ts
        FROM app.offers ORDER BY created_at DESC LIMIT 10
      ) o
      UNION ALL
      SELECT * FROM (
        SELECT 'subscription' as type, plan_id as title,
               'Plan activated' as subtitle,
               created_at as ts
        FROM app.subscriptions WHERE status='active' ORDER BY created_at DESC LIMIT 10
      ) s
      ORDER BY ts DESC LIMIT $1`,
      [limit],
    );

    return reply.send({
      success: true,
      data: { events: result.rows },
      error: null,
    });
  });
}
