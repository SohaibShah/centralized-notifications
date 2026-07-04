import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getEnv } from "../config/env";
import { ingest } from "../pipeline/ingest";
import type { IngestResult, IngestStatus } from "./boundary";

// Bounds a single request; a producer sending more than this should page. Keeps one
// call from tying up the pipeline / a runaway loop from flooding intake in one shot.
const MAX_BATCH = 500;

// Explicit request-body cap for the intake route (Fastify's default is 1 MB). Sized
// so a full MAX_BATCH burst of normal notifications fits; a producer batching very
// large payloads gets a deliberate 413 telling it to split, rather than an implicit
// default limit tripping before the MAX_BATCH check runs.
const INTAKE_BODY_LIMIT = 5 * 1024 * 1024;

/** Constant-time token comparison; length mismatch short-circuits (timingSafeEqual
 *  requires equal-length buffers). */
function tokensMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** preHandler: require a valid `x-internal-token` (the service-to-service secret). */
async function requireInternalToken(req: FastifyRequest, reply: FastifyReply) {
  const header = req.headers["x-internal-token"];
  const token = Array.isArray(header) ? header[0] : header;
  if (typeof token !== "string" || !tokensMatch(token, getEnv().INTERNAL_INTAKE_TOKEN)) {
    return reply.code(401).send({ error: "invalid or missing internal token" });
  }
}

/**
 * HTTP intake transport (FR-3): `POST /internal/publish`. Accepts one notification or
 * an array; hands each item to the pipeline independently so one malformed item is
 * reported `invalid` rather than failing the whole batch. Authenticated by the shared
 * internal token (not a user session) and rate-limited per IP.
 */
export async function httpIntake(app: FastifyInstance): Promise<void> {
  // Publishing is a burst endpoint, so a higher ceiling than login; relaxed under
  // test so the suite's rapid injects aren't throttled. (Requires @fastify/rate-limit.)
  const rateLimit = {
    max: getEnv().NODE_ENV === "test" ? 10000 : 120,
    timeWindow: "1 minute",
  };

  app.post(
    "/internal/publish",
    { preHandler: requireInternalToken, config: { rateLimit }, bodyLimit: INTAKE_BODY_LIMIT },
    async (req, reply) => {
      const body = req.body;
      let items: unknown[];
      if (Array.isArray(body)) items = body;
      else if (body !== null && typeof body === "object") items = [body];
      else return reply.code(400).send({ error: "body must be a notification object or an array" });

      if (items.length === 0) return reply.code(400).send({ error: "empty batch" });
      if (items.length > MAX_BATCH) {
        return reply.code(400).send({ error: `batch exceeds max of ${MAX_BATCH}` });
      }

      const counts: Record<IngestStatus, number> = { accepted: 0, duplicate: 0, invalid: 0 };
      const results: IngestResult[] = [];
      for (const item of items) {
        const result = await ingest(item);
        counts[result.status]++;
        results.push(result);
      }
      return reply.code(200).send({ ...counts, results });
    },
  );
}
