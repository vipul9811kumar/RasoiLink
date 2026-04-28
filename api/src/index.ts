import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { authRoutes }    from './routes/auth.js';
import { workerRoutes }  from './routes/workers.js';
import { ownerRoutes }   from './routes/owners.js';
import { listingRoutes } from './routes/listings.js';
import { chatRoutes }    from './routes/chat.js';
import { offerRoutes }   from './routes/offers.js';
import { payRoutes }          from './routes/pay.js';
import { notificationRoutes } from './routes/notifications.js';
import { otpRoutes }           from './routes/otp.js';
import { waitlistRoutes }      from './routes/waitlist.js';
import { devRoutes }           from './routes/dev.js';
import { adminRoutes }         from './routes/admin.js';
import { AuthUser } from './types.js';
import { query }    from './db.js';

const PORT = parseInt(process.env.PORT ?? '3000', 10);

// Fix generate_pay_cycles: 'Dy' (e.g. 'Fri') vs initcap (e.g. 'Friday') never matched → infinite loop.
// Also fixes weekly_pay_cents which incorrectly multiplied by hours.
async function patchDbFunctions() {
  try {
    await query(`
      CREATE OR REPLACE FUNCTION app.generate_pay_cycles(p_agreement_id TEXT)
      RETURNS INTEGER LANGUAGE plpgsql AS $fn$
      DECLARE
        agr               app.agreements%ROWTYPE;
        cycle_start       DATE;
        cycle_end         DATE;
        cycle_due         DATE;
        cycles_created    INTEGER := 0;
        horizon           DATE;
        freq_days         INTEGER;
      BEGIN
        SELECT * INTO agr FROM app.agreements WHERE agreement_id = p_agreement_id;

        IF agr.status <> 'active' THEN
          RAISE EXCEPTION 'Agreement % is not active (status: %)', p_agreement_id, agr.status;
        END IF;

        horizon := agr.start_date + INTERVAL '6 months';

        freq_days := CASE agr.pay_frequency
          WHEN 'weekly'      THEN 7
          WHEN 'biweekly'    THEN 14
          WHEN 'semimonthly' THEN 15
        END;

        cycle_start := agr.start_date;

        WHILE cycle_start < horizon LOOP
          cycle_end := cycle_start + (freq_days - 1);
          cycle_due := cycle_end + 2;

          -- Use full day name ('Friday') to match pay_day_enum initcap
          WHILE trim(to_char(cycle_due, 'Day')) != initcap(agr.pay_day::TEXT) LOOP
            cycle_due := cycle_due + 1;
          END LOOP;

          INSERT INTO app.pay_cycles (
            agreement_id, worker_id, owner_id,
            period_start, period_end, due_date,
            expected_amount_cents
          ) VALUES (
            agr.agreement_id, agr.worker_id, agr.owner_id,
            cycle_start, cycle_end, cycle_due,
            agr.agreed_pay_cents * (freq_days / 7)
          )
          ON CONFLICT (agreement_id, period_start) DO NOTHING;

          cycles_created := cycles_created + 1;
          cycle_start := cycle_start + freq_days;
        END LOOP;

        RETURN cycles_created;
      END;
      $fn$;
    `);
    console.log('[startup] DB function patch applied: generate_pay_cycles');
  } catch (e: any) {
    console.error('[startup] DB function patch failed:', e.message);
  }

  // Ensure hire_fee_paid column exists on listings (not in original migration)
  try {
    await query(`ALTER TABLE app.listings ADD COLUMN IF NOT EXISTS hire_fee_paid BOOLEAN NOT NULL DEFAULT false`);
    console.log('[startup] hire_fee_paid column ensured on app.listings');
  } catch (e: any) {
    console.error('[startup] hire_fee_paid patch failed:', e.message);
  }
}
const IS_DEV = process.env.NODE_ENV !== 'production';

const app = Fastify({
  logger: {
    level: 'info',
    transport: IS_DEV ? { target: 'pino-pretty', options: { colorize: true } } : undefined,
  },
});

await app.register(cors, {
  origin: true,
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
});

await app.register(jwt, {
  secret: process.env.JWT_SECRET ?? 'dev_secret',
});

// Required for Stripe webhook signature verification
await app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
  (req as any).rawBody = body;
  try { done(null, JSON.parse(body.toString())); }
  catch (e: any) { done(e, undefined); }
});

// Auth decorator
app.decorate('authenticate', async (req: any, reply: any) => {
  try {
    const payload = await req.jwtVerify() as AuthUser;
    req.user = payload;
  } catch {
    reply.status(401).send({ success: false, error: 'Unauthorized', data: null });
  }
});

// Normalize all unhandled errors to {success, error, data} so the mobile can always read them
app.setErrorHandler((err, _req, reply) => {
  app.log.error(err);
  const status = err.statusCode ?? 500;
  reply.status(status).send({ success: false, error: err.message ?? 'Internal server error', data: null });
});

// Serve admin dashboard at /admin
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const adminHtml = readFileSync(path.join(__dirname, '../public/admin.html'), 'utf-8');
app.get('/admin', async (_req, reply) => {
  return reply.type('text/html').send(adminHtml);
});

// Health check
app.get('/health', async () => ({
  status: 'ok',
  service: 'rasoilink-api',
  version: '1.0.0',
}));

// Routes
await app.register(authRoutes);
await app.register(workerRoutes);
await app.register(ownerRoutes);
await app.register(listingRoutes);
await app.register(chatRoutes);
await app.register(offerRoutes);
await app.register(payRoutes);
await app.register(notificationRoutes);
await app.register(otpRoutes);
await app.register(waitlistRoutes);
await app.register(devRoutes);
await app.register(adminRoutes);

await patchDbFunctions();

try {
  await app.listen({ port: PORT, host: process.env.HOST ?? '0.0.0.0' });
  app.log.info(`RasoiLink API running on port ${PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
