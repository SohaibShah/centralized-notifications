import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { IngestResult, IngestStatus, NotificationService } from "@notifications/core";
import type { NotificationPluginOptions } from "../index";

// Bounds a single request; a producer sending more should page. Keeps one call from tying up the
// pipeline / a runaway loop from flooding intake in one shot.
const MAX_BATCH = 500;
// Explicit body cap (Fastify default is 1 MB), sized so a full MAX_BATCH burst fits.
const INTAKE_BODY_LIMIT = 5 * 1024 * 1024;

/**
 * HTTP intake transport: `POST /internal/publish`. Accepts one notification or an array; each item
 * goes to the pipeline independently so one malformed item is reported `invalid` rather than failing
 * the batch. Gated by the host's `intakeAuth` (a service-to-service secret in the reference app), NOT
 * a user session. Rate-limiting is a host concern — the host adds it around this route if wanted.
 */
export function notificationIntakeRoute(
  app: FastifyInstance,
  deps: { service: NotificationService; intakeAuth: NotificationPluginOptions["intakeAuth"] },
): void {
  const { service, intakeAuth } = deps;

  const requireIntake = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!(await intakeAuth(req))) {
      reply.code(401).send({ error: "invalid or missing internal token" });
    }
  };

  app.post(
    "/internal/publish",
    { preHandler: requireIntake, bodyLimit: INTAKE_BODY_LIMIT },
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
        const result = await service.ingest(item);
        counts[result.status]++;
        results.push(result);
      }
      return reply.code(200).send({ ...counts, results });
    },
  );
}
