BEGIN;

-- Audit log table (simplified — skipping role creation, needs superuser)
CREATE TABLE IF NOT EXISTS audit.event_log (
  event_id      TEXT PRIMARY KEY DEFAULT gen_ulid(),
  user_id       TEXT,
  action        TEXT NOT NULL,
  table_name    TEXT,
  record_id     TEXT,
  old_data      JSONB,
  new_data      JSONB,
  ip_address    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_user    ON audit.event_log(user_id, created_at);
CREATE INDEX idx_audit_table   ON audit.event_log(table_name, record_id);

INSERT INTO public.schema_migrations (version) VALUES ('009') ON CONFLICT DO NOTHING;
COMMIT;
