-- RasoiLink: Subscription & billing tables
-- Run with: psql $DATABASE_URL -f migration_subscriptions.sql

BEGIN;

-- Plans reference table
CREATE TABLE IF NOT EXISTS app.plans (
  plan_id       TEXT PRIMARY KEY,                  -- 'free' | 'starter' | 'growth' | 'worker_boost'
  display_name  TEXT        NOT NULL,
  user_type     TEXT        NOT NULL CHECK (user_type IN ('owner', 'worker', 'any')),
  price_cents   INTEGER     NOT NULL DEFAULT 0,
  interval      TEXT        NOT NULL DEFAULT 'month' CHECK (interval IN ('month', 'year', 'one_time')),
  max_job_posts INTEGER,                            -- NULL = unlimited
  can_view_contacts BOOLEAN NOT NULL DEFAULT false,
  has_ai_match  BOOLEAN     NOT NULL DEFAULT false,
  has_whatsapp  BOOLEAN     NOT NULL DEFAULT false,
  is_active     BOOLEAN     NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed the 4 plans
INSERT INTO app.plans (plan_id, display_name, user_type, price_cents, interval, max_job_posts, can_view_contacts, has_ai_match, has_whatsapp)
VALUES
  ('free',         'Free',          'owner',  0,    'month', 1,    false, false, false),
  ('starter',      'Starter',       'owner',  3900, 'month', 5,    true,  true,  false),
  ('growth',       'Growth',        'owner',  9900, 'month', NULL, true,  true,  true),
  ('worker_boost', 'Worker Boost',  'worker', 700,  'month', NULL, false, false, true)
ON CONFLICT (plan_id) DO NOTHING;

-- Subscriptions: one active row per user
CREATE TABLE IF NOT EXISTS app.subscriptions (
  subscription_id     TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id             TEXT        NOT NULL REFERENCES app.users(user_id) ON DELETE CASCADE,
  plan_id             TEXT        NOT NULL REFERENCES app.plans(plan_id),
  stripe_customer_id  TEXT        UNIQUE,           -- cus_xxx
  stripe_sub_id       TEXT        UNIQUE,           -- sub_xxx (NULL for free/one-time)
  status              TEXT        NOT NULL DEFAULT 'active'
                                  CHECK (status IN ('active','cancelled','past_due','trialing')),
  current_period_start TIMESTAMPTZ,
  current_period_end   TIMESTAMPTZ,
  cancelled_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_user_active_idx
  ON app.subscriptions(user_id)
  WHERE status = 'active';

-- Transactions: every charge we record here
CREATE TABLE IF NOT EXISTS app.billing_transactions (
  tx_id               TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id             TEXT        NOT NULL REFERENCES app.users(user_id) ON DELETE CASCADE,
  stripe_payment_id   TEXT,                         -- pi_xxx or cs_xxx
  tx_type             TEXT        NOT NULL
                                  CHECK (tx_type IN ('subscription','hire_fee','job_boost','course','background_check','whatsapp_alert')),
  amount_cents        INTEGER     NOT NULL,
  currency            TEXT        NOT NULL DEFAULT 'usd',
  status              TEXT        NOT NULL DEFAULT 'pending'
                                  CHECK (status IN ('pending','succeeded','failed','refunded')),
  description         TEXT,
  metadata            JSONB       DEFAULT '{}',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Track job post usage per owner (for plan gating)
CREATE TABLE IF NOT EXISTS app.job_post_usage (
  user_id         TEXT        PRIMARY KEY REFERENCES app.users(user_id) ON DELETE CASCADE,
  posts_used      INTEGER     NOT NULL DEFAULT 0,
  period_start    TIMESTAMPTZ NOT NULL DEFAULT date_trunc('month', now()),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Auto-update updated_at on subscriptions
CREATE OR REPLACE FUNCTION app.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS subscriptions_updated_at ON app.subscriptions;
CREATE TRIGGER subscriptions_updated_at
  BEFORE UPDATE ON app.subscriptions
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- Give every existing user a free subscription row
INSERT INTO app.subscriptions (user_id, plan_id, status)
SELECT user_id, 'free', 'active'
FROM app.users
ON CONFLICT DO NOTHING;

-- Give every existing owner a usage row
INSERT INTO app.job_post_usage (user_id)
SELECT user_id FROM app.users WHERE user_type = 'owner'
ON CONFLICT DO NOTHING;

COMMIT;
