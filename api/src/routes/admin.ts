/**
 * Admin analytics routes — protected by x-admin-key header matching INTERNAL_SECRET.
 *
 * GET /admin/overview     — KPIs: users, listings, offers, subscriptions, recent signups
 * GET /admin/users        — paginated user list with active plan
 * GET /admin/listings     — paginated listings with owner + application count
 * GET /admin/activity     — recent platform activity feed
 * GET /admin/stats        — full analytics for command centre dashboard
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

  // ── Command Centre stats ─────────────────────────────────────────────────────
  app.get('/admin/stats', async (req: any, reply) => {
    if (!checkAdminKey(req, reply)) return;

    const days = Math.min(90, Math.max(7, parseInt(req.query.days ?? '30', 10)));

    const [
      signupTrendsRes, listingTrendsRes, offerTrendsRes,
      funnelRes,
      workerGeoRes, listingGeoRes,
      jobsByRoleRes, jobsByStatusRes, topOwnersRes,
      offerStatsRes, avgOfferResponseRes,
      payCycleStatsRes,
      trustDistRes,
      agreementStatsRes,
      verificationStatsRes,
    ] = await Promise.all([
      query(
        `SELECT DATE(created_at) as date, user_type, COUNT(*) as count
         FROM app.users
         WHERE created_at >= now() - ($1 * INTERVAL '1 day')
         GROUP BY DATE(created_at), user_type ORDER BY date ASC`,
        [days],
      ),
      query(
        `SELECT DATE(created_at) as date, COUNT(*) as count
         FROM app.listings
         WHERE created_at >= now() - ($1 * INTERVAL '1 day')
         GROUP BY DATE(created_at) ORDER BY date ASC`,
        [days],
      ),
      query(
        `SELECT DATE(created_at) as date, COUNT(*) as count
         FROM app.offers
         WHERE created_at >= now() - ($1 * INTERVAL '1 day')
         GROUP BY DATE(created_at) ORDER BY date ASC`,
        [days],
      ),
      query(`
        SELECT
          (SELECT COUNT(*) FROM app.users)                                          AS registered,
          (SELECT COUNT(*) FROM app.worker_profiles)                                AS worker_profiles,
          (SELECT COUNT(*) FROM app.owner_profiles)                                 AS owner_profiles,
          (SELECT COUNT(DISTINCT worker_id) FROM app.offers)                        AS workers_applied,
          (SELECT COUNT(DISTINCT owner_id)  FROM app.listings)                      AS owners_posted,
          (SELECT COUNT(*) FROM app.offers)                                          AS offers_made,
          (SELECT COUNT(*) FROM app.offers WHERE status = 'accepted')               AS offers_accepted,
          (SELECT COUNT(*) FROM app.agreements)                                      AS agreements,
          (SELECT COUNT(*) FROM app.pay_cycles WHERE status = 'worker_confirmed')   AS pay_confirmed
      `),
      query(
        `SELECT current_state AS state, COUNT(*) AS count
         FROM app.worker_profiles
         WHERE current_state IS NOT NULL AND current_state <> ''
         GROUP BY current_state ORDER BY count DESC LIMIT 15`,
      ),
      query(
        `SELECT state, COUNT(*) AS count
         FROM app.listings
         WHERE state IS NOT NULL AND state <> ''
         GROUP BY state ORDER BY count DESC LIMIT 15`,
      ),
      query(
        `SELECT role_code, COUNT(*) AS count FROM app.listings
         GROUP BY role_code ORDER BY count DESC LIMIT 12`,
      ),
      query(`SELECT status, COUNT(*) AS count FROM app.listings GROUP BY status`),
      query(
        `SELECT u.name AS owner_name,
                COUNT(l.listing_id)                                          AS total,
                COUNT(l.listing_id) FILTER (WHERE l.status = 'active')      AS active,
                MAX(l.created_at)                                            AS last_posted
         FROM app.listings l
         JOIN app.users u ON u.user_id = l.owner_id
         GROUP BY u.user_id, u.name ORDER BY total DESC LIMIT 10`,
      ),
      query(`SELECT status, COUNT(*) AS count FROM app.offers GROUP BY status`),
      query(
        `SELECT ROUND(AVG(EXTRACT(EPOCH FROM (updated_at - created_at)) / 3600.0)::numeric, 1) AS avg_hours
         FROM app.offers WHERE status IN ('accepted','rejected')`,
      ),
      query(`SELECT status, COUNT(*) AS count FROM app.pay_cycles GROUP BY status`),
      query(
        `SELECT
           CASE
             WHEN trust_score < 1 THEN '0–1'
             WHEN trust_score < 2 THEN '1–2'
             WHEN trust_score < 3 THEN '2–3'
             WHEN trust_score < 4 THEN '3–4'
             ELSE '4–5'
           END AS bucket,
           COUNT(*) AS count
         FROM app.users
         GROUP BY bucket ORDER BY bucket`,
      ),
      query(`SELECT status, COUNT(*) AS count FROM app.agreements GROUP BY status`),
      query(
        `SELECT verification_type, status, COUNT(*) AS count
         FROM app.verifications GROUP BY verification_type, status`,
      ),
    ]);

    // ── Build time-series (fill gaps with 0) ──────────────────────────────────
    const dateLabels: string[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      dateLabels.push(d.toISOString().slice(0, 10));
    }

    const workerMap: Record<string, number> = {};
    const ownerMap:  Record<string, number> = {};
    for (const r of signupTrendsRes.rows) {
      const k = new Date(r.date).toISOString().slice(0, 10);
      if (r.user_type === 'worker') workerMap[k] = parseInt(r.count, 10);
      if (r.user_type === 'owner')  ownerMap[k]  = parseInt(r.count, 10);
    }
    const listMap: Record<string, number> = {};
    for (const r of listingTrendsRes.rows) listMap[new Date(r.date).toISOString().slice(0, 10)] = parseInt(r.count, 10);
    const offerMap: Record<string, number> = {};
    for (const r of offerTrendsRes.rows) offerMap[new Date(r.date).toISOString().slice(0, 10)] = parseInt(r.count, 10);

    const trends = dateLabels.map(date => ({
      date: date.slice(5),
      workers:  workerMap[date]  ?? 0,
      owners:   ownerMap[date]   ?? 0,
      listings: listMap[date]    ?? 0,
      offers:   offerMap[date]   ?? 0,
    }));

    // ── Funnel ────────────────────────────────────────────────────────────────
    const f = funnelRes.rows[0];
    const funnel = {
      registered:      parseInt(f.registered,       10),
      worker_profiles: parseInt(f.worker_profiles,  10),
      owner_profiles:  parseInt(f.owner_profiles,   10),
      workers_applied: parseInt(f.workers_applied,  10),
      owners_posted:   parseInt(f.owners_posted,    10),
      offers_made:     parseInt(f.offers_made,      10),
      offers_accepted: parseInt(f.offers_accepted,  10),
      agreements:      parseInt(f.agreements,       10),
      pay_confirmed:   parseInt(f.pay_confirmed,    10),
    };

    // ── Offers ────────────────────────────────────────────────────────────────
    const offerByStatus: Record<string, number> = {};
    for (const r of offerStatsRes.rows) offerByStatus[r.status] = parseInt(r.count, 10);
    const accepted = offerByStatus['accepted'] ?? 0;
    const rejected = offerByStatus['rejected'] ?? 0;
    const acceptanceRate = (accepted + rejected) > 0
      ? Math.round(100 * accepted / (accepted + rejected))
      : null;

    // ── Pay cycles ────────────────────────────────────────────────────────────
    const payByStatus: Record<string, number> = {};
    for (const r of payCycleStatsRes.rows) payByStatus[r.status] = parseInt(r.count, 10);
    const totalCycles = Object.values(payByStatus).reduce((a, b) => a + b, 0);
    const disputeRate = totalCycles > 0
      ? Math.round(10 * 100 * (payByStatus['disputed'] ?? 0) / totalCycles) / 10
      : 0;

    // ── Agreements ────────────────────────────────────────────────────────────
    const agrByStatus: Record<string, number> = {};
    for (const r of agreementStatsRes.rows) agrByStatus[r.status] = parseInt(r.count, 10);

    return reply.send({
      success: true,
      data: {
        trends,
        funnel,
        geo: {
          workers:  workerGeoRes.rows.map((r: any)  => ({ state: r.state,     count: parseInt(r.count, 10) })),
          listings: listingGeoRes.rows.map((r: any) => ({ state: r.state,     count: parseInt(r.count, 10) })),
        },
        jobs: {
          by_role:   jobsByRoleRes.rows.map((r: any)  => ({ role: r.role_code, count: parseInt(r.count, 10) })),
          by_status: jobsByStatusRes.rows.reduce((acc: Record<string, number>, r: any) => { acc[r.status] = parseInt(r.count, 10); return acc; }, {}),
          top_owners: topOwnersRes.rows.map((r: any) => ({
            name:        r.owner_name,
            total:       parseInt(r.total,  10),
            active:      parseInt(r.active, 10),
            last_posted: r.last_posted,
          })),
        },
        offers: {
          by_status:          offerByStatus,
          acceptance_rate:    acceptanceRate,
          avg_response_hours: parseFloat(avgOfferResponseRes.rows[0]?.avg_hours ?? '0'),
        },
        pay: {
          by_status:    payByStatus,
          total:        totalCycles,
          dispute_rate: disputeRate,
        },
        agreements: { by_status: agrByStatus },
        trust: {
          distribution: trustDistRes.rows.map((r: any) => ({ bucket: r.bucket, count: parseInt(r.count, 10) })),
          verifications: verificationStatsRes.rows.map((r: any) => ({
            type:   r.verification_type,
            status: r.status,
            count:  parseInt(r.count, 10),
          })),
        },
      },
      error: null,
    });
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
