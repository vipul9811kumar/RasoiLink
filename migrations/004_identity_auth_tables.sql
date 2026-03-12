-- =============================================================================
-- Migration: 004_identity_auth_tables.sql
-- Description: users, worker_profiles, owner_profiles, verifications, auth_tokens
-- Author: RasoiLink Engineering
-- Created: 2026-03-10
-- Dependencies: 001, 002, 003
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- app.users
-- Central user account. Single table for all user types.
-- Extended profile lives in worker_profiles or owner_profiles.
-- ---------------------------------------------------------------------------

CREATE TABLE app.users (
  user_id        TEXT                  NOT NULL PRIMARY KEY DEFAULT gen_ulid(),
  phone          VARCHAR(20)           NOT NULL,
  user_type      public.user_type_enum NOT NULL,
  name           VARCHAR(120)          NOT NULL,
  language_code  CHAR(2)               NOT NULL DEFAULT 'en',
  password_hash  CHAR(60)              NOT NULL,
  fcm_token      VARCHAR(512),
  trust_score    NUMERIC(3,2)          NOT NULL DEFAULT 0.00
                   CHECK (trust_score >= 0.00 AND trust_score <= 5.00),
  is_verified    BOOLEAN               NOT NULL DEFAULT false,
  is_active      BOOLEAN               NOT NULL DEFAULT true,
  last_login_at  TIMESTAMPTZ,
  created_at     TIMESTAMPTZ           NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ           NOT NULL DEFAULT now(),

  CONSTRAINT chk_users_language
    CHECK (language_code IN ('en','hi','te','pa','gu','ta','kn','ml','bn')),

  CONSTRAINT chk_users_phone_format
    CHECK (phone ~ '^\+[1-9]\d{7,14}$')   -- E.164 format
);

COMMENT ON TABLE  app.users IS 'Central user account for all user types. login identifier = phone.';
COMMENT ON COLUMN app.users.user_id       IS 'ULID — sortable, URL-safe 26-char ID';
COMMENT ON COLUMN app.users.phone         IS 'E.164 format. Primary login identifier. Unique.';
COMMENT ON COLUMN app.users.password_hash IS 'bcrypt hash (cost 12). Never returned via API.';
COMMENT ON COLUMN app.users.trust_score   IS '0.00–5.00 composite rating. Updated by trigger.';
COMMENT ON COLUMN app.users.is_active     IS 'Soft delete. false = suspended. Never hard-delete.';

-- Unique index on phone (login lookup)
CREATE UNIQUE INDEX idx_users_phone     ON app.users(phone);
CREATE INDEX        idx_users_type      ON app.users(user_type);
CREATE INDEX        idx_users_trust     ON app.users(trust_score DESC) WHERE is_active = true;
CREATE INDEX        idx_users_active    ON app.users(is_active, user_type);
-- Trigram index for name search
CREATE INDEX        idx_users_name_trgm ON app.users USING gin(name gin_trgm_ops);


-- ---------------------------------------------------------------------------
-- TRIGGER: auto-update updated_at on users
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON app.users
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();


-- ---------------------------------------------------------------------------
-- app.worker_profiles
-- Extended job-seeker profile. 1:1 with users (user_type = 'worker').
-- All columns used as match engine dimensions.
-- ---------------------------------------------------------------------------

CREATE TABLE app.worker_profiles (
  worker_id              TEXT                    NOT NULL PRIMARY KEY,
  role_code              VARCHAR(40)             NOT NULL,
  years_experience       SMALLINT                NOT NULL DEFAULT 0
                           CHECK (years_experience >= 0 AND years_experience <= 60),
  cuisine_specializations TEXT[]                 NOT NULL DEFAULT '{}',
  current_city           VARCHAR(80),
  current_state          CHAR(2)                 NOT NULL,
  preferred_states       CHAR(2)[]               NOT NULL DEFAULT '{}',
  willing_to_relocate    BOOLEAN                 NOT NULL DEFAULT true,
  salary_min_cents       INTEGER                 NOT NULL CHECK (salary_min_cents > 0),
  salary_max_cents       INTEGER                 NOT NULL CHECK (salary_max_cents >= salary_min_cents),
  pay_freq_pref          public.pay_freq_enum    NOT NULL DEFAULT 'weekly',
  needs_accommodation    BOOLEAN                 NOT NULL DEFAULT false,
  work_authorization     public.work_auth_enum   NOT NULL DEFAULT 'authorized',
  profile_completeness   SMALLINT                NOT NULL DEFAULT 0
                           CHECK (profile_completeness BETWEEN 0 AND 100),
  bio_text               TEXT,
  bio_audio_url          TEXT,
  updated_at             TIMESTAMPTZ             NOT NULL DEFAULT now(),

  CONSTRAINT fk_wp_user
    FOREIGN KEY (worker_id) REFERENCES app.users(user_id)
    ON DELETE CASCADE,

  CONSTRAINT fk_wp_role
    FOREIGN KEY (role_code) REFERENCES ref.role_codes(code)
);

COMMENT ON TABLE  app.worker_profiles IS '1:1 extension of users for workers. worker_id = users.user_id.';
COMMENT ON COLUMN app.worker_profiles.salary_min_cents IS 'Expected hourly minimum pay in US cents (e.g. 2000 = $20.00/hr).';
COMMENT ON COLUMN app.worker_profiles.work_authorization IS 'NEVER returned in match API responses. Hard-gate use only.';
COMMENT ON COLUMN app.worker_profiles.profile_completeness IS '0–100. Computed by trigger on each UPDATE.';

-- Core match engine indexes
CREATE INDEX idx_wp_role_state    ON app.worker_profiles(role_code, current_state);
CREATE INDEX idx_wp_salary        ON app.worker_profiles(salary_min_cents, salary_max_cents);
CREATE INDEX idx_wp_cuisine       ON app.worker_profiles USING gin(cuisine_specializations);
CREATE INDEX idx_wp_pref_states   ON app.worker_profiles USING gin(preferred_states);
CREATE INDEX idx_wp_accommodation ON app.worker_profiles(needs_accommodation) WHERE needs_accommodation = true;
CREATE INDEX idx_wp_experience    ON app.worker_profiles(role_code, years_experience);

CREATE TRIGGER trg_wp_updated_at
  BEFORE UPDATE ON app.worker_profiles
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();


-- ---------------------------------------------------------------------------
-- TRIGGER: compute profile_completeness on worker_profiles
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app.compute_worker_completeness()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  score INTEGER := 0;
  max_score INTEGER := 10;
BEGIN
  IF NEW.role_code              IS NOT NULL THEN score := score + 1; END IF;
  IF NEW.years_experience       IS NOT NULL THEN score := score + 1; END IF;
  IF array_length(NEW.cuisine_specializations, 1) > 0 THEN score := score + 1; END IF;
  IF NEW.current_state          IS NOT NULL THEN score := score + 1; END IF;
  IF array_length(NEW.preferred_states, 1)    > 0 THEN score := score + 1; END IF;
  IF NEW.salary_min_cents       IS NOT NULL THEN score := score + 1; END IF;
  IF NEW.salary_max_cents       IS NOT NULL THEN score := score + 1; END IF;
  IF NEW.work_authorization     IS NOT NULL THEN score := score + 1; END IF;
  IF NEW.bio_text               IS NOT NULL AND length(NEW.bio_text) > 20 THEN score := score + 1; END IF;
  IF NEW.bio_audio_url          IS NOT NULL THEN score := score + 1; END IF;

  NEW.profile_completeness := ROUND((score::NUMERIC / max_score) * 100)::SMALLINT;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_worker_completeness
  BEFORE INSERT OR UPDATE ON app.worker_profiles
  FOR EACH ROW EXECUTE FUNCTION app.compute_worker_completeness();


-- ---------------------------------------------------------------------------
-- app.owner_profiles
-- Extended restaurant owner profile. 1:1 with users (user_type = 'owner').
-- ---------------------------------------------------------------------------

CREATE TABLE app.owner_profiles (
  owner_id               TEXT         NOT NULL PRIMARY KEY,
  restaurant_name        VARCHAR(160) NOT NULL,
  restaurant_address     TEXT         NOT NULL,
  city                   VARCHAR(80)  NOT NULL,
  state                  CHAR(2)      NOT NULL,
  zip_code               VARCHAR(10)  NOT NULL,
  cuisine_types          TEXT[]       NOT NULL DEFAULT '{}',
  seat_count             SMALLINT     CHECK (seat_count > 0),
  staff_count            SMALLINT     CHECK (staff_count >= 0) DEFAULT 0,
  -- Encrypted document storage
  business_license_url   TEXT,                         -- S3 URL, AES-256 encrypted
  ein_last4              CHAR(4),                      -- Last 4 digits for display only
  ein_encrypted          TEXT,                         -- AES-256-GCM encrypted full EIN
  biz_verified           BOOLEAN      NOT NULL DEFAULT false,
  biz_verified_at        TIMESTAMPTZ,
  -- Computed pay reliability (from pay_cycles)
  pay_reliability_score  NUMERIC(3,2) NOT NULL DEFAULT 0.00
                           CHECK (pay_reliability_score >= 0.00 AND pay_reliability_score <= 5.00),
  updated_at             TIMESTAMPTZ  NOT NULL DEFAULT now(),

  CONSTRAINT fk_op_user
    FOREIGN KEY (owner_id) REFERENCES app.users(user_id)
    ON DELETE RESTRICT   -- Never cascade-delete owners — preserve pay/agreement history
);

COMMENT ON TABLE  app.owner_profiles IS '1:1 extension of users for restaurant owners. owner_id = users.user_id.';
COMMENT ON COLUMN app.owner_profiles.ein_encrypted IS 'AES-256-GCM encrypted. Key managed in AWS KMS. Never query directly.';
COMMENT ON COLUMN app.owner_profiles.pay_reliability_score IS 'Computed from pay_cycles. Updated by trigger.';

CREATE INDEX idx_op_state       ON app.owner_profiles(state);
CREATE INDEX idx_op_cuisine     ON app.owner_profiles USING gin(cuisine_types);
CREATE INDEX idx_op_verified    ON app.owner_profiles(biz_verified) WHERE biz_verified = true;
CREATE INDEX idx_op_pay_rel     ON app.owner_profiles(pay_reliability_score DESC);
CREATE INDEX idx_op_name_trgm   ON app.owner_profiles USING gin(restaurant_name gin_trgm_ops);

CREATE TRIGGER trg_op_updated_at
  BEFORE UPDATE ON app.owner_profiles
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();


-- ---------------------------------------------------------------------------
-- app.verifications
-- One row per verification attempt per user per type.
-- Immutable after creation — status updates only.
-- ---------------------------------------------------------------------------

CREATE TABLE app.verifications (
  verification_id        TEXT                                  NOT NULL PRIMARY KEY DEFAULT gen_ulid(),
  user_id                TEXT                                  NOT NULL,
  verification_type      public.verification_type_enum         NOT NULL,
  status                 public.verification_status_enum       NOT NULL DEFAULT 'pending',
  provider               VARCHAR(40),         -- e.g. 'persona', 'stripe_identity', 'manual'
  provider_job_id        VARCHAR(120),        -- Third-party reference ID
  document_type          VARCHAR(40),         -- 'passport', 'state_id', 'aadhar', 'ein'
  document_url_encrypted TEXT,                -- S3 URL, AES-256. IAM-restricted.
  passed_at              TIMESTAMPTZ,
  expires_at             TIMESTAMPTZ,         -- Annual re-verification required
  failure_reason         TEXT,
  created_at             TIMESTAMPTZ          NOT NULL DEFAULT now(),

  CONSTRAINT fk_ver_user
    FOREIGN KEY (user_id) REFERENCES app.users(user_id) ON DELETE CASCADE
);

COMMENT ON TABLE app.verifications IS
  'Audit trail for verification checks. Never hard-delete. Status-only updates allowed.';

CREATE INDEX idx_ver_user_type   ON app.verifications(user_id, verification_type, status);
CREATE INDEX idx_ver_status      ON app.verifications(status);
CREATE INDEX idx_ver_expiry      ON app.verifications(expires_at) WHERE status = 'passed';
CREATE INDEX idx_ver_provider    ON app.verifications(provider, provider_job_id) WHERE provider_job_id IS NOT NULL;


-- ---------------------------------------------------------------------------
-- auth.tokens  (in auth schema)
-- Refresh token store. Access tokens are stateless JWTs — not stored here.
-- Only refresh tokens are persisted.
-- ---------------------------------------------------------------------------

CREATE TABLE auth.tokens (
  token_id           TEXT        NOT NULL PRIMARY KEY DEFAULT gen_ulid(),
  user_id            TEXT        NOT NULL,
  token_hash         CHAR(64)    NOT NULL,    -- SHA-256 of token value. Never store raw.
  device_fingerprint VARCHAR(120),            -- Browser/device fingerprint for anomaly detection
  ip_address         INET,
  user_agent         TEXT,
  is_revoked         BOOLEAN     NOT NULL DEFAULT false,
  expires_at         TIMESTAMPTZ NOT NULL,    -- DEFAULT: issued_at + 30 days
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at       TIMESTAMPTZ,

  CONSTRAINT fk_tok_user
    FOREIGN KEY (user_id) REFERENCES app.users(user_id) ON DELETE CASCADE
);

COMMENT ON TABLE auth.tokens IS
  'Refresh token store. token_hash = SHA-256(raw_token). Never store raw token value.';

CREATE UNIQUE INDEX idx_tok_hash       ON auth.tokens(token_hash);
CREATE INDEX        idx_tok_user_valid ON auth.tokens(user_id, is_revoked, expires_at)
                                        WHERE is_revoked = false;
CREATE INDEX        idx_tok_expiry     ON auth.tokens(expires_at) WHERE is_revoked = false;


-- ---------------------------------------------------------------------------
-- auth.otp_codes
-- One-time password codes for phone verification
-- ---------------------------------------------------------------------------

CREATE TABLE auth.otp_codes (
  otp_id       TEXT        NOT NULL PRIMARY KEY DEFAULT gen_ulid(),
  phone        VARCHAR(20) NOT NULL,
  code_hash    CHAR(64)    NOT NULL,    -- SHA-256 of 6-digit code
  purpose      VARCHAR(30) NOT NULL,    -- 'registration', 'login', 'reset'
  is_used      BOOLEAN     NOT NULL DEFAULT false,
  attempts     SMALLINT    NOT NULL DEFAULT 0 CHECK (attempts <= 5),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL    -- DEFAULT: created_at + 10 minutes
);

COMMENT ON TABLE auth.otp_codes IS
  '6-digit SMS OTP codes. Expire in 10 minutes. Max 5 attempts. Hashed on storage.';

CREATE INDEX idx_otp_phone_active ON auth.otp_codes(phone, is_used, expires_at)
                                   WHERE is_used = false;


-- ---------------------------------------------------------------------------
-- RECORD THIS MIGRATION
-- ---------------------------------------------------------------------------

INSERT INTO public.schema_migrations (version) VALUES ('004') ON CONFLICT DO NOTHING;

COMMIT;
