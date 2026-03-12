-- =============================================================================
-- Migration: 005_jobs_matching_tables.sql
-- Description: listings, match_scores, applications, offers
-- Author: RasoiLink Engineering
-- Created: 2026-03-10
-- Dependencies: 001, 002, 003, 004
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- app.listings
-- Job postings created by owners. Immutable once an agreement is signed.
-- Every column is a potential match engine dimension.
-- ---------------------------------------------------------------------------

CREATE TABLE app.listings (
  listing_id              TEXT                       NOT NULL PRIMARY KEY DEFAULT gen_ulid(),
  owner_id                TEXT                       NOT NULL,

  -- Role & cuisine
  title                   VARCHAR(160)               NOT NULL,
  role_code               VARCHAR(40)                NOT NULL,
  cuisine_required        TEXT[]                     NOT NULL DEFAULT '{}',

  -- Location
  city                    VARCHAR(80)                NOT NULL,
  state                   CHAR(2)                    NOT NULL,
  zip_code                VARCHAR(10),

  -- Pay (stored in US cents)
  pay_min_cents           INTEGER                    NOT NULL CHECK (pay_min_cents > 0),
  pay_max_cents           INTEGER                    NOT NULL CHECK (pay_max_cents >= pay_min_cents),
  pay_frequency           public.pay_freq_enum       NOT NULL DEFAULT 'weekly',
  tips_included           BOOLEAN                    NOT NULL DEFAULT false,

  -- Schedule
  hours_per_week          SMALLINT                   NOT NULL CHECK (hours_per_week BETWEEN 1 AND 80),
  years_exp_required      SMALLINT                   NOT NULL DEFAULT 0 CHECK (years_exp_required >= 0),

  -- Accommodation
  accommodation_provided  BOOLEAN                    NOT NULL DEFAULT false,
  accommodation_address   TEXT,                                -- Locked at creation if provided
  accommodation_cost_cents INTEGER                   DEFAULT 0 CHECK (accommodation_cost_cents >= 0),

  -- Terms
  start_date              DATE,
  notice_period_weeks     SMALLINT                   NOT NULL DEFAULT 2 CHECK (notice_period_weeks >= 0),
  languages_preferred     CHAR(2)[]                  DEFAULT '{}',

  -- Descriptions (at minimum English required)
  description_en          TEXT                       NOT NULL,
  description_hi          TEXT,
  description_te          TEXT,
  description_pa          TEXT,

  -- State machine
  status                  public.listing_status_enum NOT NULL DEFAULT 'draft',
  expires_at              TIMESTAMPTZ                NOT NULL DEFAULT (now() + INTERVAL '60 days'),
  created_at              TIMESTAMPTZ                NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ                NOT NULL DEFAULT now(),

  CONSTRAINT fk_lst_owner
    FOREIGN KEY (owner_id) REFERENCES app.owner_profiles(owner_id)
    ON DELETE RESTRICT,

  CONSTRAINT fk_lst_role
    FOREIGN KEY (role_code) REFERENCES ref.role_codes(code),

  CONSTRAINT chk_lst_accommodation
    CHECK (
      accommodation_provided = false
      OR (accommodation_provided = true AND accommodation_address IS NOT NULL)
    )
);

COMMENT ON TABLE  app.listings IS
  'Job postings from owners. Terms are locked once an agreement is signed. '
  'All columns feed the match engine.';
COMMENT ON COLUMN app.listings.pay_min_cents IS 'Hourly minimum pay in US cents (e.g. 2000 = $20.00/hr).';
COMMENT ON COLUMN app.listings.accommodation_address IS
  'Locked at listing creation. Cannot be changed once workers are matching against it.';
COMMENT ON COLUMN app.listings.notice_period_weeks IS
  'How much notice the worker must give when resigning. Written into agreement at hire.';

-- Query indexes
CREATE INDEX idx_lst_owner          ON app.listings(owner_id);
CREATE INDEX idx_lst_state_status   ON app.listings(state, status);
CREATE INDEX idx_lst_role_status    ON app.listings(role_code, status);
CREATE INDEX idx_lst_pay            ON app.listings(pay_min_cents, pay_max_cents);
CREATE INDEX idx_lst_cuisine        ON app.listings USING gin(cuisine_required);
CREATE INDEX idx_lst_expiry         ON app.listings(expires_at) WHERE status = 'active';
CREATE INDEX idx_lst_title_trgm     ON app.listings USING gin(title gin_trgm_ops);

-- Partial index: only active listings (hot path for match engine)
CREATE INDEX idx_lst_active         ON app.listings(state, role_code, pay_min_cents)
  WHERE status = 'active';

CREATE TRIGGER trg_lst_updated_at
  BEFORE UPDATE ON app.listings
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();


-- ---------------------------------------------------------------------------
-- app.match_scores
-- Cached output of the match engine. One row = one (worker × listing) pair.
-- Recomputed when worker profile or listing changes.
-- Hard-gated pairs (visa mismatch, suspended accounts) stored but hidden.
-- ---------------------------------------------------------------------------

CREATE TABLE app.match_scores (
  match_id          TEXT     NOT NULL PRIMARY KEY DEFAULT gen_ulid(),
  worker_id         TEXT     NOT NULL,
  listing_id        TEXT     NOT NULL,

  -- Composite score
  total_score       SMALLINT NOT NULL DEFAULT 0 CHECK (total_score BETWEEN 0 AND 100),

  -- Dimension scores (max values reflect weights from Feature Spec)
  score_location    SMALLINT NOT NULL DEFAULT 0 CHECK (score_location    BETWEEN 0 AND 20),
  score_pay         SMALLINT NOT NULL DEFAULT 0 CHECK (score_pay         BETWEEN 0 AND 18),
  score_cuisine     SMALLINT NOT NULL DEFAULT 0 CHECK (score_cuisine     BETWEEN 0 AND 15),
  score_accommodation SMALLINT NOT NULL DEFAULT 0 CHECK (score_accommodation BETWEEN 0 AND 12),
  score_hours       SMALLINT NOT NULL DEFAULT 0 CHECK (score_hours       BETWEEN 0 AND 10),
  score_trust       SMALLINT NOT NULL DEFAULT 0 CHECK (score_trust       BETWEEN 0 AND 8),
  score_experience  SMALLINT NOT NULL DEFAULT 0 CHECK (score_experience  BETWEEN 0 AND 7),
  score_language    SMALLINT NOT NULL DEFAULT 0 CHECK (score_language    BETWEEN 0 AND 4),
  score_notice      SMALLINT NOT NULL DEFAULT 0 CHECK (score_notice      BETWEEN 0 AND 3),

  -- Hard gates (blocked regardless of score)
  hard_gate_failed  BOOLEAN  NOT NULL DEFAULT false,
  hard_gate_reason  VARCHAR(60),   -- 'visa_mismatch' | 'owner_suspended' | 'dispute_open' | 'trust_too_low'

  -- Cache TTL
  computed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at        TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '15 minutes'),

  CONSTRAINT fk_ms_worker
    FOREIGN KEY (worker_id)  REFERENCES app.worker_profiles(worker_id)  ON DELETE CASCADE,
  CONSTRAINT fk_ms_listing
    FOREIGN KEY (listing_id) REFERENCES app.listings(listing_id) ON DELETE CASCADE,
  CONSTRAINT uq_ms_pair
    UNIQUE (worker_id, listing_id)
);

COMMENT ON TABLE  app.match_scores IS
  'Match engine output cache. 15-minute TTL enforced by expires_at. '
  'Scores below 50 or with hard_gate_failed=true are hidden from API responses.';
COMMENT ON COLUMN app.match_scores.hard_gate_failed IS
  'When true, this match is NEVER shown to either party — not even in admin views without cause.';

-- Worker match feed (what workers see)
CREATE INDEX idx_ms_worker_feed
  ON app.match_scores(worker_id, total_score DESC)
  WHERE hard_gate_failed = false AND total_score >= 50;

-- Owner candidate list (what owners see)
CREATE INDEX idx_ms_listing_feed
  ON app.match_scores(listing_id, total_score DESC)
  WHERE hard_gate_failed = false AND total_score >= 50;

-- TTL cleanup (background job queries this)


-- ---------------------------------------------------------------------------
-- app.applications
-- Worker expressions of interest in a listing.
-- Drives the hiring funnel state machine.
-- ---------------------------------------------------------------------------

CREATE TABLE app.applications (
  application_id        TEXT                            NOT NULL PRIMARY KEY DEFAULT gen_ulid(),
  worker_id             TEXT                            NOT NULL,
  listing_id            TEXT                            NOT NULL,
  match_score_at_apply  SMALLINT,                       -- Snapshot of score when worker applied
  status                public.application_status_enum  NOT NULL DEFAULT 'interested',
  intro_audio_url       TEXT,                           -- Optional S3 voice introduction
  cover_note            TEXT,                           -- Optional text in any language
  applied_at            TIMESTAMPTZ                     NOT NULL DEFAULT now(),
  status_updated_at     TIMESTAMPTZ                     NOT NULL DEFAULT now(),

  CONSTRAINT fk_app_worker
    FOREIGN KEY (worker_id)  REFERENCES app.worker_profiles(worker_id)  ON DELETE CASCADE,
  CONSTRAINT fk_app_listing
    FOREIGN KEY (listing_id) REFERENCES app.listings(listing_id) ON DELETE CASCADE,
  CONSTRAINT uq_app_pair
    UNIQUE (worker_id, listing_id)   -- One application per worker per listing
);

COMMENT ON TABLE app.applications IS
  'Worker interest in a listing. One row per (worker, listing) pair. '
  'match_score_at_apply is a snapshot — score may change after application.';

CREATE INDEX idx_app_listing_status ON app.applications(listing_id, status);
CREATE INDEX idx_app_worker         ON app.applications(worker_id, applied_at DESC);
CREATE INDEX idx_app_status_updated ON app.applications(status_updated_at DESC);

-- Auto-update status_updated_at on status change
CREATE OR REPLACE FUNCTION app.set_app_status_updated()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status <> OLD.status THEN
    NEW.status_updated_at = now();
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_app_status_updated
  BEFORE UPDATE ON app.applications
  FOR EACH ROW EXECUTE FUNCTION app.set_app_status_updated();


-- ---------------------------------------------------------------------------
-- app.offers
-- Formal job offers sent by owners to specific workers.
-- An accepted offer becomes the parent of an agreement.
-- ---------------------------------------------------------------------------

CREATE TABLE app.offers (
  offer_id              TEXT                     NOT NULL PRIMARY KEY DEFAULT gen_ulid(),
  listing_id            TEXT                     NOT NULL,
  worker_id             TEXT                     NOT NULL,
  owner_id              TEXT                     NOT NULL,

  -- Offered terms (may differ from listing range — final negotiated rate)
  offered_pay_cents     INTEGER                  NOT NULL CHECK (offered_pay_cents > 0),
  offered_hours_pw      SMALLINT                 NOT NULL CHECK (offered_hours_pw BETWEEN 1 AND 80),
  start_date            DATE,

  -- State
  status                VARCHAR(20)              NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','accepted','rejected','expired','withdrawn')),

  -- Messages (bilingual)
  message_en            TEXT,
  message_native        TEXT,   -- In worker's preferred language

  -- Timing
  expires_at            TIMESTAMPTZ              NOT NULL DEFAULT (now() + INTERVAL '72 hours'),
  responded_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ              NOT NULL DEFAULT now(),

  CONSTRAINT fk_off_listing
    FOREIGN KEY (listing_id) REFERENCES app.listings(listing_id) ON DELETE RESTRICT,
  CONSTRAINT fk_off_worker
    FOREIGN KEY (worker_id)  REFERENCES app.worker_profiles(worker_id) ON DELETE RESTRICT,
  CONSTRAINT fk_off_owner
    FOREIGN KEY (owner_id)   REFERENCES app.owner_profiles(owner_id)   ON DELETE RESTRICT,

  -- One pending offer per worker per listing at a time
  CONSTRAINT uq_off_active_pair
    EXCLUDE USING btree (worker_id WITH =, listing_id WITH =)
    WHERE (status = 'pending')
);

COMMENT ON TABLE  app.offers IS
  'Formal offer from owner to worker. Accepted offer becomes parent of an agreement.';
COMMENT ON COLUMN app.offers.expires_at IS
  'Worker must respond within 72 hours. Auto-set to expired by cron if not responded.';

CREATE INDEX idx_off_worker_status ON app.offers(worker_id, status);
CREATE INDEX idx_off_listing       ON app.offers(listing_id, status);
CREATE INDEX idx_off_owner         ON app.offers(owner_id, created_at DESC);
CREATE INDEX idx_off_expiry        ON app.offers(expires_at, status) WHERE status = 'pending';


-- ---------------------------------------------------------------------------
-- RECORD THIS MIGRATION
-- ---------------------------------------------------------------------------

INSERT INTO public.schema_migrations (version) VALUES ('005') ON CONFLICT DO NOTHING;

COMMIT;
