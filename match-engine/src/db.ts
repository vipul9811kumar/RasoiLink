// =============================================================================
// src/db.ts — Database access layer for the match engine
// =============================================================================

import { Pool, PoolClient } from 'pg';
import { WorkerMatchProfile, ListingMatchProfile, MatchResult } from './types';

let pool: Pool;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });

    pool.on('error', (err) => {
      console.error('Unexpected pg pool error', err);
    });
  }
  return pool;
}

/** Set RLS session variables on a connection */
async function setRlsContext(
  client: PoolClient,
  userId = 'system',
  userRole = 'system',
): Promise<void> {
  await client.query(
    `SET LOCAL app.current_user_id = '${userId}'; SET LOCAL app.current_user_role = '${userRole}';`
  );
}

// ─── WORKER QUERIES ──────────────────────────────────────────────────────────

export async function fetchWorkerProfile(
  workerId: string,
): Promise<WorkerMatchProfile | null> {
  const client = await getPool().connect();
  try {
    await setRlsContext(client);
    const { rows } = await client.query<WorkerMatchProfile>(
      `SELECT * FROM app.worker_match_profile WHERE user_id = $1`,
      [workerId],
    );
    return rows[0] ?? null;
  } finally {
    client.release();
  }
}

export async function fetchAllActiveWorkers(): Promise<WorkerMatchProfile[]> {
  const client = await getPool().connect();
  try {
    await setRlsContext(client);
    const { rows } = await client.query<WorkerMatchProfile>(
      `SELECT * FROM app.worker_match_profile
       WHERE has_active_agreement = false
         AND profile_completeness >= 40`,
    );
    return rows;
  } finally {
    client.release();
  }
}

// ─── LISTING QUERIES ─────────────────────────────────────────────────────────

export async function fetchListingProfile(
  listingId: string,
): Promise<ListingMatchProfile | null> {
  const client = await getPool().connect();
  try {
    await setRlsContext(client);
    const { rows } = await client.query<ListingMatchProfile>(
      `SELECT * FROM app.listing_match_profile WHERE listing_id = $1`,
      [listingId],
    );
    return rows[0] ?? null;
  } finally {
    client.release();
  }
}

export async function fetchActiveListings(
  stateFilter?: string,
): Promise<ListingMatchProfile[]> {
  const client = await getPool().connect();
  try {
    await setRlsContext(client);
    const query = stateFilter
      ? `SELECT * FROM app.listing_match_profile WHERE state = $1`
      : `SELECT * FROM app.listing_match_profile`;
    const { rows } = await client.query<ListingMatchProfile>(
      query,
      stateFilter ? [stateFilter] : [],
    );
    return rows;
  } finally {
    client.release();
  }
}

// ─── CACHED SCORE QUERIES ────────────────────────────────────────────────────

export async function fetchCachedScore(
  workerId: string,
  listingId: string,
): Promise<MatchResult | null> {
  const client = await getPool().connect();
  try {
    await setRlsContext(client);
    const { rows } = await client.query(
      `SELECT * FROM app.match_scores
       WHERE worker_id = $1 AND listing_id = $2 AND expires_at > now()`,
      [workerId, listingId],
    );
    if (!rows[0]) return null;

    const row = rows[0];
    return {
      worker_id:        row.worker_id,
      listing_id:       row.listing_id,
      total_score:      row.total_score,
      dimensions: {
        location:      row.score_location,
        pay:           row.score_pay,
        cuisine:       row.score_cuisine,
        accommodation: row.score_accommodation,
        hours:         row.score_hours,
        trust:         row.score_trust,
        experience:    row.score_experience,
        language:      row.score_language,
        notice:        row.score_notice,
      },
      hard_gate_failed: row.hard_gate_failed,
      hard_gate_reason: row.hard_gate_reason,
      computed_at:      row.computed_at,
      expires_at:       row.expires_at,
    };
  } finally {
    client.release();
  }
}

export async function upsertMatchScore(result: MatchResult): Promise<void> {
  const client = await getPool().connect();
  try {
    await setRlsContext(client);
    await client.query(
      `INSERT INTO app.match_scores (
         worker_id, listing_id, total_score,
         score_location, score_pay, score_cuisine, score_accommodation,
         score_hours, score_trust, score_experience, score_language, score_notice,
         hard_gate_failed, hard_gate_reason, computed_at, expires_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       ON CONFLICT (worker_id, listing_id) DO UPDATE SET
         total_score        = EXCLUDED.total_score,
         score_location     = EXCLUDED.score_location,
         score_pay          = EXCLUDED.score_pay,
         score_cuisine      = EXCLUDED.score_cuisine,
         score_accommodation= EXCLUDED.score_accommodation,
         score_hours        = EXCLUDED.score_hours,
         score_trust        = EXCLUDED.score_trust,
         score_experience   = EXCLUDED.score_experience,
         score_language     = EXCLUDED.score_language,
         score_notice       = EXCLUDED.score_notice,
         hard_gate_failed   = EXCLUDED.hard_gate_failed,
         hard_gate_reason   = EXCLUDED.hard_gate_reason,
         computed_at        = EXCLUDED.computed_at,
         expires_at         = EXCLUDED.expires_at`,
      [
        result.worker_id, result.listing_id, result.total_score,
        result.dimensions.location,      result.dimensions.pay,
        result.dimensions.cuisine,       result.dimensions.accommodation,
        result.dimensions.hours,         result.dimensions.trust,
        result.dimensions.experience,    result.dimensions.language,
        result.dimensions.notice,
        result.hard_gate_failed,         result.hard_gate_reason,
        result.computed_at,              result.expires_at,
      ],
    );
  } finally {
    client.release();
  }
}

/** Fetch top matches for a worker from cache, falling back to live compute */
export async function fetchWorkerMatches(
  workerId: string,
  minScore = 50,
  limit = 20,
  offset = 0,
  stateFilter?: string,
  accommodationOnly = false,
): Promise<MatchResult[]> {
  const client = await getPool().connect();
  try {
    await setRlsContext(client);
    let query = `
      SELECT ms.*, l.title as listing_title
      FROM app.match_scores ms
      JOIN app.listings l ON l.listing_id = ms.listing_id
      WHERE ms.worker_id = $1
        AND ms.total_score >= $2
        AND ms.hard_gate_failed = false
        AND ms.expires_at > now()
        AND l.status = 'active'`;
    const params: (string | number | boolean)[] = [workerId, minScore];

    if (stateFilter) {
      params.push(stateFilter);
      query += ` AND l.state = $${params.length}`;
    }
    if (accommodationOnly) {
      query += ` AND l.accommodation_provided = true`;
    }

    params.push(limit, offset);
    query += ` ORDER BY ms.total_score DESC LIMIT $${params.length - 1} OFFSET $${params.length}`;

    const { rows } = await client.query(query, params);
    return rows.map(row => ({
      worker_id:    row.worker_id,
      listing_id:   row.listing_id,
      total_score:  row.total_score,
      dimensions: {
        location:      row.score_location,
        pay:           row.score_pay,
        cuisine:       row.score_cuisine,
        accommodation: row.score_accommodation,
        hours:         row.score_hours,
        trust:         row.score_trust,
        experience:    row.score_experience,
        language:      row.score_language,
        notice:        row.score_notice,
      },
      hard_gate_failed: row.hard_gate_failed,
      hard_gate_reason: row.hard_gate_reason,
      computed_at:  row.computed_at,
      expires_at:   row.expires_at,
      listing_title: row.listing_title,
    }));
  } finally {
    client.release();
  }
}

/** Fetch top candidates for a listing from cache */
export async function fetchListingCandidates(
  listingId: string,
  minScore = 70,
  verifiedOnly = false,
  sort: 'score_desc' | 'trust_desc' | 'experience_desc' = 'score_desc',
  limit = 20,
  offset = 0,
): Promise<MatchResult[]> {
  const client = await getPool().connect();
  try {
    await setRlsContext(client);
    const orderBy = {
      score_desc:      'ms.total_score DESC',
      trust_desc:      'u.trust_score DESC',
      experience_desc: 'wp.years_experience DESC',
    }[sort];

    let query = `
      SELECT ms.*, u.name as worker_name, u.trust_score as worker_trust
      FROM app.match_scores ms
      JOIN app.users u ON u.user_id = ms.worker_id
      JOIN app.worker_profiles wp ON wp.worker_id = ms.worker_id
      WHERE ms.listing_id = $1
        AND ms.total_score >= $2
        AND ms.hard_gate_failed = false
        AND ms.expires_at > now()`;
    const params: (string | number | boolean)[] = [listingId, minScore];

    if (verifiedOnly) {
      query += ` AND u.is_verified = true`;
    }

    params.push(limit, offset);
    query += ` ORDER BY ${orderBy} LIMIT $${params.length - 1} OFFSET $${params.length}`;

    const { rows } = await client.query(query, params);
    return rows.map(row => ({
      worker_id:    row.worker_id,
      listing_id:   row.listing_id,
      total_score:  row.total_score,
      dimensions: {
        location:      row.score_location,
        pay:           row.score_pay,
        cuisine:       row.score_cuisine,
        accommodation: row.score_accommodation,
        hours:         row.score_hours,
        trust:         row.score_trust,
        experience:    row.score_experience,
        language:      row.score_language,
        notice:        row.score_notice,
      },
      hard_gate_failed: row.hard_gate_failed,
      hard_gate_reason: row.hard_gate_reason,
      computed_at:  row.computed_at,
      expires_at:   row.expires_at,
      worker_name:  row.worker_name,
    }));
  } finally {
    client.release();
  }
}

export async function deleteExpiredScores(): Promise<number> {
  const client = await getPool().connect();
  try {
    await setRlsContext(client);
    const { rowCount } = await client.query(
      `DELETE FROM app.match_scores WHERE expires_at < now()`,
    );
    return rowCount ?? 0;
  } finally {
    client.release();
  }
}
