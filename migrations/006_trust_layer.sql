-- =============================================================================
-- Migration: 006_trust_layer.sql
-- Description: agreements, ratings — the core trust layer tables
-- Author: RasoiLink Engineering
-- Created: 2026-03-10
-- Dependencies: 001, 002, 003, 004, 005
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- app.agreements
-- Signed digital work contract between a worker and an owner.
-- Parent of pay_cycles and ratings.
--
-- IMMUTABILITY RULES:
--   - Terms (pay, hours, accommodation) are locked at signing.
--   - Amendments create a new agreement record (previous marked 'terminated').
--   - Signed PDFs are write-once — never replaced.
--   - IP addresses at signing are permanent audit record.
-- ---------------------------------------------------------------------------

CREATE TABLE app.agreements (
  agreement_id             TEXT                             NOT NULL PRIMARY KEY DEFAULT gen_ulid(),
  offer_id                 TEXT                             NOT NULL,
  worker_id                TEXT                             NOT NULL,
  owner_id                 TEXT                             NOT NULL,

  -- Status
  status                   public.agreement_status_enum     NOT NULL DEFAULT 'pending_signatures',

  -- Locked terms (snapshot from offer at time of signing — NOT foreign keys)
  role_code_snapshot       VARCHAR(40)                      NOT NULL,
  agreed_pay_cents         INTEGER                          NOT NULL CHECK (agreed_pay_cents > 0),
  agreed_hours_pw          SMALLINT                         NOT NULL CHECK (agreed_hours_pw BETWEEN 1 AND 80),
  pay_frequency            public.pay_freq_enum             NOT NULL,
  pay_day                  public.pay_day_enum              NOT NULL DEFAULT 'friday',
  start_date               DATE                             NOT NULL,
  end_date                 DATE,                            -- NULL = open-ended
  notice_period_weeks      SMALLINT                         NOT NULL DEFAULT 2,

  -- Accommodation (locked at signing)
  accommodation_provided   BOOLEAN                          NOT NULL DEFAULT false,
  accommodation_address    TEXT,
  accommodation_cost_cents INTEGER                          DEFAULT 0,

  -- Signatures (NULL until signed — both must sign for status → 'active')
  worker_signed_at         TIMESTAMPTZ,
  owner_signed_at          TIMESTAMPTZ,
  worker_sign_ip           INET,                            -- Immutable audit record
  owner_sign_ip            INET,                            -- Immutable audit record
  worker_sign_device       TEXT,                            -- Browser fingerprint at signing

  -- Documents (S3 URLs, write-once)
  pdf_url_en               TEXT,                            -- Signed English PDF
  pdf_url_native           TEXT,                            -- Signed worker-language PDF

  -- Termination
  terminated_at            TIMESTAMPTZ,
  termination_initiated_by VARCHAR(10) CHECK (termination_initiated_by IN ('worker','owner','admin')),
  termination_reason       public.termination_reason_enum,
  last_working_date        DATE,
  termination_notes        TEXT,

  -- Timestamps
  created_at               TIMESTAMPTZ                      NOT NULL DEFAULT now(),

  CONSTRAINT fk_agr_offer
    FOREIGN KEY (offer_id) REFERENCES app.offers(offer_id)  ON DELETE RESTRICT,
  CONSTRAINT fk_agr_worker
    FOREIGN KEY (worker_id) REFERENCES app.worker_profiles(worker_id) ON DELETE RESTRICT,
  CONSTRAINT fk_agr_owner
    FOREIGN KEY (owner_id)  REFERENCES app.owner_profiles(owner_id)   ON DELETE RESTRICT,

  -- A worker can only have one active agreement at a time
  CONSTRAINT uq_agr_worker_active
    EXCLUDE USING btree (worker_id WITH =)
    WHERE (status = 'active'),

  -- end_date must be after start_date
  CONSTRAINT chk_agr_dates
    CHECK (end_date IS NULL OR end_date > start_date),

  -- Accommodation address required if provided
  CONSTRAINT chk_agr_accommodation
    CHECK (
      accommodation_provided = false
      OR (accommodation_provided = true AND accommodation_address IS NOT NULL)
    ),

  -- Both signatures required before activation (enforced by trigger, not constraint)
  CONSTRAINT chk_agr_termination
    CHECK (
      status != 'terminated'
      OR (terminated_at IS NOT NULL AND last_working_date IS NOT NULL)
    )
);

COMMENT ON TABLE  app.agreements IS
  'Digital work agreement. Terms locked at signing. '
  'Immutable after both parties sign — amendments create new records.';
COMMENT ON COLUMN app.agreements.role_code_snapshot IS
  'Snapshot of role at signing time. NOT a foreign key — role_codes may change.';
COMMENT ON COLUMN app.agreements.agreed_pay_cents IS
  'Locked hourly pay in cents at time of signing. Cannot change during active agreement.';
COMMENT ON COLUMN app.agreements.worker_sign_ip IS
  'IP address recorded at digital signing. Permanent audit trail. Never update.';

CREATE INDEX idx_agr_worker_status ON app.agreements(worker_id, status);
CREATE INDEX idx_agr_owner_status  ON app.agreements(owner_id, status);
CREATE INDEX idx_agr_offer         ON app.agreements(offer_id);
CREATE INDEX idx_agr_active        ON app.agreements(worker_id, owner_id) WHERE status = 'active';
CREATE INDEX idx_agr_pending_sigs  ON app.agreements(created_at) WHERE status = 'pending_signatures';


-- ---------------------------------------------------------------------------
-- TRIGGER: activate agreement when both parties sign
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app.maybe_activate_agreement()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- When both parties have signed, transition to 'active'
  IF NEW.worker_signed_at IS NOT NULL
     AND NEW.owner_signed_at IS NOT NULL
     AND OLD.status = 'pending_signatures'
  THEN
    NEW.status := 'active';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_agr_activate
  BEFORE UPDATE ON app.agreements
  FOR EACH ROW EXECUTE FUNCTION app.maybe_activate_agreement();


-- ---------------------------------------------------------------------------
-- app.ratings
-- Monthly mutual ratings. Prompted by the system — not submitted on demand.
-- One record per (agreement, rater, period_month) — enforced by unique index.
-- Aggregated into users.trust_score by trigger.
-- ---------------------------------------------------------------------------

CREATE TABLE app.ratings (
  rating_id             TEXT        NOT NULL PRIMARY KEY DEFAULT gen_ulid(),
  agreement_id          TEXT        NOT NULL,
  rater_id              TEXT        NOT NULL,
  rated_id              TEXT        NOT NULL,
  period_month          CHAR(7)     NOT NULL,  -- YYYY-MM format e.g. '2026-02'
  rater_type            VARCHAR(10) NOT NULL CHECK (rater_type IN ('worker','owner')),

  -- Rating dimensions (1–5 scale, NULL if not applicable)
  -- Worker rating an employer:
  dim_pay_reliability   SMALLINT    CHECK (dim_pay_reliability   BETWEEN 1 AND 5),
  dim_communication     SMALLINT    NOT NULL CHECK (dim_communication BETWEEN 1 AND 5),
  dim_accommodation     SMALLINT    CHECK (dim_accommodation     BETWEEN 1 AND 5),

  -- Owner rating a worker:
  dim_reliability       SMALLINT    CHECK (dim_reliability       BETWEEN 1 AND 5),
  dim_skill_level       SMALLINT    CHECK (dim_skill_level       BETWEEN 1 AND 5),
  dim_punctuality       SMALLINT    CHECK (dim_punctuality       BETWEEN 1 AND 5),

  -- Required for all ratings
  dim_overall           SMALLINT    NOT NULL CHECK (dim_overall  BETWEEN 1 AND 5),

  -- Notes (private — never shown publicly)
  private_note          TEXT,

  -- Integrity
  is_disputed           BOOLEAN     NOT NULL DEFAULT false,
  dispute_reason        TEXT,

  -- Timing
  submitted_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  window_closes_at      TIMESTAMPTZ NOT NULL,  -- Must submit before this (72h from system prompt)

  CONSTRAINT fk_rat_agreement
    FOREIGN KEY (agreement_id) REFERENCES app.agreements(agreement_id) ON DELETE RESTRICT,
  CONSTRAINT fk_rat_rater
    FOREIGN KEY (rater_id) REFERENCES app.users(user_id) ON DELETE RESTRICT,
  CONSTRAINT fk_rat_rated
    FOREIGN KEY (rated_id) REFERENCES app.users(user_id) ON DELETE RESTRICT,

  -- One rating per person per month per agreement
  CONSTRAINT uq_rat_period
    UNIQUE (agreement_id, rater_id, period_month),

  -- Must be submitted within window
  CONSTRAINT chk_rat_window
    CHECK (submitted_at <= window_closes_at),

  -- Validate period_month format (YYYY-MM)
  CONSTRAINT chk_rat_period_format
    CHECK (period_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),

  -- Worker ratings must have employer dimensions; owner ratings must have worker dimensions
  CONSTRAINT chk_rat_worker_dims
    CHECK (
      rater_type <> 'worker'
      OR dim_pay_reliability IS NOT NULL
    ),
  CONSTRAINT chk_rat_owner_dims
    CHECK (
      rater_type <> 'owner'
      OR (dim_reliability IS NOT NULL AND dim_skill_level IS NOT NULL AND dim_punctuality IS NOT NULL)
    )
);

COMMENT ON TABLE  app.ratings IS
  'Monthly mutual ratings. System-prompted — not on-demand. '
  'Aggregated into trust_score via trigger. Private notes never exposed via API.';
COMMENT ON COLUMN app.ratings.private_note IS
  'Internal only. Never returned in any API response. Staff-only access.';
COMMENT ON COLUMN app.ratings.window_closes_at IS
  'Rating must be submitted within 72 hours of system prompt. Enforced by constraint.';

CREATE INDEX idx_rat_rated     ON app.ratings(rated_id, submitted_at DESC);
CREATE INDEX idx_rat_agreement ON app.ratings(agreement_id, period_month);
CREATE INDEX idx_rat_period    ON app.ratings(period_month);
CREATE INDEX idx_rat_disputed  ON app.ratings(is_disputed) WHERE is_disputed = true;


-- ---------------------------------------------------------------------------
-- TRIGGER: recompute trust_score on users after ratings insert/update
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app.recompute_trust_score()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  target_id TEXT;
  new_score  NUMERIC(3,2);
BEGIN
  -- Determine which user's score to update
  target_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.rated_id ELSE NEW.rated_id END;

  -- Weighted average of dim_overall from last 24 months of non-disputed ratings
  SELECT COALESCE(
    ROUND(
      AVG(dim_overall)::NUMERIC, 2
    ), 0.00
  )
  INTO new_score
  FROM app.ratings
  WHERE rated_id = target_id
    AND is_disputed = false
    AND submitted_at >= (now() - INTERVAL '24 months');

  -- Update the cached trust score
  UPDATE app.users
  SET trust_score = new_score
  WHERE user_id = target_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_ratings_trust_score
  AFTER INSERT OR UPDATE OR DELETE ON app.ratings
  FOR EACH ROW EXECUTE FUNCTION app.recompute_trust_score();


-- ---------------------------------------------------------------------------
-- FUNCTION: compute_trust_score_for_user (for on-demand recompute)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app.compute_trust_score_for_user(p_user_id TEXT)
RETURNS NUMERIC(3,2) LANGUAGE plpgsql AS $$
DECLARE
  result NUMERIC(3,2);
BEGIN
  SELECT COALESCE(ROUND(AVG(dim_overall)::NUMERIC, 2), 0.00)
  INTO result
  FROM app.ratings
  WHERE rated_id = p_user_id
    AND is_disputed = false
    AND submitted_at >= (now() - INTERVAL '24 months');

  UPDATE app.users SET trust_score = result WHERE user_id = p_user_id;
  RETURN result;
END;
$$;

COMMENT ON FUNCTION app.compute_trust_score_for_user IS
  'Recomputes and persists trust_score for a single user. '
  'Used by background job and admin override.';


-- ---------------------------------------------------------------------------
-- RECORD THIS MIGRATION
-- ---------------------------------------------------------------------------

INSERT INTO public.schema_migrations (version) VALUES ('006') ON CONFLICT DO NOTHING;

COMMIT;
