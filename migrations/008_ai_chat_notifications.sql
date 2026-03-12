-- =============================================================================
-- Migration: 008_ai_chat_notifications.sql
-- Description: chat_sessions, chat_messages, notifications
-- Author: RasoiLink Engineering
-- Created: 2026-03-10
-- Dependencies: 001, 002, 003, 004
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- app.chat_sessions
-- AI conversation session. Holds flow context and staged profile draft.
-- Sessions expire after 24 hours of inactivity.
-- Workers and owners may have multiple sessions (one per conversation).
-- ---------------------------------------------------------------------------

CREATE TABLE app.chat_sessions (
  session_id       TEXT                    NOT NULL PRIMARY KEY DEFAULT gen_ulid(),
  user_id          TEXT,                                        -- NULL for anonymous pre-registration
  language_code    CHAR(2)                 NOT NULL DEFAULT 'en',
  flow_context     public.chat_flow_enum   NOT NULL DEFAULT 'onboarding_worker',
  current_step     VARCHAR(60),            -- e.g. 'salary_preference', 'match_reveal'
  profile_draft    JSONB                   NOT NULL DEFAULT '{}',  -- Staged fields before commit
  session_metadata JSONB                   NOT NULL DEFAULT '{}',  -- Device info, referral source, etc.
  is_active        BOOLEAN                 NOT NULL DEFAULT true,
  message_count    INTEGER                 NOT NULL DEFAULT 0,
  total_tokens     INTEGER                 NOT NULL DEFAULT 0,     -- Running token usage for cost tracking
  last_message_at  TIMESTAMPTZ,
  created_at       TIMESTAMPTZ             NOT NULL DEFAULT now(),
  expires_at       TIMESTAMPTZ             NOT NULL DEFAULT (now() + INTERVAL '24 hours'),

  CONSTRAINT fk_cs_user
    FOREIGN KEY (user_id) REFERENCES app.users(user_id) ON DELETE SET NULL,

  CONSTRAINT chk_cs_language
    CHECK (language_code IN ('en','hi','te','pa','gu','ta','kn','ml','bn'))
);

COMMENT ON TABLE  app.chat_sessions IS
  'AI conversation session. Stateless API — full context stored here. '
  'Sessions expire after 24 hours of inactivity.';
COMMENT ON COLUMN app.chat_sessions.profile_draft IS
  'JSONB staging area for profile fields extracted during conversation. '
  'Committed to worker_profiles/owner_profiles only on user confirmation.';
COMMENT ON COLUMN app.chat_sessions.user_id IS
  'NULL for anonymous users (pre-registration). Set when user registers mid-session.';

CREATE INDEX idx_cs_user          ON app.chat_sessions(user_id, created_at DESC)
  WHERE user_id IS NOT NULL;
CREATE INDEX idx_cs_active_expiry ON app.chat_sessions(is_active, expires_at)
  WHERE is_active = true;
CREATE INDEX idx_cs_flow          ON app.chat_sessions(flow_context, current_step);


-- ---------------------------------------------------------------------------
-- app.chat_messages
-- Individual messages within a session. Append-only — never updated or deleted.
-- Provides the full context window passed to the Claude API.
-- ---------------------------------------------------------------------------

CREATE TABLE app.chat_messages (
  message_id       TEXT                     NOT NULL PRIMARY KEY DEFAULT gen_ulid(),
  session_id       TEXT                     NOT NULL,
  role             public.chat_role_enum    NOT NULL,

  -- Content
  content_text     TEXT,                    -- Message text (any language)
  content_tts_url  TEXT,                    -- S3 URL of TTS audio for assistant messages
  input_type       public.input_type_enum,  -- How the user sent this (text, voice, button)

  -- UI rendering hints (for assistant messages)
  component_type   VARCHAR(40),             -- 'match_cards' | 'choice_list' | 'text' | 'verify_status'
  component_data   JSONB,                   -- Structured data for frontend component rendering
  quick_replies    TEXT[],                  -- Suggested reply buttons in user's language

  -- Flow tracking
  flow_step        VARCHAR(60),             -- Step this message completed
  extracted_fields JSONB,                  -- Profile fields extracted from this user message

  -- Cost tracking
  tokens_used      INTEGER                  DEFAULT 0 CHECK (tokens_used >= 0),
  model_version    VARCHAR(40),             -- e.g. 'claude-sonnet-4-20250514'

  created_at       TIMESTAMPTZ              NOT NULL DEFAULT now(),

  CONSTRAINT fk_cm_session
    FOREIGN KEY (session_id) REFERENCES app.chat_sessions(session_id) ON DELETE CASCADE
);

COMMENT ON TABLE  app.chat_messages IS
  'Append-only conversation log. Never updated or deleted. '
  'Full message history passed as context to Claude API on each turn.';
COMMENT ON COLUMN app.chat_messages.component_data IS
  'Structured payload for frontend UI components (match cards, choice lists, etc.).';
COMMENT ON COLUMN app.chat_messages.extracted_fields IS
  'Profile fields the AI extracted from this message. Staged to chat_sessions.profile_draft.';
COMMENT ON COLUMN app.chat_messages.tokens_used IS
  'Token count for this message. Accumulated in chat_sessions.total_tokens.';

CREATE INDEX idx_cm_session_order ON app.chat_messages(session_id, created_at ASC);
CREATE INDEX idx_cm_step          ON app.chat_messages(session_id, flow_step)
  WHERE flow_step IS NOT NULL;
CREATE INDEX idx_cm_role          ON app.chat_messages(session_id, role);


-- ---------------------------------------------------------------------------
-- TRIGGER: update session stats on new message
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app.on_chat_message_inserted()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE app.chat_sessions
  SET
    last_message_at = NEW.created_at,
    message_count   = message_count + 1,
    total_tokens    = total_tokens + COALESCE(NEW.tokens_used, 0),
    -- Extend expiry on activity
    expires_at      = GREATEST(expires_at, NEW.created_at + INTERVAL '24 hours'),
    current_step    = COALESCE(NEW.flow_step, current_step)
  WHERE session_id = NEW.session_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_cm_update_session
  AFTER INSERT ON app.chat_messages
  FOR EACH ROW EXECUTE FUNCTION app.on_chat_message_inserted();


-- ---------------------------------------------------------------------------
-- app.notifications
-- Delivery log for all outbound notifications (push, SMS, WhatsApp).
-- Used for deduplication, retry logic, and delivery tracking.
-- ---------------------------------------------------------------------------

CREATE TABLE app.notifications (
  notification_id    TEXT                                 NOT NULL PRIMARY KEY DEFAULT gen_ulid(),
  user_id            TEXT                                 NOT NULL,
  event_type         VARCHAR(60)                          NOT NULL, -- e.g. 'pay_cycle.due'
  channel            public.notification_channel_enum    NOT NULL,
  language_code      CHAR(2)                              NOT NULL DEFAULT 'en',

  -- Content (stored for audit / retry)
  title              VARCHAR(120),
  body               TEXT,
  deep_link          TEXT,                                -- App deep link URL

  -- Delivery state
  status             public.notification_status_enum     NOT NULL DEFAULT 'pending',
  provider_ref       VARCHAR(120),                        -- Twilio SID, FCM message ID, etc.
  failure_reason     TEXT,
  attempt_count      SMALLINT                             NOT NULL DEFAULT 0,
  max_attempts       SMALLINT                             NOT NULL DEFAULT 3,

  -- Related entity (for context / deep link construction)
  related_entity_id  TEXT,                                -- pay_cycle_id, agreement_id, etc.
  related_entity_type VARCHAR(40),                        -- 'pay_cycle' | 'agreement' | 'offer' | etc.

  -- Deduplication key (prevent duplicate sends within a time window)
  dedup_key          VARCHAR(120),                        -- e.g. 'pay_due:cycle_id:channel'

  -- Timestamps
  created_at         TIMESTAMPTZ                          NOT NULL DEFAULT now(),
  scheduled_for      TIMESTAMPTZ                          NOT NULL DEFAULT now(), -- For delayed sends
  sent_at            TIMESTAMPTZ,
  delivered_at       TIMESTAMPTZ,

  CONSTRAINT fk_notif_user
    FOREIGN KEY (user_id) REFERENCES app.users(user_id) ON DELETE CASCADE,

  CONSTRAINT chk_notif_language
    CHECK (language_code IN ('en','hi','te','pa','gu','ta','kn','ml','bn')),

  -- Dedup: only one pending/sent notification per dedup_key in a 24h window
  CONSTRAINT uq_notif_dedup
    EXCLUDE USING btree (dedup_key WITH =)
    WHERE (
      dedup_key IS NOT NULL
      AND status IN ('pending', 'sent')
    )
);

COMMENT ON TABLE  app.notifications IS
  'Outbound notification delivery log. Used for dedup, retry, and delivery tracking.';
COMMENT ON COLUMN app.notifications.dedup_key IS
  'Prevents duplicate notifications. Format: event_type:entity_id:channel. '
  'E.g. pay_cycle.due:cyc_123:whatsapp';
COMMENT ON COLUMN app.notifications.scheduled_for IS
  'Allows delayed sends. Background job queries WHERE scheduled_for <= now() AND status=pending.';

CREATE INDEX idx_notif_user         ON app.notifications(user_id, created_at DESC);
CREATE INDEX idx_notif_status       ON app.notifications(status, scheduled_for)
  WHERE status = 'pending';
CREATE INDEX idx_notif_event        ON app.notifications(event_type, created_at DESC);
CREATE INDEX idx_notif_entity       ON app.notifications(related_entity_type, related_entity_id)
  WHERE related_entity_id IS NOT NULL;
CREATE INDEX idx_notif_retry        ON app.notifications(attempt_count, status)
  WHERE status = 'failed' AND attempt_count < max_attempts;


-- ---------------------------------------------------------------------------
-- RECORD THIS MIGRATION
-- ---------------------------------------------------------------------------

INSERT INTO public.schema_migrations (version) VALUES ('008') ON CONFLICT DO NOTHING;

COMMIT;
