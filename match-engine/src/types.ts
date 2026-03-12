// =============================================================================
// src/types.ts — All types for the RasoiLink Match Engine
// =============================================================================

// ─── DATABASE FETCH TYPES ────────────────────────────────────────────────────

export interface WorkerMatchProfile {
  user_id:                   string;
  name:                      string;
  trust_score:               number;        // 0.00–5.00
  is_verified:               boolean;
  language_code:             string;
  role_code:                 string;
  years_experience:          number;
  cuisine_specializations:   string[];
  current_state:             string;
  preferred_states:          string[];
  willing_to_relocate:       boolean;
  salary_min_cents:          number;
  salary_max_cents:          number;
  pay_freq_pref:             string;
  needs_accommodation:       boolean;
  work_authorization:        string;        // NEVER included in output
  profile_completeness:      number;        // 0–100
  identity_verified:         boolean;
  work_history_verified:     boolean;
  has_active_agreement:      boolean;       // Hard gate: already employed
  has_open_dispute:          boolean;       // Hard gate: dispute in progress
}

export interface ListingMatchProfile {
  listing_id:                string;
  owner_id:                  string;
  title:                     string;
  role_code:                 string;
  cuisine_required:          string[];
  state:                     string;
  city:                      string;
  zip_code:                  string | null;
  pay_min_cents:             number;
  pay_max_cents:             number;
  pay_frequency:             string;
  hours_per_week:            number;
  years_exp_required:        number;
  accommodation_provided:    boolean;
  accommodation_cost_cents:  number;
  notice_period_weeks:       number;
  languages_preferred:       string[];
  owner_trust_score:         number;
  owner_pay_reliability:     number;
  owner_biz_verified:        boolean;
  owner_disputes_12mo:       number;
  owner_active_staff_count:  number;
}

// ─── SCORE TYPES ─────────────────────────────────────────────────────────────

/** Maximum possible raw score for each dimension (used in normalization) */
export const DIMENSION_MAX = {
  location:      20,
  pay:           18,
  cuisine:       15,
  accommodation: 12,
  hours:         10,
  trust:          8,
  experience:     7,
  language:       4,
  notice:         3,
} as const;

export type DimensionKey = keyof typeof DIMENSION_MAX;

export interface DimensionScores {
  location:      number;   // 0–20
  pay:           number;   // 0–18
  cuisine:       number;   // 0–15
  accommodation: number;   // 0–12
  hours:         number;   // 0–10
  trust:         number;   // 0–8
  experience:    number;   // 0–7
  language:      number;   // 0–4
  notice:        number;   // 0–3
}

export interface HardGateResult {
  blocked:  boolean;
  reason:   HardGateReason | null;
}

export type HardGateReason =
  | 'already_employed'
  | 'open_dispute'
  | 'trust_score_too_low'
  | 'owner_suspended'
  | 'owner_unverified_strict'
  | 'profile_incomplete';

export interface MatchResult {
  worker_id:         string;
  listing_id:        string;
  total_score:       number;        // 0–100
  dimensions:        DimensionScores;
  hard_gate_failed:  boolean;
  hard_gate_reason:  HardGateReason | null;
  computed_at:       Date;
  expires_at:        Date;
  // Metadata for API response (not stored)
  worker_name?:      string;
  listing_title?:    string;
  owner_name?:       string;
}

// ─── API REQUEST / RESPONSE TYPES ────────────────────────────────────────────

export interface ScoreRequest {
  worker_id:  string;
  listing_id: string;
}

export interface BulkScoreRequest {
  worker_id:   string;
  listing_ids: string[];
}

export interface WorkerMatchesRequest {
  worker_id:           string;
  min_score?:          number;    // default 50
  limit?:              number;    // default 20
  offset?:             number;    // default 0
  state?:              string;
  accommodation_only?: boolean;
}

export interface ListingCandidatesRequest {
  listing_id:     string;
  min_score?:     number;    // default 70
  verified_only?: boolean;
  sort?:          'score_desc' | 'trust_desc' | 'experience_desc';
  limit?:         number;
  offset?:        number;
}

export interface MatchApiResponse<T> {
  success:  boolean;
  data:     T | null;
  error:    string | null;
  meta: {
    request_id:  string;
    timestamp:   string;
    duration_ms: number;
  };
}
