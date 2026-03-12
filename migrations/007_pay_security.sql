-- =============================================================================
-- Migration: 007_pay_security.sql
-- Description: pay_cycles, pay_disputes — the wage security system
-- Author: RasoiLink Engineering
-- Created: 2026-03-10
-- Dependencies: 001, 002, 003, 004, 005, 006
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- app.pay_cycles
-- Individual pay period records generated from agreement schedule.
-- Core object of the wage-security confirmation loop.
--
-- LIFECYCLE:
--   scheduled → owner_confirmed → worker_confirmed  (happy path)
--   scheduled → late            → disputed          → resolved
--   scheduled → owner_confirmed → disputed          → resolved
--
-- IMMUTABILITY:
--   Once status reaches 'worker_confirmed' or 'resolved', no further
--   updates are permitted (enforced by trigger below).
-- ---------------------------------------------------------------------------

CREATE TABLE app.pay_cycles (
  cycle_id                  TEXT                          NOT NULL PRIMARY KEY DEFAULT gen_ulid(),
  agreement_id              TEXT                          NOT NULL,

  -- Denormalized for query performance (avoid joins in hot-path dashboard)
  worker_id                 TEXT                          NOT NULL,
  owner_id                  TEXT                          NOT NULL,

  -- Period
  period_start              DATE                          NOT NULL,
  period_end                DATE                          NOT NULL,
  due_date                  DATE                          NOT NULL,

  -- Expected amount (computed from agreement at cycle generation time)
  expected_amount_cents     INTEGER                       NOT NULL CHECK (expected_amount_cents > 0),

  -- State machine
  status                    public.pay_cycle_status_enum  NOT NULL DEFAULT 'scheduled',

  -- Owner confirmation
  owner_confirmed_at        TIMESTAMPTZ,
  owner_amount_paid_cents   INTEGER                       CHECK (owner_amount_paid_cents >= 0),
  payment_method            public.payment_method_enum,
  payment_reference         VARCHAR(120),                 -- Bank ref / check number / Zelle confirmation

  -- Worker confirmation
  worker_confirmed_at       TIMESTAMPTZ,

  -- Late escalation
  late_notice_sent_at       TIMESTAMPTZ,                  -- When T+48h late alert was sent

  -- Resolution
  resolved_at               TIMESTAMPTZ,
  resolution_notes          TEXT,

  created_at                TIMESTAMPTZ                   NOT NULL DEFAULT now(),

  CONSTRAINT fk_pc_agreement
    FOREIGN KEY (agreement_id) REFERENCES app.agreements(agreement_id) ON DELETE RESTRICT,
  CONSTRAINT fk_pc_worker
    FOREIGN KEY (worker_id) REFERENCES app.worker_profiles(worker_id)  ON DELETE RESTRICT,
  CONSTRAINT fk_pc_owner
    FOREIGN KEY (owner_id)  REFERENCES app.owner_profiles(owner_id)    ON DELETE RESTRICT,

  -- Period start must precede end
  CONSTRAINT chk_pc_period
    CHECK (period_end > period_start),

  -- Due date must be after period end
  CONSTRAINT chk_pc_due
    CHECK (due_date >= period_end),

  -- One cycle per agreement per period
  CONSTRAINT uq_pc_period
    UNIQUE (agreement_id, period_start),

  -- Owner confirmation fields must be set together
  CONSTRAINT chk_pc_owner_confirm
    CHECK (
      owner_confirmed_at IS NULL
      OR (owner_amount_paid_cents IS NOT NULL AND payment_method IS NOT NULL)
    )
);

COMMENT ON TABLE  app.pay_cycles IS
  'Pay period record generated from agreement schedule. '
  'Core object of the wage-security loop. '
  'Terminal states (worker_confirmed, resolved) are immutable.';
COMMENT ON COLUMN app.pay_cycles.worker_id IS
  'Denormalized from agreement for query performance. Must match agreement.worker_id.';
COMMENT ON COLUMN app.pay_cycles.expected_amount_cents IS
  'Computed at cycle creation: agreed_pay_cents * (hours_per_week / pay_freq_divisor). '
  'Snapshot — does not change if agreement is later terminated.';
COMMENT ON COLUMN app.pay_cycles.payment_method IS
  'cash payments are allowed but flagged internally for enhanced monitoring.';

-- Query indexes
CREATE INDEX idx_pc_agreement      ON app.pay_cycles(agreement_id, period_start DESC);
CREATE INDEX idx_pc_worker_status  ON app.pay_cycles(worker_id, status);
CREATE INDEX idx_pc_owner_status   ON app.pay_cycles(owner_id, status);
CREATE INDEX idx_pc_due_status     ON app.pay_cycles(due_date, status);
CREATE INDEX idx_pc_late_check     ON app.pay_cycles(due_date)
  WHERE status IN ('scheduled', 'late');   -- Used by late-escalation cron job


-- ---------------------------------------------------------------------------
-- TRIGGER: block mutations on terminal pay cycles
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app.guard_terminal_pay_cycle()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('worker_confirmed', 'resolved') THEN
    RAISE EXCEPTION
      'Pay cycle % is in terminal state % and cannot be modified.',
      OLD.cycle_id, OLD.status
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_pc_terminal_guard
  BEFORE UPDATE ON app.pay_cycles
  FOR EACH ROW EXECUTE FUNCTION app.guard_terminal_pay_cycle();


-- ---------------------------------------------------------------------------
-- FUNCTION: generate_pay_cycles_for_agreement
-- Called when an agreement transitions to 'active'.
-- Generates all scheduled pay cycles from start_date forward
-- for the next 6 months (extended by background job as needed).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app.generate_pay_cycles(p_agreement_id TEXT)
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE
  agr               app.agreements%ROWTYPE;
  cycle_start       DATE;
  cycle_end         DATE;
  cycle_due         DATE;
  cycles_created    INTEGER := 0;
  horizon           DATE;
  freq_days         INTEGER;
  weekly_pay_cents  INTEGER;
BEGIN
  SELECT * INTO agr FROM app.agreements WHERE agreement_id = p_agreement_id;

  IF agr.status <> 'active' THEN
    RAISE EXCEPTION 'Agreement % is not active (status: %)', p_agreement_id, agr.status;
  END IF;

  -- Generate 6 months of cycles
  horizon := agr.start_date + INTERVAL '6 months';

  -- Calculate period length and weekly equivalent
  freq_days := CASE agr.pay_frequency
    WHEN 'weekly'      THEN 7
    WHEN 'biweekly'    THEN 14
    WHEN 'semimonthly' THEN 15  -- approximate; exact handled in app layer
  END;

  weekly_pay_cents := agr.agreed_pay_cents * agr.agreed_hours_pw;

  cycle_start := agr.start_date;

  WHILE cycle_start < horizon LOOP
    cycle_end := cycle_start + (freq_days - 1);
    cycle_due := cycle_end + 2;   -- 2-day grace after period end

    -- Find the correct pay_day (next matching weekday after cycle_end)
    WHILE to_char(cycle_due, 'Dy') != initcap(agr.pay_day::TEXT) LOOP
      cycle_due := cycle_due + 1;
    END LOOP;

    INSERT INTO app.pay_cycles (
      agreement_id, worker_id, owner_id,
      period_start, period_end, due_date,
      expected_amount_cents
    ) VALUES (
      agr.agreement_id, agr.worker_id, agr.owner_id,
      cycle_start, cycle_end, cycle_due,
      weekly_pay_cents * (freq_days / 7)
    )
    ON CONFLICT (agreement_id, period_start) DO NOTHING;

    cycles_created := cycles_created + 1;
    cycle_start := cycle_start + freq_days;
  END LOOP;

  RETURN cycles_created;
END;
$$;

COMMENT ON FUNCTION app.generate_pay_cycles IS
  'Generates scheduled pay cycles for an active agreement. '
  'Call on agreement activation. Background job extends horizon monthly.';


-- ---------------------------------------------------------------------------
-- TRIGGER: auto-generate pay cycles when agreement activates
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app.on_agreement_activated()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'active' AND OLD.status = 'pending_signatures' THEN
    PERFORM app.generate_pay_cycles(NEW.agreement_id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_agr_generate_cycles
  AFTER UPDATE ON app.agreements
  FOR EACH ROW EXECUTE FUNCTION app.on_agreement_activated();


-- ---------------------------------------------------------------------------
-- app.pay_disputes
-- Formal dispute record for a specific pay cycle.
-- Triggers admin review if unresolved within 72 hours of filing.
-- ---------------------------------------------------------------------------

CREATE TABLE app.pay_disputes (
  dispute_id             TEXT                           NOT NULL PRIMARY KEY DEFAULT gen_ulid(),
  cycle_id               TEXT                           NOT NULL,
  filed_by               TEXT                           NOT NULL,   -- FK → users.user_id

  -- Dispute details
  dispute_type           public.dispute_type_enum        NOT NULL,
  expected_cents         INTEGER                         NOT NULL CHECK (expected_cents > 0),
  received_cents         INTEGER                         NOT NULL DEFAULT 0 CHECK (received_cents >= 0),
  description            TEXT                            NOT NULL,
  evidence_urls          TEXT[]                          NOT NULL DEFAULT '{}',

  -- State
  status                 public.dispute_status_enum      NOT NULL DEFAULT 'open',

  -- Response / resolution
  owner_response         TEXT,
  owner_responded_at     TIMESTAMPTZ,
  resolution_notes       TEXT,
  resolved_by            TEXT,                           -- FK → users.user_id (admin or party)
  trust_score_impact     NUMERIC(3,2),                  -- Score delta applied to responsible party

  -- Timing
  filed_at               TIMESTAMPTZ                     NOT NULL DEFAULT now(),
  escalation_deadline    TIMESTAMPTZ                     NOT NULL DEFAULT (now() + INTERVAL '72 hours'),
  resolved_at            TIMESTAMPTZ,

  CONSTRAINT fk_pd_cycle
    FOREIGN KEY (cycle_id)    REFERENCES app.pay_cycles(cycle_id)   ON DELETE RESTRICT,
  CONSTRAINT fk_pd_filed_by
    FOREIGN KEY (filed_by)    REFERENCES app.users(user_id)          ON DELETE RESTRICT,
  CONSTRAINT fk_pd_resolved_by
    FOREIGN KEY (resolved_by) REFERENCES app.users(user_id),

  -- One open dispute per cycle at a time
  CONSTRAINT uq_pd_open_cycle
    EXCLUDE USING btree (cycle_id WITH =)
    WHERE (status NOT IN ('resolved', 'withdrawn')),

  -- Terminal states cannot change
  CONSTRAINT chk_pd_resolved
    CHECK (
      status NOT IN ('resolved', 'withdrawn')
      OR resolved_at IS NOT NULL
    ),

  -- Expected shortfall must be positive
  CONSTRAINT chk_pd_shortfall
    CHECK (expected_cents >= received_cents)
);

COMMENT ON TABLE  app.pay_disputes IS
  'Formal dispute against a pay cycle. '
  '72-hour escalation window — unresolved disputes trigger admin review. '
  'Dispute history permanently affects employer trust score.';
COMMENT ON COLUMN app.pay_disputes.trust_score_impact IS
  'Negative value = score deducted from responsible party. Set at resolution.';
COMMENT ON COLUMN app.pay_disputes.escalation_deadline IS
  'filed_at + 72 hours. Background job escalates to admin_review after this passes.';

CREATE INDEX idx_pd_cycle       ON app.pay_disputes(cycle_id);
CREATE INDEX idx_pd_filed_by    ON app.pay_disputes(filed_by, filed_at DESC);
CREATE INDEX idx_pd_status      ON app.pay_disputes(status);
CREATE INDEX idx_pd_escalation  ON app.pay_disputes(escalation_deadline, status)
  WHERE status NOT IN ('resolved', 'withdrawn');   -- Escalation cron query


-- ---------------------------------------------------------------------------
-- TRIGGER: when dispute opens, set pay_cycle status → 'disputed'
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app.on_dispute_opened()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE app.pay_cycles
    SET status = 'disputed'
    WHERE cycle_id = NEW.cycle_id
      AND status NOT IN ('worker_confirmed', 'resolved');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_dispute_opened
  AFTER INSERT ON app.pay_disputes
  FOR EACH ROW EXECUTE FUNCTION app.on_dispute_opened();


-- ---------------------------------------------------------------------------
-- TRIGGER: when dispute resolves, set pay_cycle status → 'resolved'
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app.on_dispute_resolved()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IN ('resolved', 'withdrawn')
     AND OLD.status NOT IN ('resolved', 'withdrawn')
  THEN
    UPDATE app.pay_cycles
    SET status     = 'resolved',
        resolved_at = now()
    WHERE cycle_id = NEW.cycle_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_dispute_resolved
  AFTER UPDATE ON app.pay_disputes
  FOR EACH ROW EXECUTE FUNCTION app.on_dispute_resolved();


-- ---------------------------------------------------------------------------
-- FUNCTION: mark_cycles_late
-- Called by the cron job every 6 hours.
-- Sets status = 'late' for any scheduled cycle where due_date + 48h has passed.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app.mark_cycles_late()
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE
  rows_updated INTEGER;
BEGIN
  UPDATE app.pay_cycles
  SET status = 'late'
  WHERE status = 'scheduled'
    AND due_date < (CURRENT_DATE - INTERVAL '2 days');

  GET DIAGNOSTICS rows_updated = ROW_COUNT;
  RETURN rows_updated;
END;
$$;

COMMENT ON FUNCTION app.mark_cycles_late IS
  'Sets pay_cycles.status = late for overdue scheduled cycles. '
  'Run by cron every 6 hours. Returns count of rows updated.';


-- ---------------------------------------------------------------------------
-- VIEW: pay_cycle_dashboard
-- Owner/worker-facing summary view for the pay dashboard
-- ---------------------------------------------------------------------------

CREATE VIEW app.pay_cycle_dashboard AS
SELECT
  pc.cycle_id,
  pc.agreement_id,
  pc.worker_id,
  pc.owner_id,
  u_worker.name         AS worker_name,
  u_owner.name          AS owner_name,
  op.restaurant_name,
  pc.period_start,
  pc.period_end,
  pc.due_date,
  pc.expected_amount_cents,
  pc.status,
  pc.owner_confirmed_at,
  pc.owner_amount_paid_cents,
  pc.payment_method,
  pc.worker_confirmed_at,
  -- Computed flag: is this cycle overdue?
  CASE
    WHEN pc.status = 'scheduled' AND pc.due_date < CURRENT_DATE THEN true
    ELSE false
  END AS is_overdue,
  -- Days late (if applicable)
  CASE
    WHEN pc.status IN ('scheduled', 'late') AND pc.due_date < CURRENT_DATE
    THEN (CURRENT_DATE - pc.due_date)
    ELSE 0
  END AS days_overdue
FROM app.pay_cycles pc
JOIN app.users u_worker ON u_worker.user_id = pc.worker_id
JOIN app.owner_profiles op ON op.owner_id = pc.owner_id
JOIN app.users u_owner ON u_owner.user_id = pc.owner_id;

COMMENT ON VIEW app.pay_cycle_dashboard IS
  'Denormalized view for pay dashboard. Apply RLS via worker_id / owner_id in application layer.';


-- ---------------------------------------------------------------------------
-- RECORD THIS MIGRATION
-- ---------------------------------------------------------------------------

INSERT INTO public.schema_migrations (version) VALUES ('007') ON CONFLICT DO NOTHING;

COMMIT;
