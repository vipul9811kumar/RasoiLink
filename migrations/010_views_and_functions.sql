BEGIN;

CREATE OR REPLACE VIEW app.worker_match_profile AS
SELECT
  u.user_id,
  u.name,
  u.trust_score,
  u.is_verified,
  u.language_code,
  wp.role_code,
  wp.years_experience,
  wp.cuisine_specializations,
  wp.current_state,
  wp.preferred_states,
  wp.willing_to_relocate,
  wp.salary_min_cents,
  wp.salary_max_cents,
  wp.pay_freq_pref,
  wp.needs_accommodation,
  wp.profile_completeness,
  EXISTS (
    SELECT 1 FROM app.verifications v
    WHERE v.user_id = u.user_id
      AND v.verification_type = 'identity'
      AND v.status = 'passed'
  ) AS identity_verified,
  EXISTS (
    SELECT 1 FROM app.verifications v
    WHERE v.user_id = u.user_id
      AND v.verification_type = 'work_history'
      AND v.status = 'passed'
  ) AS work_history_verified,
  EXISTS (
    SELECT 1 FROM app.agreements a
    WHERE a.worker_id = u.user_id AND a.status = 'active'
  ) AS has_active_agreement,
  EXISTS (
    SELECT 1 FROM app.pay_disputes d
    JOIN app.pay_cycles c ON c.cycle_id = d.cycle_id
    WHERE c.worker_id = u.user_id
      AND d.status NOT IN ('resolved','withdrawn')
  ) AS has_open_dispute
FROM app.users u
JOIN app.worker_profiles wp ON wp.worker_id = u.user_id
WHERE u.user_type = 'worker' AND u.is_active = true;

CREATE OR REPLACE VIEW app.listing_match_profile AS
SELECT
  l.listing_id,
  l.owner_id,
  l.title,
  l.role_code,
  l.cuisine_required,
  l.state,
  l.city,
  l.zip_code,
  l.pay_min_cents,
  l.pay_max_cents,
  l.pay_frequency,
  l.hours_per_week,
  l.years_exp_required,
  l.accommodation_provided,
  l.accommodation_cost_cents,
  l.notice_period_weeks,
  l.languages_preferred,
  u.trust_score             AS owner_trust_score,
  op.pay_reliability_score  AS owner_pay_reliability,
  op.biz_verified           AS owner_biz_verified,
  (
    SELECT COUNT(*) FROM app.pay_disputes d
    JOIN app.pay_cycles c ON c.cycle_id = d.cycle_id
    WHERE c.owner_id = l.owner_id
      AND d.filed_at > now() - INTERVAL '12 months'
  )::INT                    AS owner_disputes_12mo,
  op.staff_count            AS owner_active_staff_count
FROM app.listings l
JOIN app.users u        ON u.user_id   = l.owner_id
JOIN app.owner_profiles op ON op.owner_id = l.owner_id
WHERE l.status = 'active';

INSERT INTO public.schema_migrations (version) VALUES ('010') ON CONFLICT DO NOTHING;
COMMIT;
