// =============================================================================
// tests/scorer.test.ts — Unit tests for all scoring dimensions
// =============================================================================

import {
  scoreLocation, scorePay, scoreCuisine, scoreAccommodation,
  scoreHours, scoreTrust, scoreExperience, scoreLanguage,
  scoreNotice, computeDimensions, computeTotalScore,
  scoreMatch, evaluateHardGates,
} from '../src/scorer';
import { WorkerMatchProfile, ListingMatchProfile, DIMENSION_MAX } from '../src/types';

// ─── FIXTURES ────────────────────────────────────────────────────────────────

function makeWorker(overrides: Partial<WorkerMatchProfile> = {}): WorkerMatchProfile {
  return {
    user_id:                 'usr_test_worker_001',
    name:                    'Test Worker',
    trust_score:             4.5,
    is_verified:             true,
    language_code:           'hi',
    role_code:               'tandoor_chef',
    years_experience:        8,
    cuisine_specializations: ['north_indian', 'tandoor', 'mughlai'],
    current_state:           'NJ',
    preferred_states:        ['NJ', 'NY', 'CT'],
    willing_to_relocate:     true,
    salary_min_cents:        2000,
    salary_max_cents:        2400,
    pay_freq_pref:           'weekly',
    needs_accommodation:     true,
    work_authorization:      'authorized',
    profile_completeness:    85,
    identity_verified:       true,
    work_history_verified:   true,
    has_active_agreement:    false,
    has_open_dispute:        false,
    ...overrides,
  };
}

function makeListing(overrides: Partial<ListingMatchProfile> = {}): ListingMatchProfile {
  return {
    listing_id:              'lst_test_listing_001',
    owner_id:                'usr_test_owner_001',
    title:                   'Tandoor Chef',
    role_code:               'tandoor_chef',
    cuisine_required:        ['north_indian', 'tandoor'],
    state:                   'NJ',
    city:                    'Edison',
    zip_code:                '08820',
    pay_min_cents:           2000,
    pay_max_cents:           2500,
    pay_frequency:           'weekly',
    hours_per_week:          45,
    years_exp_required:      5,
    accommodation_provided:  true,
    accommodation_cost_cents: 0,
    notice_period_weeks:     2,
    languages_preferred:     ['hi', 'pa'],
    owner_trust_score:       4.7,
    owner_pay_reliability:   4.8,
    owner_biz_verified:      true,
    owner_disputes_12mo:     0,
    owner_active_staff_count: 8,
    ...overrides,
  };
}

// ─── HARD GATE TESTS ─────────────────────────────────────────────────────────

describe('evaluateHardGates', () => {
  it('blocks worker with active agreement', () => {
    const result = evaluateHardGates(
      makeWorker({ has_active_agreement: true }),
      makeListing(),
    );
    expect(result.blocked).toBe(true);
    expect(result.reason).toBe('already_employed');
  });

  it('blocks worker with open dispute', () => {
    const result = evaluateHardGates(
      makeWorker({ has_open_dispute: true }),
      makeListing(),
    );
    expect(result.blocked).toBe(true);
    expect(result.reason).toBe('open_dispute');
  });

  it('blocks worker with trust score below minimum', () => {
    const result = evaluateHardGates(
      makeWorker({ trust_score: 1.5 }),
      makeListing(),
    );
    expect(result.blocked).toBe(true);
    expect(result.reason).toBe('trust_score_too_low');
  });

  it('does not block new workers with zero trust score (no ratings yet)', () => {
    const result = evaluateHardGates(
      makeWorker({ trust_score: 0 }),
      makeListing(),
    );
    expect(result.blocked).toBe(false);
  });

  it('blocks worker with incomplete profile (<40%)', () => {
    const result = evaluateHardGates(
      makeWorker({ profile_completeness: 30 }),
      makeListing(),
    );
    expect(result.blocked).toBe(true);
    expect(result.reason).toBe('profile_incomplete');
  });

  it('blocks unverified owner listing', () => {
    const result = evaluateHardGates(
      makeWorker(),
      makeListing({ owner_biz_verified: false }),
    );
    expect(result.blocked).toBe(true);
    expect(result.reason).toBe('owner_unverified_strict');
  });

  it('passes all gates for ideal worker+listing', () => {
    const result = evaluateHardGates(makeWorker(), makeListing());
    expect(result.blocked).toBe(false);
    expect(result.reason).toBeNull();
  });
});

// ─── LOCATION TESTS ──────────────────────────────────────────────────────────

describe('scoreLocation', () => {
  it('returns 20 for same-state match', () => {
    expect(scoreLocation(makeWorker({ current_state: 'NJ' }), makeListing({ state: 'NJ' }))).toBe(20);
  });

  it('returns 15 when listing state is in preferred states', () => {
    expect(scoreLocation(
      makeWorker({ current_state: 'PA', preferred_states: ['NJ', 'NY'] }),
      makeListing({ state: 'NJ' }),
    )).toBe(15);
  });

  it('returns 8 when worker is willing to relocate anywhere', () => {
    expect(scoreLocation(
      makeWorker({ current_state: 'CA', preferred_states: [], willing_to_relocate: true }),
      makeListing({ state: 'NJ' }),
    )).toBe(8);
  });

  it('returns 0 when no state overlap and not willing to relocate', () => {
    expect(scoreLocation(
      makeWorker({ current_state: 'CA', preferred_states: ['WA'], willing_to_relocate: false }),
      makeListing({ state: 'NJ' }),
    )).toBe(0);
  });

  it('does not exceed maximum', () => {
    expect(scoreLocation(makeWorker(), makeListing())).toBeLessThanOrEqual(DIMENSION_MAX.location);
  });
});

// ─── PAY TESTS ───────────────────────────────────────────────────────────────

describe('scorePay', () => {
  it('returns 18 for full pay range overlap', () => {
    expect(scorePay(
      makeWorker({ salary_min_cents: 2000, salary_max_cents: 2400 }),
      makeListing({ pay_min_cents: 1800, pay_max_cents: 2600 }),
    )).toBe(18);
  });

  it('returns 18 when listing max exactly meets worker min', () => {
    expect(scorePay(
      makeWorker({ salary_min_cents: 2000, salary_max_cents: 2400 }),
      makeListing({ pay_min_cents: 1800, pay_max_cents: 2000 }),
    )).toBe(18);
  });

  it('returns 14 when listing is 3% below worker min', () => {
    const score = scorePay(
      makeWorker({ salary_min_cents: 2000, salary_max_cents: 2400 }),
      makeListing({ pay_min_cents: 1700, pay_max_cents: 1940 }),
    );
    expect(score).toBe(14);
  });

  it('returns 0 when listing pays far below expectations', () => {
    expect(scorePay(
      makeWorker({ salary_min_cents: 2000, salary_max_cents: 2400 }),
      makeListing({ pay_min_cents: 1000, pay_max_cents: 1200 }),
    )).toBe(0);
  });

  it('does not exceed maximum', () => {
    expect(scorePay(makeWorker(), makeListing())).toBeLessThanOrEqual(DIMENSION_MAX.pay);
  });
});

// ─── CUISINE TESTS ───────────────────────────────────────────────────────────

describe('scoreCuisine', () => {
  it('returns 15 for perfect cuisine match with all cuisines covered', () => {
    const score = scoreCuisine(
      makeWorker({ cuisine_specializations: ['north_indian', 'tandoor'] }),
      makeListing({ cuisine_required: ['north_indian', 'tandoor'] }),
    );
    expect(score).toBe(15);
  });

  it('returns partial score for partial coverage', () => {
    const score = scoreCuisine(
      makeWorker({ cuisine_specializations: ['north_indian'] }),
      makeListing({ cuisine_required: ['north_indian', 'tandoor', 'mughlai'] }),
    );
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(15);
  });

  it('returns 0 for no cuisine overlap', () => {
    const score = scoreCuisine(
      makeWorker({ cuisine_specializations: ['south_indian', 'chettinad'] }),
      makeListing({ cuisine_required: ['north_indian', 'tandoor'] }),
    );
    expect(score).toBe(0);
  });

  it('returns reasonable score when listing has no cuisine requirement', () => {
    const score = scoreCuisine(
      makeWorker(),
      makeListing({ cuisine_required: [] }),
    );
    expect(score).toBeGreaterThan(5);
  });

  it('never exceeds maximum', () => {
    expect(scoreCuisine(makeWorker(), makeListing())).toBeLessThanOrEqual(DIMENSION_MAX.cuisine);
  });
});

// ─── ACCOMMODATION TESTS ─────────────────────────────────────────────────────

describe('scoreAccommodation', () => {
  it('returns 12 when worker needs housing and listing provides free', () => {
    expect(scoreAccommodation(
      makeWorker({ needs_accommodation: true }),
      makeListing({ accommodation_provided: true, accommodation_cost_cents: 0 }),
    )).toBe(12);
  });

  it('returns 9 for paid accommodation under $500/mo', () => {
    expect(scoreAccommodation(
      makeWorker({ needs_accommodation: true }),
      makeListing({ accommodation_provided: true, accommodation_cost_cents: 40000 }),
    )).toBe(9);
  });

  it('returns 12 when neither worker nor listing needs accommodation', () => {
    expect(scoreAccommodation(
      makeWorker({ needs_accommodation: false }),
      makeListing({ accommodation_provided: false }),
    )).toBe(12);
  });

  it('returns 0 when worker needs housing but listing does not provide', () => {
    expect(scoreAccommodation(
      makeWorker({ needs_accommodation: true }),
      makeListing({ accommodation_provided: false }),
    )).toBe(0);
  });

  it('returns 10 when listing provides housing but worker does not need it', () => {
    expect(scoreAccommodation(
      makeWorker({ needs_accommodation: false }),
      makeListing({ accommodation_provided: true, accommodation_cost_cents: 0 }),
    )).toBe(10);
  });
});

// ─── TRUST TESTS ─────────────────────────────────────────────────────────────

describe('scoreTrust', () => {
  it('returns 8 for both parties highly rated and verified', () => {
    expect(scoreTrust(
      makeWorker({ trust_score: 4.8, identity_verified: true }),
      makeListing({ owner_pay_reliability: 4.9, owner_biz_verified: true }),
    )).toBe(8);
  });

  it('returns 4 for new verified worker with no ratings', () => {
    expect(scoreTrust(
      makeWorker({ trust_score: 0, identity_verified: true }),
      makeListing({ owner_biz_verified: true }),
    )).toBe(4);
  });

  it('returns 2 for new unverified worker', () => {
    expect(scoreTrust(
      makeWorker({ trust_score: 0, identity_verified: false }),
      makeListing({ owner_biz_verified: true }),
    )).toBe(2);
  });

  it('never exceeds maximum', () => {
    expect(scoreTrust(makeWorker(), makeListing())).toBeLessThanOrEqual(DIMENSION_MAX.trust);
  });
});

// ─── EXPERIENCE TESTS ────────────────────────────────────────────────────────

describe('scoreExperience', () => {
  it('returns 7 when worker greatly exceeds requirement', () => {
    expect(scoreExperience(
      makeWorker({ years_experience: 10 }),
      makeListing({ years_exp_required: 5 }),
    )).toBe(7);
  });

  it('returns 6 when worker exactly meets requirement', () => {
    expect(scoreExperience(
      makeWorker({ years_experience: 5 }),
      makeListing({ years_exp_required: 5 }),
    )).toBe(6);
  });

  it('returns 4 when worker is 2 years under requirement', () => {
    expect(scoreExperience(
      makeWorker({ years_experience: 3 }),
      makeListing({ years_exp_required: 5 }),
    )).toBe(4);
  });

  it('returns 0 when worker is significantly underqualified', () => {
    expect(scoreExperience(
      makeWorker({ years_experience: 0 }),
      makeListing({ years_exp_required: 7 }),
    )).toBe(0);
  });
});

// ─── LANGUAGE TESTS ──────────────────────────────────────────────────────────

describe('scoreLanguage', () => {
  it('returns 4 for direct language match', () => {
    expect(scoreLanguage(
      makeWorker({ language_code: 'hi' }),
      makeListing({ languages_preferred: ['hi', 'pa'] }),
    )).toBe(4);
  });

  it('returns 3 when listing has no language preference', () => {
    expect(scoreLanguage(
      makeWorker({ language_code: 'te' }),
      makeListing({ languages_preferred: [] }),
    )).toBe(3);
  });

  it('returns 2 for English speaker when English not preferred', () => {
    expect(scoreLanguage(
      makeWorker({ language_code: 'en' }),
      makeListing({ languages_preferred: ['hi', 'pa'] }),
    )).toBe(2);
  });

  it('returns 2 for similar language family match', () => {
    const score = scoreLanguage(
      makeWorker({ language_code: 'pa' }),
      makeListing({ languages_preferred: ['hi', 'gu'] }),
    );
    expect(score).toBe(2); // Punjabi + Hindi are in same North Indian group
  });

  it('returns 1 for no match', () => {
    expect(scoreLanguage(
      makeWorker({ language_code: 'ml' }),
      makeListing({ languages_preferred: ['hi', 'pa'] }),
    )).toBe(1);
  });
});

// ─── COMPOSITE SCORER TESTS ──────────────────────────────────────────────────

describe('computeTotalScore', () => {
  it('returns 100 for all-max dimensions', () => {
    const maxDims = {
      location: 20, pay: 18, cuisine: 15, accommodation: 12,
      hours: 10, trust: 8, experience: 7, language: 4, notice: 3,
    };
    expect(computeTotalScore(maxDims)).toBe(100);
  });

  it('returns 0 for all-zero dimensions', () => {
    const zeroDims = {
      location: 0, pay: 0, cuisine: 0, accommodation: 0,
      hours: 0, trust: 0, experience: 0, language: 0, notice: 0,
    };
    expect(computeTotalScore(zeroDims)).toBe(0);
  });

  it('never exceeds 100', () => {
    const overflowDims = {
      location: 99, pay: 99, cuisine: 99, accommodation: 99,
      hours: 99, trust: 99, experience: 99, language: 99, notice: 99,
    };
    expect(computeTotalScore(overflowDims)).toBeLessThanOrEqual(100);
  });
});

// ─── END-TO-END SCENARIO TESTS ───────────────────────────────────────────────

describe('scoreMatch — scenarios', () => {

  it('Rajesh × Spice Route: should score 90+', () => {
    const rajesh = makeWorker({
      trust_score: 4.8, identity_verified: true, work_history_verified: true,
      role_code: 'tandoor_chef', years_experience: 10,
      cuisine_specializations: ['north_indian', 'tandoor', 'mughlai'],
      current_state: 'NJ', preferred_states: ['NJ', 'NY'],
      salary_min_cents: 2200, salary_max_cents: 2600,
      needs_accommodation: true, language_code: 'hi',
    });
    const listing = makeListing({
      role_code: 'tandoor_chef', cuisine_required: ['north_indian', 'tandoor'],
      state: 'NJ', pay_min_cents: 2200, pay_max_cents: 2600,
      accommodation_provided: true, accommodation_cost_cents: 0,
      years_exp_required: 5, languages_preferred: ['hi', 'pa'],
      owner_trust_score: 4.7, owner_pay_reliability: 4.8, owner_biz_verified: true,
    });
    const result = scoreMatch(rajesh, listing);
    expect(result.total_score).toBeGreaterThanOrEqual(90);
    expect(result.hard_gate_failed).toBe(false);
  });

  it('already employed worker: should hard-gate regardless of score', () => {
    const result = scoreMatch(
      makeWorker({ has_active_agreement: true }),
      makeListing(),
    );
    expect(result.hard_gate_failed).toBe(true);
    expect(result.hard_gate_reason).toBe('already_employed');
  });

  it('mismatch scenario: CA worker × NJ listing, no relocation', () => {
    const result = scoreMatch(
      makeWorker({
        current_state: 'CA',
        preferred_states: ['CA', 'WA'],
        willing_to_relocate: false,
        needs_accommodation: false,
        salary_min_cents: 3000,
        salary_max_cents: 3500,
      }),
      makeListing({
        state: 'NJ',
        pay_min_cents: 1800,
        pay_max_cents: 2200,
        accommodation_provided: false,
      }),
    );
    expect(result.total_score).toBeLessThan(50);
    expect(result.hard_gate_failed).toBe(false); // Gating is score-based, not hard-gate
  });

  it('new worker, unverified: no active agreement should still score (lower)', () => {
    const result = scoreMatch(
      makeWorker({
        trust_score: 0,
        identity_verified: false,
        work_history_verified: false,
        profile_completeness: 65,
        years_experience: 2,
      }),
      makeListing(),
    );
    // Should not be hard-gated (only incomplete profile is a hard gate)
    expect(result.hard_gate_failed).toBe(false);
    // Score should be lower due to trust dimension
    expect(result.total_score).toBeLessThan(80);
  });

  it('score has correct structure', () => {
    const result = scoreMatch(makeWorker(), makeListing());
    expect(result).toHaveProperty('worker_id');
    expect(result).toHaveProperty('listing_id');
    expect(result).toHaveProperty('total_score');
    expect(result).toHaveProperty('dimensions');
    expect(result).toHaveProperty('hard_gate_failed');
    expect(result).toHaveProperty('computed_at');
    expect(result).toHaveProperty('expires_at');
    expect(result.total_score).toBeGreaterThanOrEqual(0);
    expect(result.total_score).toBeLessThanOrEqual(100);
    // Expires 15 minutes from now
    const diffMs = result.expires_at.getTime() - result.computed_at.getTime();
    expect(diffMs).toBe(15 * 60 * 1000);
  });

  it('dimension scores respect their individual maximums', () => {
    const result = scoreMatch(makeWorker(), makeListing());
    expect(result.dimensions.location).toBeLessThanOrEqual(DIMENSION_MAX.location);
    expect(result.dimensions.pay).toBeLessThanOrEqual(DIMENSION_MAX.pay);
    expect(result.dimensions.cuisine).toBeLessThanOrEqual(DIMENSION_MAX.cuisine);
    expect(result.dimensions.accommodation).toBeLessThanOrEqual(DIMENSION_MAX.accommodation);
    expect(result.dimensions.hours).toBeLessThanOrEqual(DIMENSION_MAX.hours);
    expect(result.dimensions.trust).toBeLessThanOrEqual(DIMENSION_MAX.trust);
    expect(result.dimensions.experience).toBeLessThanOrEqual(DIMENSION_MAX.experience);
    expect(result.dimensions.language).toBeLessThanOrEqual(DIMENSION_MAX.language);
    expect(result.dimensions.notice).toBeLessThanOrEqual(DIMENSION_MAX.notice);
  });
});
