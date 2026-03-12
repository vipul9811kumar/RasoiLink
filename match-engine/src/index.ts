// =============================================================================
// src/index.ts — RasoiLink Match Engine HTTP Server
// =============================================================================

import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import {
  getOrComputeScore,
  getWorkerMatches,
  getListingCandidates,
  warmWorkerCache,
  warmListingCache,
  fullRecompute,
  runMaintenance,
} from './engine';
import { MatchApiResponse, MatchResult } from './types';

// ─── BOOTSTRAP ───────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT ?? '3001', 10);
const HOST = process.env.HOST ?? '0.0.0.0';
const IS_DEV = process.env.NODE_ENV !== 'production';

const fastify = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? 'info',
    transport: IS_DEV ? { target: 'pino-pretty', options: { colorize: true } } : undefined,
  },
  genReqId: () => randomUUID(),
});

await fastify.register(cors, {
  origin: process.env.CORS_ORIGIN?.split(',') ?? ['http://localhost:3000'],
  methods: ['GET', 'POST'],
});


// ─── RESPONSE HELPERS ────────────────────────────────────────────────────────

function ok<T>(data: T, requestId: string, startTime: number): MatchApiResponse<T> {
  return {
    success: true,
    data,
    error: null,
    meta: {
      request_id: requestId,
      timestamp:  new Date().toISOString(),
      duration_ms: Date.now() - startTime,
    },
  };
}

function fail(msg: string, requestId: string, startTime: number): MatchApiResponse<null> {
  return {
    success: false,
    data: null,
    error: msg,
    meta: {
      request_id: requestId,
      timestamp:  new Date().toISOString(),
      duration_ms: Date.now() - startTime,
    },
  };
}


// ─── VALIDATION SCHEMAS ──────────────────────────────────────────────────────

const ScoreParamsSchema = z.object({
  worker_id:  z.string().min(1),
  listing_id: z.string().min(1),
});

const WorkerMatchesSchema = z.object({
  worker_id:           z.string().min(1),
  min_score:           z.number().int().min(0).max(100).optional(),
  limit:               z.number().int().min(1).max(50).optional(),
  offset:              z.number().int().min(0).optional(),
  state:               z.string().length(2).optional(),
  accommodation_only:  z.boolean().optional(),
});

const ListingCandidatesSchema = z.object({
  listing_id:     z.string().min(1),
  min_score:      z.number().int().min(0).max(100).optional(),
  verified_only:  z.boolean().optional(),
  sort:           z.enum(['score_desc','trust_desc','experience_desc']).optional(),
  limit:          z.number().int().min(1).max(50).optional(),
  offset:         z.number().int().min(0).optional(),
});

const WarmWorkerSchema  = z.object({ worker_id: z.string().min(1) });
const WarmListingSchema = z.object({ listing_id: z.string().min(1) });


// ─── ROUTES ──────────────────────────────────────────────────────────────────

/** Health check */
fastify.get('/health', async (_req, reply) => {
  reply.send({ status: 'ok', service: 'rasoilink-match-engine', version: '1.0.0' });
});


/**
 * GET /score/:worker_id/:listing_id
 * Compute or retrieve cached match score for one worker × listing pair.
 */
fastify.get<{ Params: { worker_id: string; listing_id: string } }>(
  '/score/:worker_id/:listing_id',
  async (req, reply) => {
    const start = Date.now();
    const reqId = req.id as string;

    const parsed = ScoreParamsSchema.safeParse(req.params);
    if (!parsed.success) {
      return reply.status(400).send(fail('Invalid parameters', reqId, start));
    }

    const force = req.query && (req.query as Record<string,string>).force === 'true';

    try {
      const result = await getOrComputeScore(
        parsed.data.worker_id,
        parsed.data.listing_id,
        req.log,
        force,
      );
      reply.send(ok(formatMatchResult(result), reqId, start));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      req.log.error({ err }, 'score compute error');
      reply.status(404).send(fail(msg, reqId, start));
    }
  },
);


/**
 * POST /matches/worker
 * Get top job matches for a worker.
 *
 * Body: { worker_id, min_score?, limit?, offset?, state?, accommodation_only? }
 */
fastify.post<{ Body: unknown }>(
  '/matches/worker',
  async (req, reply) => {
    const start = Date.now();
    const reqId = req.id as string;

    const parsed = WorkerMatchesSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send(fail(parsed.error.message, reqId, start));
    }

    try {
      const { matches, total } = await getWorkerMatches(parsed.data, req.log);
      reply.send(ok({
        matches: matches.map(formatMatchResult),
        total,
        returned: matches.length,
      }, reqId, start));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      req.log.error({ err }, 'worker matches error');
      reply.status(500).send(fail(msg, reqId, start));
    }
  },
);


/**
 * POST /matches/listing
 * Get top candidates for an owner's listing.
 *
 * Body: { listing_id, min_score?, verified_only?, sort?, limit?, offset? }
 */
fastify.post<{ Body: unknown }>(
  '/matches/listing',
  async (req, reply) => {
    const start = Date.now();
    const reqId = req.id as string;

    const parsed = ListingCandidatesSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send(fail(parsed.error.message, reqId, start));
    }

    try {
      const { candidates, total } = await getListingCandidates(parsed.data, req.log);
      reply.send(ok({
        candidates: candidates.map(formatMatchResult),
        total,
        returned: candidates.length,
      }, reqId, start));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      req.log.error({ err }, 'listing candidates error');
      reply.status(500).send(fail(msg, reqId, start));
    }
  },
);


/**
 * POST /cache/warm/worker
 * Warm match cache for a specific worker (call after profile update).
 */
fastify.post<{ Body: unknown }>(
  '/cache/warm/worker',
  async (req, reply) => {
    const start = Date.now();
    const reqId = req.id as string;

    const parsed = WarmWorkerSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send(fail(parsed.error.message, reqId, start));
    }

    try {
      const count = await warmWorkerCache(parsed.data.worker_id, req.log);
      reply.send(ok({ worker_id: parsed.data.worker_id, scores_computed: count }, reqId, start));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      reply.status(500).send(fail(msg, reqId, start));
    }
  },
);


/**
 * POST /cache/warm/listing
 * Warm match cache for a specific listing (call when listing goes active).
 */
fastify.post<{ Body: unknown }>(
  '/cache/warm/listing',
  async (req, reply) => {
    const start = Date.now();
    const reqId = req.id as string;

    const parsed = WarmListingSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send(fail(parsed.error.message, reqId, start));
    }

    try {
      const count = await warmListingCache(parsed.data.listing_id, req.log);
      reply.send(ok({ listing_id: parsed.data.listing_id, scores_computed: count }, reqId, start));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      reply.status(500).send(fail(msg, reqId, start));
    }
  },
);


/**
 * POST /recompute
 * Trigger full match score recompute (admin/cron use only).
 * Protected by internal secret header.
 */
fastify.post(
  '/recompute',
  async (req, reply) => {
    const start = Date.now();
    const reqId = req.id as string;

    const secret = (req.headers as Record<string,string>)['x-internal-secret'];
    if (secret !== process.env.INTERNAL_SECRET) {
      return reply.status(403).send(fail('Forbidden', reqId, start));
    }

    try {
      const result = await fullRecompute(req.log);
      reply.send(ok(result, reqId, start));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      reply.status(500).send(fail(msg, reqId, start));
    }
  },
);


/**
 * POST /maintenance
 * Delete expired cache entries. Called by cron every 30 minutes.
 */
fastify.post(
  '/maintenance',
  async (req, reply) => {
    const start = Date.now();
    const reqId = req.id as string;

    const secret = (req.headers as Record<string,string>)['x-internal-secret'];
    if (secret !== process.env.INTERNAL_SECRET) {
      return reply.status(403).send(fail('Forbidden', reqId, start));
    }

    await runMaintenance(req.log);
    reply.send(ok({ cleaned: true }, reqId, start));
  },
);


// ─── RESPONSE FORMATTER ──────────────────────────────────────────────────────

function formatMatchResult(r: MatchResult) {
  return {
    worker_id:         r.worker_id,
    listing_id:        r.listing_id,
    total_score:       r.total_score,
    score_breakdown:   r.dimensions,
    hard_gate_failed:  r.hard_gate_failed,
    hard_gate_reason:  r.hard_gate_reason,
    computed_at:       r.computed_at.toISOString(),
    expires_at:        r.expires_at.toISOString(),
    // Metadata (only present if fetched alongside profile data)
    ...(r.worker_name    ? { worker_name:    r.worker_name }    : {}),
    ...(r.listing_title  ? { listing_title:  r.listing_title }  : {}),
  };
}


// ─── START ───────────────────────────────────────────────────────────────────

try {
  await fastify.listen({ port: PORT, host: HOST });
  fastify.log.info(`RasoiLink Match Engine running on port ${PORT}`);
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}
