#!/usr/bin/env bash
# =============================================================================
# RasoiLink Database Migration Runner
# =============================================================================
# Usage:
#   ./migrate.sh [up]              — run all pending migrations
#   ./migrate.sh up 005            — run up to and including migration 005
#   ./migrate.sh status            — show current migration status
#   ./migrate.sh rollback 005      — roll back to before migration 005 (if rollback exists)
#   ./migrate.sh validate          — check all migration files exist and checksums match
#
# Environment variables:
#   DATABASE_URL    — full connection string (required)
#                     e.g. postgres://user:pass@host:5432/rasoilink
#   MIGRATIONS_DIR  — path to migration files (default: ./migrations)
#   DRY_RUN         — if "true", print SQL without executing
# =============================================================================

set -euo pipefail

# ─── CONFIG ──────────────────────────────────────────────────────────────────
MIGRATIONS_DIR="${MIGRATIONS_DIR:-$(dirname "$0")/migrations}"
DRY_RUN="${DRY_RUN:-false}"
SCRIPT_VERSION="1.0.0"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# ─── HELPERS ─────────────────────────────────────────────────────────────────
log()  { echo -e "${CYAN}[migrate]${NC} $*"; }
ok()   { echo -e "${GREEN}  ✓${NC} $*"; }
warn() { echo -e "${YELLOW}  ⚠${NC} $*"; }
err()  { echo -e "${RED}  ✗${NC} $*" >&2; }
die()  { err "$*"; exit 1; }

header() {
  echo ""
  echo -e "${BOLD}${BLUE}════════════════════════════════════════════${NC}"
  echo -e "${BOLD}${BLUE}  RasoiLink DB Migration Runner v${SCRIPT_VERSION}${NC}"
  echo -e "${BOLD}${BLUE}════════════════════════════════════════════${NC}"
  echo ""
}

# ─── CHECKS ──────────────────────────────────────────────────────────────────
check_requirements() {
  command -v psql  >/dev/null 2>&1 || die "psql not found. Install PostgreSQL client tools."
  command -v sha256sum >/dev/null 2>&1 || \
  command -v shasum    >/dev/null 2>&1 || die "sha256sum / shasum not found."
  [[ -n "${DATABASE_URL:-}" ]] || die "DATABASE_URL environment variable is not set."
  [[ -d "$MIGRATIONS_DIR" ]]   || die "Migrations directory not found: $MIGRATIONS_DIR"
}

checksum_file() {
  local file="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file" | awk '{print $1}'
  else
    shasum -a 256 "$file" | awk '{print $1}'
  fi
}

# ─── DATABASE CONNECTION ─────────────────────────────────────────────────────
psql_run() {
  psql "$DATABASE_URL" --no-psqlrc --quiet "$@"
}

psql_sql() {
  local sql="$1"
  psql "$DATABASE_URL" --no-psqlrc --quiet --tuples-only --no-align -c "$sql" 2>/dev/null || true
}

ensure_migration_table() {
  psql_run -c "
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      migration_id   TEXT        NOT NULL PRIMARY KEY,
      description    TEXT        NOT NULL DEFAULT '',
      applied_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      applied_by     TEXT        NOT NULL DEFAULT current_user,
      checksum       TEXT,
      execution_ms   INTEGER
    );
  " 2>/dev/null || true
}

# ─── STATUS ──────────────────────────────────────────────────────────────────
cmd_status() {
  header
  log "Checking migration status..."
  echo ""

  ensure_migration_table

  # Get applied migrations from DB
  local applied
  applied=$(psql_sql "SELECT migration_id FROM public.schema_migrations ORDER BY migration_id")

  # Get all migration files
  local files=("$MIGRATIONS_DIR"/[0-9][0-9][0-9]_*.sql)

  printf "  ${BOLD}%-8s  %-12s  %-45s  %s${NC}\n" "ID" "Status" "File" "Applied At"
  printf "  %s\n" "$(printf '─%.0s' {1..90})"

  local pending=0
  local applied_count=0

  for f in "${files[@]}"; do
    [[ -f "$f" ]] || continue
    local fname
    fname=$(basename "$f")
    local id
    id=$(echo "$fname" | grep -oE '^[0-9]+')

    # Check if applied
    if echo "$applied" | grep -q "^${id}$"; then
      local applied_at
      applied_at=$(psql_sql "SELECT applied_at FROM public.schema_migrations WHERE migration_id = '${id}'")
      printf "  ${GREEN}%-8s${NC}  ${GREEN}%-12s${NC}  %-45s  %s\n" \
        "$id" "applied" "$fname" "${applied_at:-unknown}"
      ((applied_count++)) || true
    else
      printf "  ${YELLOW}%-8s${NC}  ${YELLOW}%-12s${NC}  %-45s\n" \
        "$id" "pending" "$fname"
      ((pending++)) || true
    fi
  done

  echo ""
  echo -e "  ${BOLD}Summary:${NC} ${GREEN}${applied_count} applied${NC}, ${YELLOW}${pending} pending${NC}"
  echo ""
}

# ─── UP ──────────────────────────────────────────────────────────────────────
cmd_up() {
  local target_id="${1:-}"
  header
  log "Running pending migrations..."
  [[ "$DRY_RUN" == "true" ]] && warn "DRY RUN MODE — no changes will be applied"
  echo ""

  ensure_migration_table

  # Get applied migrations
  local applied
  applied=$(psql_sql "SELECT migration_id FROM public.schema_migrations ORDER BY migration_id")

  local files=("$MIGRATIONS_DIR"/[0-9][0-9][0-9]_*.sql)
  local ran=0
  local skipped=0

  for f in "${files[@]}"; do
    [[ -f "$f" ]] || continue
    local fname
    fname=$(basename "$f")
    local id
    id=$(echo "$fname" | grep -oE '^[0-9]+')

    # Stop if we've reached the target
    if [[ -n "$target_id" && "$id" > "$target_id" ]]; then
      log "Reached target migration ${target_id}. Stopping."
      break
    fi

    # Skip already-applied
    if echo "$applied" | grep -q "^${id}$"; then
      log "Skipping ${fname} (already applied)"
      ((skipped++)) || true
      continue
    fi

    echo -e "  ${BOLD}→ Applying migration ${id}:${NC} ${fname}"

    local checksum
    checksum=$(checksum_file "$f")
    local start_ms
    start_ms=$(date +%s%3N)

    if [[ "$DRY_RUN" == "true" ]]; then
      warn "  [DRY RUN] Would execute: $f"
    else
      # Run migration with timing
      if psql_run --file="$f" 2>&1; then
        local end_ms
        end_ms=$(date +%s%3N)
        local elapsed=$((end_ms - start_ms))

        # Record checksum and timing
        psql_run -c "
          UPDATE public.schema_migrations
          SET checksum = '${checksum}', execution_ms = ${elapsed}
          WHERE migration_id = '${id}';
        " 2>/dev/null || true

        ok "  Completed in ${elapsed}ms"
        ((ran++)) || true
      else
        err "  Migration ${fname} FAILED"
        err "  Database may be in a partial state."
        err "  Check the migration file and re-run after fixing."
        exit 1
      fi
    fi
  done

  echo ""
  if [[ $ran -eq 0 ]]; then
    ok "Nothing to migrate — database is up to date."
  else
    ok "${ran} migration(s) applied successfully."
  fi
  [[ $skipped -gt 0 ]] && log "${skipped} already-applied migration(s) skipped."
  echo ""
}

# ─── VALIDATE ────────────────────────────────────────────────────────────────
cmd_validate() {
  header
  log "Validating migration files..."
  echo ""

  ensure_migration_table

  local errors=0
  local files=("$MIGRATIONS_DIR"/[0-9][0-9][0-9]_*.sql)

  for f in "${files[@]}"; do
    [[ -f "$f" ]] || continue
    local fname
    fname=$(basename "$f")
    local id
    id=$(echo "$fname" | grep -oE '^[0-9]+')

    # Check for BEGIN and COMMIT
    if ! grep -q "^BEGIN;" "$f"; then
      err "${fname}: Missing 'BEGIN;' — not a transaction"
      ((errors++)) || true
    fi
    if ! grep -q "^COMMIT;" "$f"; then
      err "${fname}: Missing 'COMMIT;' — not a transaction"
      ((errors++)) || true
    fi

    # Check checksum drift for applied migrations
    local stored_checksum
    stored_checksum=$(psql_sql "SELECT checksum FROM public.schema_migrations WHERE migration_id = '${id}'" 2>/dev/null || true)
    local current_checksum
    current_checksum=$(checksum_file "$f")

    if [[ -n "$stored_checksum" && "$stored_checksum" != "$current_checksum" ]]; then
      err "${fname}: CHECKSUM MISMATCH — file modified after apply"
      err "  Stored:  ${stored_checksum}"
      err "  Current: ${current_checksum}"
      ((errors++)) || true
    else
      ok "${fname}"
    fi
  done

  echo ""
  if [[ $errors -eq 0 ]]; then
    ok "All migrations validated successfully."
  else
    die "${errors} validation error(s) found."
  fi
  echo ""
}

# ─── ROLLBACK ────────────────────────────────────────────────────────────────
cmd_rollback() {
  local target_id="${1:-}"
  [[ -n "$target_id" ]] || die "rollback requires a migration ID. Usage: ./migrate.sh rollback 005"

  local rollback_file="${MIGRATIONS_DIR}/${target_id}_rollback.sql"

  if [[ ! -f "$rollback_file" ]]; then
    die "No rollback file found: ${rollback_file}"
  fi

  warn "Rolling back to before migration ${target_id}..."
  warn "This will DELETE data. Are you sure? [type 'yes' to confirm]"
  read -r confirm
  [[ "$confirm" == "yes" ]] || die "Rollback cancelled."

  psql_run --file="$rollback_file"
  psql_run -c "DELETE FROM public.schema_migrations WHERE migration_id >= '${target_id}'"
  ok "Rolled back to before migration ${target_id}."
}

# ─── ENTRY POINT ─────────────────────────────────────────────────────────────
check_requirements

COMMAND="${1:-up}"
ARGUMENT="${2:-}"

case "$COMMAND" in
  up)        cmd_up "$ARGUMENT" ;;
  status)    cmd_status ;;
  validate)  cmd_validate ;;
  rollback)  cmd_rollback "$ARGUMENT" ;;
  *)
    echo "Usage: $0 [up [target_id] | status | validate | rollback <id>]"
    exit 1
    ;;
esac
