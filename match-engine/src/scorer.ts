// =============================================================================
// src/scorer.ts — Match Engine Core Scoring Logic
//
// Implements all 9 scoring dimensions from the RasoiLink Feature Spec.
// Pure functions — no database calls. Fully testable in isolation.
//
// Scoring formula:
//   total_score = Σ(dimension_score) / Σ(DIMENSION_MAX) * 100
//   Normalized to 0–100. Matches below 50 are hidden.
//
// Dimension weights (from Feature Spec §02):
//   Location:      20pts  (20%)
//   Pay:           18pts  (18%)
//   Cuisine:       15pts  (15%)
//   Accommodation: 12pts  (12%)
//   Hours:         10pts  (10%)
//   Trust:          8pts   (8%)
//   Experience:     7pts   (7%)
//   Language:       4pts   (4%)
//   Notice:         3pts   (3%)
//   TOTAL:         97pts  (100%)
// =============================================================================

import {
  WorkerMatchProfile,
  ListingMatchProfile,
  DimensionScores,
  HardGateResult,
  MatchResult,
  DIMENSION_MAX,
} from './types';

const CACHE_TTL_MINUTES = 15;
const MINIMUM_VISIBLE_SCORE = 50;
const MINIMUM_TRUST_SCORE = 2.0;
const MINIMUM_PROFILE_COMPLETENESS = 40;

// ─── HARD GATES ──────────────────────────────────────────────────────────────
// Hard gates block a match entirely — score is computed but hidden from both parties.

export function evaluateHardGates(
  worker: WorkerMatchProfile,
  listing: ListingMatchProfile,
): HardGateResult {

  // Worker already has an active agreement
  if (worker.has_active_agreement) {
    return { blocked: true, reason: 'already_employed' };
  }

  // Worker has an open pay dispute — protect them from new matches being used as leverage
  if (worker.has_open_dispute) {
    return { blocked: true, reason: 'open_dispute' };
  }

  // Worker trust score too low (hard floor: 2.0)
  if (worker.trust_score > 0 && worker.trust_score < MINIMUM_TRUST_SCORE) {
    return { blocked: true, reason: 'trust_score_too_low' };
  }

  // Worker profile is too incomplete to match (below 40%)
  if (worker.profile_completeness < MINIMUM_PROFILE_COMPLETENESS) {
    return { blocked: true, reason: 'profile_incomplete' };
  }

  // Owner business not verified — block in strict mode (trust_score = 0 means new/unverified)
  if (!listing.owner_biz_verified) {
    return { blocked: true, reason: 'owner_unverified_strict' };
  }

  // NOTE: work_authorization check is intentionally NOT here — see scoreLocation()
  // Work auth is checked in the API layer as a hard gate before calling this scorer.
  // The scorer itself never receives work_authorization data (privacy by design).

  return { blocked: false, reason: null };
}


// ─── DIMENSION SCORERS ───────────────────────────────────────────────────────

/**
 * LOCATION (max 20)
 * Same state: 20pts
 * Preferred state match: 15pts
 * Adjacent / willing to relocate: 8pts
 * No match: 0pts
 */
export function scoreLocation(
  worker: WorkerMatchProfile,
  listing: ListingMatchProfile,
): number {
  // Exact state match (current location)
  if (worker.current_state === listing.state) return 20;

  // Listing is in worker's preferred state list
  if (worker.preferred_states.includes(listing.state)) return 15;

  // Worker willing to relocate anywhere
  if (worker.willing_to_relocate) return 8;

  return 0;
}


/**
 * PAY (max 18)
 * Scoring: how well the listing's pay range overlaps with worker's expectations.
 *
 * Full overlap (listing max >= worker min AND listing min <= worker max): 18pts
 * Listing max meets worker min exactly: 14pts
 * Listing max is 10% below worker min: 8pts
 * Listing max is 20%+ below worker min: 0pts
 */
export function scorePay(
  worker: WorkerMatchProfile,
  listing: ListingMatchProfile,
): number {
  const wMin = worker.salary_min_cents;
  const wMax = worker.salary_max_cents;
  const lMin = listing.pay_min_cents;
  const lMax = listing.pay_max_cents;

  // Ranges overlap — ideal match
  if (lMax >= wMin && lMin <= wMax) return 18;

  // Listing max just meets worker min (within 5%)
  if (lMax >= wMin * 0.95) return 14;

  // Listing pays close to worker's minimum (within 10%)
  if (lMax >= wMin * 0.90) return 10;

  // Listing pays somewhat below (within 20%)
  if (lMax >= wMin * 0.80) return 5;

  // Listing pays far below expectations
  if (lMax >= wMin * 0.70) return 2;

  return 0;
}


/**
 * CUISINE (max 15)
 * Percentage of listing's required cuisines covered by worker's specializations.
 * 100% match: 15pts, scaled linearly to 0pts for 0% match.
 * Bonus +2pts if worker has ALL required cuisines (no partial knowledge risk).
 */
export function scoreCuisine(
  worker: WorkerMatchProfile,
  listing: ListingMatchProfile,
): number {
  const required = listing.cuisine_required;
  if (required.length === 0) return 10; // No cuisine restriction = decent score

  const workerCuisines = new Set(worker.cuisine_specializations);
  const matched = required.filter(c => workerCuisines.has(c)).length;
  const coverageRatio = matched / required.length;

  const base = Math.round(coverageRatio * 13); // 0–13 based on coverage
  const bonus = matched === required.length ? 2 : 0; // +2 for full coverage

  return Math.min(15, base + bonus);
}


/**
 * ACCOMMODATION (max 12)
 * Needs accommodation + listing provides it (free): 12pts
 * Needs accommodation + listing provides it (paid, reasonable): 9pts
 * Needs accommodation + listing provides it (expensive): 5pts
 * Doesn't need accommodation + listing doesn't provide: 12pts (no friction)
 * Doesn't need accommodation + listing provides it: 10pts (nice bonus)
 * Needs accommodation + listing doesn't provide: 0pts (hard miss)
 */
export function scoreAccommodation(
  worker: WorkerMatchProfile,
  listing: ListingMatchProfile,
): number {
  const workerNeeds = worker.needs_accommodation;
  const listingProvides = listing.accommodation_provided;
  const monthlyCost = listing.accommodation_cost_cents;

  if (workerNeeds && listingProvides) {
    if (monthlyCost === 0)         return 12; // Free housing — perfect
    if (monthlyCost <= 50000)      return 9;  // Up to $500/mo — reasonable
    if (monthlyCost <= 80000)      return 6;  // Up to $800/mo — acceptable
    return 3;                                  // Expensive housing
  }

  if (!workerNeeds && !listingProvides) return 12; // Mutual no-need — no friction
  if (!workerNeeds && listingProvides)  return 10; // Nice perk, not needed
  if (workerNeeds && !listingProvides)  return 0;  // Hard miss

  return 0;
}


/**
 * HOURS (max 10)
 * Industry standard tolerance: workers typically okay with ±10 hrs/week.
 * Within 5 hrs: 10pts, within 10 hrs: 7pts, within 15 hrs: 4pts, else 1pt.
 * We don't have worker's preferred hours explicitly — use role-based estimates.
 * Role-typical hours are used as a baseline for comparison.
 */
export function scoreHours(
  worker: WorkerMatchProfile,
  listing: ListingMatchProfile,
): number {
  // Typical hours by role category (full-time kitchen roles expect 40–50)
  const PART_TIME_ROLES = ['kitchen_helper', 'dishwasher', 'cashier', 'server', 'host', 'delivery_driver'];
  const HEAVY_ROLES = ['head_chef', 'sous_chef', 'manager', 'assistant_manager'];

  const isPartTime = PART_TIME_ROLES.includes(worker.role_code);
  const isHeavy    = HEAVY_ROLES.includes(worker.role_code);

  const targetHours = isPartTime ? 32 : isHeavy ? 50 : 42;
  const listingHours = listing.hours_per_week;
  const diff = Math.abs(listingHours - targetHours);

  if (diff <= 5)  return 10;
  if (diff <= 10) return 7;
  if (diff <= 15) return 4;
  if (diff <= 20) return 2;
  return 1;
}


/**
 * TRUST (max 8)
 * Combines worker's trust score and owner's pay reliability score.
 * Both high (4.5+): 8pts
 * Both decent (3.5+): 5pts
 * New/unrated users get a partial trust benefit of the doubt.
 */
export function scoreTrust(
  worker: WorkerMatchProfile,
  listing: ListingMatchProfile,
): number {
  const workerTrust  = worker.trust_score;
  const ownerPayRel  = listing.owner_pay_reliability;

  // Both verified and highly rated
  if (worker.identity_verified && listing.owner_biz_verified) {
    if (workerTrust >= 4.5 && ownerPayRel >= 4.5) return 8;
    if (workerTrust >= 4.0 && ownerPayRel >= 4.0) return 7;
    if (workerTrust >= 3.5 && ownerPayRel >= 3.5) return 5;
    if (workerTrust >= 2.5 && ownerPayRel >= 2.5) return 3;
    return 2;
  }

  // New users (trust_score = 0 means no ratings yet) — give benefit of the doubt
  if (workerTrust === 0 && worker.identity_verified) return 4; // New verified worker
  if (workerTrust === 0 && !worker.identity_verified) return 2; // New unverified

  // Partially verified
  if (worker.identity_verified) return 3;
  return 1;
}


/**
 * EXPERIENCE (max 7)
 * How well the worker's years of experience meets the listing's requirement.
 * Exceeds by 3+: 7pts
 * Meets exactly: 6pts
 * Within 2 years under: 4pts
 * 3–4 years under: 2pts
 * 5+ years under: 0pts
 */
export function scoreExperience(
  worker: WorkerMatchProfile,
  listing: ListingMatchProfile,
): number {
  const workerYears  = worker.years_experience;
  const requiredYears = listing.years_exp_required;
  const delta = workerYears - requiredYears;

  if (delta >= 3)  return 7; // Well overqualified — also good (mentorship potential)
  if (delta >= 0)  return 6; // Meets requirement exactly
  if (delta >= -2) return 4; // Slightly under — coachable gap
  if (delta >= -4) return 2; // Notable gap — possible with training
  return 0;                  // Significant underqualification
}


/**
 * LANGUAGE (max 4)
 * Does the worker's language appear in listing's preferred languages?
 * Listing has no preference: 3pts (neutral)
 * Worker's language is preferred: 4pts
 * Worker speaks English (universal): 2pts
 * No language match: 1pt (language shouldn't block a great chef)
 */
export function scoreLanguage(
  worker: WorkerMatchProfile,
  listing: ListingMatchProfile,
): number {
  const preferred = listing.languages_preferred;

  if (!preferred || preferred.length === 0) return 3; // No preference — neutral

  if (preferred.includes(worker.language_code)) return 4; // Direct match

  if (worker.language_code === 'en') return 2; // English is always useful

  // Partial match: listing prefers Hindi + worker speaks Punjabi (similar scripts)
  const SIMILAR_LANGUAGE_GROUPS = [
    new Set(['hi', 'pa', 'gu']),  // North Indian group
    new Set(['te', 'ta', 'kn', 'ml']),  // South Indian group
    new Set(['bn']),
  ];
  for (const group of SIMILAR_LANGUAGE_GROUPS) {
    if (group.has(worker.language_code) && preferred.some(l => group.has(l))) {
      return 2; // Similar language family
    }
  }

  return 1; // No match, but don't completely penalize
}


/**
 * NOTICE (max 3)
 * Does the worker's availability align with the listing's notice period expectation?
 * We use a proxy: recent workers (< 1yr experience) are likely available sooner.
 * More experienced workers likely need to give notice at current jobs.
 * 3pts: Available quickly (0–1yr experience or explicitly flagged)
 * 2pts: Standard 2-week notice (2–5yr experience)
 * 1pt:  May need extended notice (5+ years — likely senior role with obligations)
 */
export function scoreNotice(
  worker: WorkerMatchProfile,
  listing: ListingMatchProfile,
): number {
  const requiredWeeks = listing.notice_period_weeks;

  // Approximate worker's likely notice situation by experience proxy
  const estimatedWorkerNoticeWeeks =
    worker.years_experience <= 1 ? 0 :
    worker.years_experience <= 4 ? 2 :
    worker.years_experience <= 8 ? 3 : 4;

  const delta = requiredWeeks - estimatedWorkerNoticeWeeks;

  if (delta >= 0)  return 3; // Listing requires <= what worker likely needs to give
  if (delta >= -1) return 2; // One week gap — minor
  if (delta >= -2) return 1; // Two week gap — noticeable but manageable
  return 0;
}


// ─── COMPOSITE SCORER ────────────────────────────────────────────────────────

export function computeDimensions(
  worker: WorkerMatchProfile,
  listing: ListingMatchProfile,
): DimensionScores {
  return {
    location:      scoreLocation(worker, listing),
    pay:           scorePay(worker, listing),
    cuisine:       scoreCuisine(worker, listing),
    accommodation: scoreAccommodation(worker, listing),
    hours:         scoreHours(worker, listing),
    trust:         scoreTrust(worker, listing),
    experience:    scoreExperience(worker, listing),
    language:      scoreLanguage(worker, listing),
    notice:        scoreNotice(worker, listing),
  };
}

export function computeTotalScore(dims: DimensionScores): number {
  const total = Object.entries(dims).reduce((sum, [key, val]) => {
    const max = DIMENSION_MAX[key as keyof typeof DIMENSION_MAX];
    return sum + Math.min(val, max); // Clamp each dimension to its max
  }, 0);

  const maxPossible = Object.values(DIMENSION_MAX).reduce((a, b) => a + b, 0); // 97
  return Math.round((total / maxPossible) * 100);
}


// ─── MAIN SCORER ─────────────────────────────────────────────────────────────

export function scoreMatch(
  worker: WorkerMatchProfile,
  listing: ListingMatchProfile,
): MatchResult {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + CACHE_TTL_MINUTES * 60_000);

  const hardGate = evaluateHardGates(worker, listing);
  const dimensions = computeDimensions(worker, listing);
  const totalScore = computeTotalScore(dimensions);

  return {
    worker_id:        worker.user_id,
    listing_id:       listing.listing_id,
    total_score:      totalScore,
    dimensions,
    hard_gate_failed: hardGate.blocked,
    hard_gate_reason: hardGate.reason,
    computed_at:      now,
    expires_at:       expiresAt,
    worker_name:      worker.name,
    listing_title:    listing.title,
  };
}

export const MIN_VISIBLE_SCORE = MINIMUM_VISIBLE_SCORE;
