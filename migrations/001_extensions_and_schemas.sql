BEGIN;

-- Extensions (pgcrypto works without superuser, skip pg_stat_statements)
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gin;

-- Schemas
CREATE SCHEMA IF NOT EXISTS app;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS audit;
CREATE SCHEMA IF NOT EXISTS ref;

-- ULID generator
CREATE OR REPLACE FUNCTION gen_ulid() RETURNS TEXT AS $$
DECLARE
  ts_ms     BIGINT;
  ts_chars  TEXT := '';
  rand_chars TEXT := '';
  encoding  TEXT := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  i         INT;
  val       BIGINT;
BEGIN
  ts_ms := FLOOR(EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::BIGINT;
  val := ts_ms;
  FOR i IN 1..10 LOOP
    ts_chars := SUBSTRING(encoding, (val % 32)::INT + 1, 1) || ts_chars;
    val := val / 32;
  END LOOP;
  FOR i IN 1..16 LOOP
    rand_chars := rand_chars || SUBSTRING(encoding, (get_byte(gen_random_bytes(1), 0) % 32) + 1, 1);
  END LOOP;
  RETURN ts_chars || rand_chars;
END;
$$ LANGUAGE plpgsql;

-- Migration tracking table
CREATE TABLE IF NOT EXISTS public.schema_migrations (
  version     TEXT PRIMARY KEY,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  checksum    TEXT
);

INSERT INTO public.schema_migrations (version) VALUES ('001') ON CONFLICT DO NOTHING;
COMMIT;
