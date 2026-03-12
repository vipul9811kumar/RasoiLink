// =============================================================================
// src/engine.ts — Match Engine Service Orchestrator
//
// Coordinates scoring, caching, and bulk operations.
// Called by HTTP routes and background jobs.
// =============================================================================

import { Logger } from 'pino';
import { scoreMatch, MIN_VISIBLE_SCORE } from './scorer';
import {
  fetchWorkerProfile,
  fetchListingProfile,
  fetchCachedScore,
  upsertMatchScore,
  fetchWorkerMatches,
  fetchListingCandidates,
  fetchAllActiveWorkers,
  fetchActiveListings,
  deleteExpiredScores,
} from './db';
import { MatchResult, WorkerMatchesRequest, ListingCandidatesRequest } from './types';

// ─── SINGLE PAIR SCORING ─────────────────────────────────────────────────────

export async function getOrComputeScore(
  workerId: string,
  listingId: string,
  log: Logger,
  forceRecompute = false,
): Promise<MatchResult> {
  // 1. Try cache first (unless forced recompute)
  if (!forceRecompute) {
    const cached = await fetchCachedScore(workerId, listingId);
    if (cached) {
      log.debug({ workerId, listingId, score: cached.total_score }, 'cache hit');
      return cached;
    }
  }

  // 2. Fetch profiles
  const [worker, listing] = await Promise.all([
    fetchWorkerProfile(workerId),
    fetchListingProfile(listingId),
  ]);

  if (!worker) throw new Error(`Worker not found: ${workerId}`);
  if (!listing) throw new Error(`Listing not found: ${listingId}`);

  // 3. Compute score
  const result = scoreMatch(worker, listing);
  log.debug(
    { workerId, listingId, score: result.total_score, gated: result.hard_gate_failed },
    'score computed',
  );

  // 4. Persist to cache
  await upsertMatchScore(result);

  return result;
}

// ─── WORKER MATCH FEED ───────────────────────────────────────────────────────

export async function getWorkerMatches(
  req: WorkerMatchesRequest,
  log: Logger,
): Promise<{ matches: MatchResult[]; total: number }> {
  const minScore     = req.min_score ?? MIN_VISIBLE_SCORE;
  const limit        = Math.min(req.limit ?? 20, 50);
  const offset       = req.offset ?? 0;

  // Check if worker exists
  const worker = await fetchWorkerProfile(req.worker_id);
  if (!worker) throw new Error(`Worker not found: ${req.worker_id}`);

  // Ensure cache is warm for this worker
  await warmWorkerCache(req.worker_id, log);

  const matches = await fetchWorkerMatches(
    req.worker_id,
    minScore,
    limit,
    offset,
    req.state,
    req.accommodation_only,
  );

  return { matches, total: matches.length };
}

// ─── OWNER CANDIDATE FEED ────────────────────────────────────────────────────

export async function getListingCandidates(
  req: ListingCandidatesRequest,
  log: Logger,
): Promise<{ candidates: MatchResult[]; total: number }> {
  const listing = await fetchListingProfile(req.listing_id);
  if (!listing) throw new Error(`Listing not found: ${req.listing_id}`);

  // Warm cache for this listing
  await warmListingCache(req.listing_id, log);

  const candidates = await fetchListingCandidates(
    req.listing_id,
    req.min_score ?? 70,
    req.verified_only ?? false,
    req.sort ?? 'score_desc',
    req.limit ?? 20,
    req.offset ?? 0,
  );

  return { candidates, total: candidates.length };
}

// ─── CACHE WARMING ───────────────────────────────────────────────────────────

/**
 * Compute scores for a worker against all active listings in their preferred states.
 * Called when worker profile changes or on first access.
 */
export async function warmWorkerCache(workerId: string, log: Logger): Promise<number> {
  const worker = await fetchWorkerProfile(workerId);
  if (!worker) return 0;

  // Only compute for listings in worker's states (performance optimization)
  const targetStates = [worker.current_state, ...worker.preferred_states];
  const uniqueStates = [...new Set(targetStates)];

  let computed = 0;
  for (const state of uniqueStates) {
    const listings = await fetchActiveListings(state);
    await Promise.all(
      listings.map(async listing => {
        try {
          const result = scoreMatch(worker, listing);
          await upsertMatchScore(result);
          computed++;
        } catch (err) {
          log.warn({ workerId, listingId: listing.listing_id, err }, 'score compute failed');
        }
      }),
    );
  }

  log.info({ workerId, computed, states: uniqueStates }, 'worker cache warmed');
  return computed;
}

/**
 * Compute scores for a listing against all active workers in the listing's state.
 * Called when a new listing goes active.
 */
export async function warmListingCache(listingId: string, log: Logger): Promise<number> {
  const listing = await fetchListingProfile(listingId);
  if (!listing) return 0;

  const workers = await fetchAllActiveWorkers();
  const relevantWorkers = workers.filter(
    w =>
      w.current_state === listing.state ||
      w.preferred_states.includes(listing.state) ||
      w.willing_to_relocate,
  );

  let computed = 0;
  // Batch in groups of 50 to avoid overwhelming DB
  const batchSize = 50;
  for (let i = 0; i < relevantWorkers.length; i += batchSize) {
    const batch = relevantWorkers.slice(i, i + batchSize);
    await Promise.all(
      batch.map(async worker => {
        try {
          const result = scoreMatch(worker, listing);
          await upsertMatchScore(result);
          computed++;
        } catch (err) {
          log.warn({ listingId, workerId: worker.user_id, err }, 'score compute failed');
        }
      }),
    );
  }

  log.info({ listingId, computed, workerCount: relevantWorkers.length }, 'listing cache warmed');
  return computed;
}

/**
 * Full recompute job: recompute ALL worker × listing pairs.
 * Run weekly or after major schema changes.
 * WARNING: Expensive. Only run during low-traffic windows.
 */
export async function fullRecompute(log: Logger): Promise<{ pairs: number; duration_ms: number }> {
  const start = Date.now();
  log.info('Starting full match score recompute...');

  const [workers, listings] = await Promise.all([
    fetchAllActiveWorkers(),
    fetchActiveListings(),
  ]);

  log.info({ workers: workers.length, listings: listings.length }, 'loaded profiles');

  let pairs = 0;
  for (const worker of workers) {
    const relevantListings = listings.filter(
      l =>
        l.state === worker.current_state ||
        worker.preferred_states.includes(l.state) ||
        worker.willing_to_relocate,
    );

    await Promise.all(
      relevantListings.map(async listing => {
        const result = scoreMatch(worker, listing);
        await upsertMatchScore(result);
        pairs++;
      }),
    );
  }

  const duration_ms = Date.now() - start;
  log.info({ pairs, duration_ms }, 'full recompute complete');
  return { pairs, duration_ms };
}

// ─── MAINTENANCE ─────────────────────────────────────────────────────────────

export async function runMaintenance(log: Logger): Promise<void> {
  const deleted = await deleteExpiredScores();
  log.info({ deleted }, 'expired match scores cleaned');
}
