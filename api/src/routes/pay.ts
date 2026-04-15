import { createNotification } from './notifications.js';
import { FastifyInstance }    from 'fastify';
import { query }              from '../db.js';
import { stripe, PRICES, PLAN_FROM_PRICE, PlanId } from '../stripe.js';

// ─────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────

/** Return the active subscription row for a user (never null — free row always exists) */
async function getSubscription(user_id: string) {
  const res = await query<any>(
    `SELECT s.*, p.max_job_posts, p.can_view_contacts, p.has_ai_match, p.has_whatsapp
     FROM app.subscriptions s
     JOIN app.plans p ON s.plan_id = p.plan_id
     WHERE s.user_id = $1 AND s.status = 'active'
     LIMIT 1`,
    [user_id],
  );
  return res.rows[0] ?? null;
}

/** Upsert subscription plan for a user */
async function upsertSubscription(
  user_id: string,
  plan_id: PlanId,
  stripe_customer_id: string,
  stripe_sub_id: string | null,
  period_end: Date | null,
) {
  await query(
    `INSERT INTO app.subscriptions
       (user_id, plan_id, stripe_customer_id, stripe_sub_id, status, current_period_end)
     VALUES ($1, $2, $3, $4, 'active', $5)
     ON CONFLICT (user_id) WHERE status = 'active'
     DO UPDATE SET
       plan_id              = EXCLUDED.plan_id,
       stripe_customer_id   = EXCLUDED.stripe_customer_id,
       stripe_sub_id        = EXCLUDED.stripe_sub_id,
       status               = 'active',
       current_period_end   = EXCLUDED.current_period_end,
       updated_at           = now()`,
    [user_id, plan_id, stripe_customer_id, stripe_sub_id, period_end],
  );
}

/** Record a billing transaction */
async function recordTransaction(
  user_id: string,
  stripe_payment_id: string,
  tx_type: string,
  amount_cents: number,
  description: string,
  metadata: object = {},
) {
  await query(
    `INSERT INTO app.billing_transactions
       (user_id, stripe_payment_id, tx_type, amount_cents, status, description, metadata)
     VALUES ($1, $2, $3, $4, 'succeeded', $5, $6)`,
    [user_id, stripe_payment_id, tx_type, amount_cents, description, JSON.stringify(metadata)],
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────────────────────────

export async function payRoutes(app: FastifyInstance) {

  // ── EXISTING ROUTES (unchanged) ──────────────────────────────────────────

  // GET /workers/:id/pay
  app.get<{ Params: { id: string } }>('/workers/:id/pay', {
    preHandler: [app.authenticate],
  }, async (req, reply) => {
    const result = await query(`
      SELECT
        pc.cycle_id, pc.agreement_id, pc.owner_id, pc.status,
        pc.period_start, pc.period_end, pc.due_date,
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

    const cycles = result.rows;
    const totalEarned = cycles
      .filter((c: any) => ['owner_confirmed','worker_confirmed','resolved'].includes(c.status))
      .reduce((sum: number, c: any) => sum + (c.owner_amount_paid_cents ?? 0), 0);
    const onTimeCount = cycles.filter((c: any) => c.status === 'worker_confirmed' || c.status === 'owner_confirmed').length;
    const lateCount   = cycles.filter((c: any) => c.status === 'late' || c.status === 'disputed').length;

    return reply.send({
      success: true,
      data: { cycles, summary: { totalEarned, onTimeCount, lateCount, totalCycles: cycles.length } },
      error: null,
    });
  });

  // GET /workers/:id/ratings
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

    const avg = (key: string) => {
      const vals = ratings.map((r: any) => r[key]).filter((v: any) => v != null);
      return vals.length ? (vals.reduce((a: number, b: number) => a + b, 0) / vals.length).toFixed(1) : null;
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

  // GET /owners/:id/ratings — owner's trust score and ratings from workers
  app.get<{ Params: { id: string } }>('/owners/:id/ratings', {
    preHandler: [app.authenticate],
  }, async (req, reply) => {
    const [ratingsRes, userRes] = await Promise.all([
      query(`
        SELECT
          r.rating_id, r.period_month, r.rater_type,
          r.dim_pay_reliability, r.dim_communication, r.dim_overall,
          r.private_note, r.submitted_at,
          u.name as rater_name
        FROM app.ratings r
        JOIN app.users u ON r.rater_id = u.user_id
        WHERE r.rated_id = $1
        ORDER BY r.submitted_at DESC
      `, [req.params.id]),
      query(`SELECT trust_score, is_verified FROM app.users WHERE user_id = $1`, [req.params.id]),
    ]);

    const ratings = ratingsRes.rows;
    const user    = userRes.rows[0];
    const avg = (key: string) => {
      const vals = ratings.map((r: any) => r[key]).filter((v: any) => v != null);
      return vals.length ? (vals.reduce((a: number, b: number) => a + b, 0) / vals.length).toFixed(1) : null;
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
        },
        total_ratings: ratings.length,
      },
      error: null,
    });
  });

  // PATCH /pay/:id/confirm
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
    const pcRow2 = result.rows[0];
    const workerNameRes = await query('SELECT name FROM app.users WHERE user_id = $1', [pcRow2.worker_id]);
    await createNotification({
      user_id: pcRow2.owner_id,
      event_type: 'pay_confirmed',
      title: '✅ Payment Confirmed!',
      body: `${workerNameRes.rows[0]?.name} confirmed they received their payment.`,
      related_entity_id: pcRow2.cycle_id,
      related_entity_type: 'pay_cycle',
      dedup_key: `pay_confirmed_${pcRow2.cycle_id}`,
    });
    return reply.send({ success: true, data: result.rows[0], error: null });
  });

  // PATCH /pay/:id/owner-confirm
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
    const pcRow = result.rows[0];
    const ownerNameRes = await query('SELECT name FROM app.users WHERE user_id = $1', [pcRow.owner_id]);
    await createNotification({
      user_id: pcRow.worker_id,
      event_type: 'pay_sent',
      title: '💰 Payment Sent!',
      body: `${ownerNameRes.rows[0]?.name} marked your payment of $${Math.round(amount_cents / 100)} as sent.`,
      related_entity_id: pcRow.cycle_id,
      related_entity_type: 'pay_cycle',
      dedup_key: `pay_sent_${pcRow.cycle_id}`,
    });
    return reply.send({ success: true, data: result.rows[0], error: null });
  });

  // GET /owners/:id/pay
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
    const totalPaid    = cycles.filter((c: any) => c.owner_amount_paid_cents).reduce((s: number, c: any) => s + c.owner_amount_paid_cents, 0);
    const pendingCount = cycles.filter((c: any) => c.status === 'scheduled' || c.status === 'late').length;

    return reply.send({
      success: true,
      data: { cycles, summary: { totalPaid, pendingCount, totalCycles: cycles.length } },
      error: null,
    });
  });

  // POST /ratings
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

  // ── NEW: STRIPE BILLING ROUTES ────────────────────────────────────────────

  /**
   * GET /billing/subscription
   * Returns the current user's active plan + feature flags
   */
  app.get('/billing/subscription', {
    preHandler: [app.authenticate],
  }, async (req: any, reply) => {
    const sub = await getSubscription(req.user.user_id);
    if (!sub) {
      return reply.send({
        success: true,
        data: { plan_id: 'free', status: 'active', can_view_contacts: false, has_ai_match: false, max_job_posts: 1 },
        error: null,
      });
    }
    return reply.send({ success: true, data: sub, error: null });
  });

  /**
   * POST /billing/checkout
   * Creates a Stripe Checkout session and returns the URL.
   * Body: { price_id: string, tx_type: string, success_url: string, cancel_url: string }
   *
   * tx_type is one of: 'subscription' | 'hire_fee' | 'job_boost' | 'course' | 'background_check'
   */
  app.post('/billing/checkout', {
    preHandler: [app.authenticate],
  }, async (req: any, reply) => {
    const { price_id, tx_type, success_url, cancel_url, metadata = {} } = req.body as any;

    if (!price_id || !tx_type || !success_url || !cancel_url) {
      return reply.status(400).send({ success: false, error: 'price_id, tx_type, success_url, cancel_url are required', data: null });
    }

    // Look up user
    const userRes = await query<any>(
      'SELECT user_id, name, phone FROM app.users WHERE user_id = $1',
      [req.user.user_id],
    );
    const user = userRes.rows[0];
    if (!user) return reply.status(404).send({ success: false, error: 'User not found', data: null });

    // Get or create Stripe customer
    let stripe_customer_id: string | undefined;
    const subRes = await query<any>(
      'SELECT stripe_customer_id FROM app.subscriptions WHERE user_id = $1 LIMIT 1',
      [user.user_id],
    );
    stripe_customer_id = subRes.rows[0]?.stripe_customer_id ?? undefined;

    if (!stripe_customer_id) {
      const customer = await stripe.customers.create({
        name:     user.name,
        phone:    user.phone,
        metadata: { user_id: user.user_id, user_type: req.user.user_type },
      });
      stripe_customer_id = customer.id;
    }

    const isSubscription = tx_type === 'subscription';

    const session = await stripe.checkout.sessions.create({
      customer:             stripe_customer_id,
      mode:                 isSubscription ? 'subscription' : 'payment',
      payment_method_types: ['card'],
      line_items: [{ price: price_id, quantity: 1 }],
      success_url: `${success_url}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url,
      metadata: {
        user_id:   user.user_id,
        tx_type,
        price_id,
        ...metadata,
      },
      ...(isSubscription && {
        subscription_data: {
          metadata: { user_id: user.user_id },
        },
      }),
    });

    return reply.send({ success: true, data: { url: session.url, session_id: session.id }, error: null });
  });

  /**
   * POST /billing/portal
   * Creates a Stripe Customer Portal session so users can self-manage billing.
   * Body: { return_url: string }
   */
  app.post('/billing/portal', {
    preHandler: [app.authenticate],
  }, async (req: any, reply) => {
    const { return_url } = req.body as any;
    if (!return_url) {
      return reply.status(400).send({ success: false, error: 'return_url is required', data: null });
    }

    const subRes = await query<any>(
      'SELECT stripe_customer_id FROM app.subscriptions WHERE user_id = $1 LIMIT 1',
      [req.user.user_id],
    );
    const stripe_customer_id = subRes.rows[0]?.stripe_customer_id;

    if (!stripe_customer_id) {
      return reply.status(400).send({ success: false, error: 'No billing account found. Subscribe to a plan first.', data: null });
    }

    const portalSession = await stripe.billingPortal.sessions.create({
      customer:   stripe_customer_id,
      return_url,
    });

    return reply.send({ success: true, data: { url: portalSession.url }, error: null });
  });

  /**
   * POST /billing/webhook
   * Receives and verifies Stripe webhook events.
   * IMPORTANT: must be registered with rawBody support (see index.ts note below).
   */
  app.post('/billing/webhook', {
    config: { rawBody: true },   // Fastify needs raw body for signature verification
  }, async (req: any, reply) => {
    const sig       = req.headers['stripe-signature'] as string;
    const secret    = process.env.STRIPE_WEBHOOK_SECRET ?? '';
    const rawBody   = (req.rawBody ?? req.body) as Buffer | string;


let event: any;
    try {
      event = stripe.webhooks.constructEvent(rawBody, sig, secret);
    } catch (err: any) {
      app.log.warn(`Webhook signature failed: ${err.message}`);
      return reply.status(400).send({ error: `Webhook Error: ${err.message}` });
    }

    app.log.info(`Stripe event: ${event.type}`);

    // ── Handle events ────────────────────────────────────────────────────────

    if (event.type === 'checkout.session.completed') {
      const session   = event.data.object as any;
      const user_id   = session.metadata?.user_id;
      const tx_type   = session.metadata?.tx_type;
      const price_id  = session.metadata?.price_id;

      if (!user_id) {
        app.log.warn('checkout.session.completed missing user_id in metadata');
        return reply.send({ received: true });
      }

      if (tx_type === 'subscription') {
        // Subscription checkout — plan upgrade
        const plan_id: PlanId = PLAN_FROM_PRICE[price_id] ?? 'free';
        const sub = session.subscription
          ? await stripe.subscriptions.retrieve(session.subscription)
          : null;

        await upsertSubscription(
          user_id,
          plan_id,
          session.customer,
          session.subscription ?? null,
          sub && (sub as any).current_period_end ? new Date((sub as any).current_period_end * 1000) : null,
        );

        await recordTransaction(
          user_id,
          session.payment_intent ?? session.id,
          'subscription',
          session.amount_total ?? 0,
          `Subscribed to ${plan_id} plan`,
          { plan_id, session_id: session.id },
        );

        app.log.info(`User ${user_id} upgraded to ${plan_id}`);

      } else {
        // One-time payment (hire fee, boost, course, etc.)
        const amount = session.amount_total ?? 0;

        await recordTransaction(
          user_id,
          session.payment_intent ?? session.id,
          tx_type,
          amount,
          `One-time: ${tx_type}`,
          { session_id: session.id, ...session.metadata },
        );

        // For hire fee — store against the listing if listing_id was passed
        if (tx_type === 'hire_fee' && session.metadata?.listing_id) {
          await query(
            `UPDATE app.listings SET hire_fee_paid = true WHERE listing_id = $1`,
            [session.metadata.listing_id],
          ).catch(() => {});
        }

        // For job boost — mark listing as boosted for 7 days
        if (tx_type === 'job_boost' && session.metadata?.listing_id) {
          await query(
            `UPDATE app.listings 
              SET is_boosted = true, 
                  boosted_until = now() + interval '7 days'
              WHERE listing_id = $1`,
            [session.metadata.listing_id],
          ).catch(() => {});
          app.log.info(`Listing ${session.metadata.listing_id} boosted for 7 days`);
        }

        app.log.info(`One-time payment ${tx_type} recorded for user ${user_id}`);
      }
    }

    else if (event.type === 'customer.subscription.updated') {
      const sub     = event.data.object as any;
      const user_id = sub.metadata?.user_id;
      if (!user_id) return reply.send({ received: true });

      const plan_id: PlanId = PLAN_FROM_PRICE[sub.items.data[0]?.price?.id] ?? 'free';

      await query(
        `UPDATE app.subscriptions
         SET plan_id = $1, status = $2, current_period_end = $3, updated_at = now()
         WHERE user_id = $4`,
        [plan_id, sub.status, new Date(sub.current_period_end * 1000), user_id],
      );
    }

    else if (event.type === 'customer.subscription.deleted') {
      const sub     = event.data.object as any;
      const user_id = sub.metadata?.user_id;
      if (!user_id) return reply.send({ received: true });

      // Downgrade to free
      await query(
        `UPDATE app.subscriptions
         SET plan_id = 'free', status = 'cancelled', stripe_sub_id = NULL,
             cancelled_at = now(), updated_at = now()
         WHERE user_id = $1`,
        [user_id],
      );

      app.log.info(`User ${user_id} cancelled — downgraded to free`);
    }

    else if (event.type === 'invoice.payment_failed') {
      const invoice = event.data.object as any;
      const customer_id = invoice.customer;

      await query(
        `UPDATE app.subscriptions SET status = 'past_due', updated_at = now()
         WHERE stripe_customer_id = $1`,
        [customer_id],
      );

      app.log.warn(`Payment failed for Stripe customer ${customer_id}`);
    }

    return reply.send({ received: true });
  });
}
