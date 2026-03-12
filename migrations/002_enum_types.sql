-- =============================================================================
-- Migration: 002_enum_types.sql
-- Description: Create all custom PostgreSQL ENUM types used across the schema
-- Author: RasoiLink Engineering
-- Created: 2026-03-10
-- Dependencies: 001_extensions_and_schemas.sql
-- =============================================================================
--
-- NOTE ON ENUMS vs CHECK CONSTRAINTS:
--   We use PostgreSQL native ENUMs for frequently-queried discriminator columns
--   (user_type, status fields) because:
--     1. Stored as 4-byte OID — more compact than VARCHAR
--     2. Enforced at DB level — not just application layer
--     3. Indexed efficiently with btree
--   Trade-off: Adding new values requires ALTER TYPE which is safe in PG 10+
--   but requires brief AccessShareLock (not RowExclusiveLock) — zero downtime.
--
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- IDENTITY & AUTH ENUMS
-- ---------------------------------------------------------------------------

CREATE TYPE public.user_type_enum AS ENUM (
  'worker',   -- Restaurant job seeker
  'owner',    -- Restaurant owner / operator
  'admin',    -- RasoiLink internal staff
  'system'    -- Internal service account for automated processes
);
COMMENT ON TYPE public.user_type_enum IS 'Discriminator for the users table. Determines which profile table applies.';

CREATE TYPE public.work_auth_enum AS ENUM (
  'authorized',   -- Unrestricted US work authorization (citizen, GC, etc.)
  'h2b',          -- H-2B temporary non-agricultural visa
  'ead',          -- Employment Authorization Document (pending GC, asylum, etc.)
  'opt',          -- F-1 OPT (Optional Practical Training)
  'other'         -- Other work authorization — requires manual review
);
COMMENT ON TYPE public.work_auth_enum IS
  'Worker work authorization type. NEVER exposed in match API responses. '
  'Used only for internal hard-gate logic (mutual authorization check).';

CREATE TYPE public.verification_type_enum AS ENUM (
  'identity',          -- Government ID check (passport, state ID, Aadhar)
  'work_history',      -- Previous employer confirmation
  'reference',         -- Personal/professional reference check
  'business_license',  -- Restaurant business license (owners)
  'ein'                -- Employer Identification Number (owners)
);
COMMENT ON TYPE public.verification_type_enum IS 'Type of verification check performed.';

CREATE TYPE public.verification_status_enum AS ENUM (
  'pending',   -- Submitted, awaiting provider response
  'passed',    -- Verification successful
  'failed',    -- Verification failed
  'expired'    -- Previously passed but re-verification required (annually)
);


-- ---------------------------------------------------------------------------
-- JOB & LISTING ENUMS
-- ---------------------------------------------------------------------------

CREATE TYPE public.listing_status_enum AS ENUM (
  'draft',      -- Created, not yet visible to workers
  'active',     -- Live — match engine running, visible to workers
  'paused',     -- Temporarily hidden by owner
  'filled',     -- Position hired — listing closed
  'expired',    -- Reached expires_at without being filled (auto-set by cron)
  'cancelled'   -- Manually cancelled by owner before filling
);
COMMENT ON TYPE public.listing_status_enum IS 'Lifecycle state of a job listing.';

CREATE TYPE public.application_status_enum AS ENUM (
  'interested',    -- Worker expressed interest
  'viewed',        -- Owner has viewed the application
  'shortlisted',   -- Owner marked as shortlisted
  'interview',     -- Interview scheduled
  'offered',       -- Formal offer sent
  'accepted',      -- Worker accepted offer
  'rejected',      -- Owner rejected application
  'withdrawn'      -- Worker withdrew application
);


-- ---------------------------------------------------------------------------
-- AGREEMENT ENUMS
-- ---------------------------------------------------------------------------

CREATE TYPE public.agreement_status_enum AS ENUM (
  'pending_signatures',  -- Generated, awaiting both parties to sign
  'active',              -- Both parties signed — employment underway
  'terminated',          -- Formal notice filed, last_working_date set
  'expired'              -- end_date passed without active termination
);
COMMENT ON TYPE public.agreement_status_enum IS 'Lifecycle state of a digital work agreement.';

CREATE TYPE public.termination_reason_enum AS ENUM (
  'voluntary_resignation',  -- Worker chose to leave
  'mutual',                 -- Both parties agreed to end
  'owner_termination',      -- Owner ended employment
  'abandonment'             -- Worker left without filing notice
);

CREATE TYPE public.pay_freq_enum AS ENUM (
  'weekly',       -- Every 7 days
  'biweekly',     -- Every 14 days
  'semimonthly'   -- Twice per month (1st and 15th)
);
COMMENT ON TYPE public.pay_freq_enum IS 'Pay schedule frequency for agreements and listings.';

CREATE TYPE public.pay_day_enum AS ENUM (
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday'
);
COMMENT ON TYPE public.pay_day_enum IS 'Day of week on which wages are paid.';


-- ---------------------------------------------------------------------------
-- PAY CYCLE ENUMS
-- ---------------------------------------------------------------------------

CREATE TYPE public.pay_cycle_status_enum AS ENUM (
  'scheduled',        -- Generated, due date in future
  'owner_confirmed',  -- Owner marked payment as sent
  'worker_confirmed', -- Worker confirmed receipt — TERMINAL SUCCESS
  'late',             -- due_date + 48h passed with no owner confirmation
  'disputed',         -- Formal dispute opened by either party
  'resolved'          -- Dispute closed by parties or admin — TERMINAL
);
COMMENT ON TYPE public.pay_cycle_status_enum IS
  'State machine for pay cycle. Terminal states: worker_confirmed, resolved.';

CREATE TYPE public.payment_method_enum AS ENUM (
  'bank_transfer',  -- ACH / wire transfer
  'check',          -- Physical or digital check
  'zelle',          -- Zelle peer-to-peer
  'cash',           -- Physical cash (flagged for increased monitoring)
  'other'           -- Other method — requires description
);

CREATE TYPE public.dispute_type_enum AS ENUM (
  'not_received',         -- Payment not received at all
  'partial_payment',      -- Less than agreed amount received
  'incorrect_amount',     -- Different amount than expected
  'method_not_agreed',    -- Paid via method not in agreement
  'other'
);

CREATE TYPE public.dispute_status_enum AS ENUM (
  'open',             -- Just filed, awaiting owner response
  'owner_responded',  -- Owner has replied
  'admin_review',     -- Escalated to RasoiLink admin (72h deadline passed)
  'resolved',         -- Settled — TERMINAL
  'withdrawn'         -- Filer withdrew dispute — TERMINAL
);


-- ---------------------------------------------------------------------------
-- NOTIFICATION ENUMS
-- ---------------------------------------------------------------------------

CREATE TYPE public.notification_channel_enum AS ENUM (
  'push',       -- Firebase Cloud Messaging (FCM)
  'sms',        -- SMS via Twilio
  'whatsapp',   -- WhatsApp Business API
  'email'       -- Email (low-priority / account only)
);

CREATE TYPE public.notification_status_enum AS ENUM (
  'pending',    -- Queued for delivery
  'sent',       -- Dispatched to provider
  'delivered',  -- Provider confirmed delivery
  'failed',     -- Provider reported failure
  'skipped'     -- Conditions not met (e.g. user opted out of channel)
);


-- ---------------------------------------------------------------------------
-- AI CHAT ENUMS
-- ---------------------------------------------------------------------------

CREATE TYPE public.chat_role_enum AS ENUM (
  'user',       -- Message from the end user
  'assistant',  -- Response from the AI
  'system'      -- System-injected context message
);

CREATE TYPE public.chat_flow_enum AS ENUM (
  'onboarding_worker',    -- Worker profile setup flow
  'onboarding_owner',     -- Owner profile setup flow
  'job_search',           -- Worker searching / asking about matches
  'support',              -- General support conversation
  'pay_dispute_assist'    -- Guided dispute filing flow
);

CREATE TYPE public.input_type_enum AS ENUM (
  'text',              -- Typed keyboard input
  'voice_transcript',  -- Transcribed from voice input
  'button_tap'         -- Quick-reply button tap
);


-- ---------------------------------------------------------------------------
-- RECORD THIS MIGRATION
-- ---------------------------------------------------------------------------

INSERT INTO public.schema_migrations (version) VALUES ('002') ON CONFLICT DO NOTHING;
VALUES ('002', 'All custom ENUM types');

COMMIT;
