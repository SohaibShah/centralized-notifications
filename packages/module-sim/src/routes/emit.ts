import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { audienceSchema, NOTIFICATION_PRIORITIES, type Notification } from "@notifications/shared";
import type { AppConfig } from "../app";
import {
  buildCustom,
  generateBurst,
  generatePreset,
  generateSubjectBurst,
  PRESET_IDS,
} from "../generate";

/**
 * Ceiling on `burst.count` — mirrors the intent of the old admin generator's
 * `SIMULATE_MAX_BURST`. Keeps one `/emit` call from generating (and the hub from having to
 * fan out) an unbounded batch.
 */
export const MAX_BURST = 50;

const burstSchema = z.object({
  mode: z.literal("burst"),
  count: z.number().int().min(1).max(MAX_BURST),
  seed: z.number().int().optional(),
});

const presetSchema = z.object({
  mode: z.literal("preset"),
  preset: z.enum(PRESET_IDS),
});

// One subject, many related updates ("DSAR #4821 received → verified → …") — publishes a thread
// the feed's grouping strategy collapses into a single stack, so grouping is demoable in one
// click. `count` is bounded by MAX_BURST like the other batch modes; `seed` makes it reproducible.
// These thread updates are deliberately NON-actionable (no actions, empty body) — the grouping
// demo doesn't need actions, unlike the custom mode below whose notifications must be actionable.
const subjectSchema = z.object({
  mode: z.literal("subject"),
  count: z.number().int().min(1).max(MAX_BURST).default(4),
  seed: z.number().int().optional(),
});

const customSchema = z.object({
  mode: z.literal("custom"),
  module: z.string().min(1),
  title: z.string().min(1),
  description: z.string(),
  priority: z.enum(NOTIFICATION_PRIORITIES),
  // At least one dispatch action name is required — every notification emit.ts publishes
  // must be actionable (see generate.ts's CustomInput doc comment).
  actions: z.array(z.string().min(1)).min(1).max(5),
  // How many copies of this notification to publish (each gets a fresh id, so the hub keeps all
  // of them). Lets an operator stack a group or fill the feed from one edited template. Bounded
  // by MAX_BURST like a burst; omitted -> 1.
  count: z.number().int().min(1).max(MAX_BURST).default(1),
  // Target audience, validated with the same shared schema the hub uses (so `team`/`role`/`user`
  // scopes require an `id` here too, not just server-side). Omitted -> everyone, matching the
  // old admin generator's `global` default.
  audience: audienceSchema.optional(),
});

const emitBodySchema = z.discriminatedUnion("mode", [
  burstSchema,
  presetSchema,
  subjectSchema,
  customSchema,
]);

/**
 * Registers `POST /emit` — builds a batch of actionable, contract-valid notifications
 * (`generate.ts`) and POSTs it to the hub's `POST /internal/publish`, authenticated with the
 * shared intake token (same secret the backend's own sim scripts use). `fetchImpl` is
 * injectable (defaults to the global `fetch`) purely so tests can fake the hub call without a
 * real server listening.
 */
export function registerEmitRoute(
  app: FastifyInstance,
  config: AppConfig,
  fetchImpl: typeof fetch = fetch,
): void {
  app.post("/emit", async (req, reply) => {
    const parsed = emitBodySchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400).send({ error: "invalid request body", issues: parsed.error.issues });
      return;
    }
    const body = parsed.data;

    let batch: Notification[];
    if (body.mode === "burst") {
      // count is bounded by burstSchema (.max(MAX_BURST)) — same as subject/custom — so no manual
      // cap check here; an over-cap count fails validation above and 400s with the other bad input.
      try {
        batch = generateBurst(body.count, body.seed);
      } catch (err) {
        reply.code(400).send({ error: err instanceof Error ? err.message : "generation failed" });
        return;
      }
    } else if (body.mode === "preset") {
      try {
        batch = generatePreset(body.preset);
      } catch (err) {
        reply.code(400).send({ error: err instanceof Error ? err.message : "generation failed" });
        return;
      }
    } else if (body.mode === "subject") {
      try {
        batch = generateSubjectBurst(body.count, body.seed);
      } catch (err) {
        reply.code(400).send({ error: err instanceof Error ? err.message : "generation failed" });
        return;
      }
    } else {
      try {
        // Each buildCustom() call mints a fresh id (randomUUID), so `count` copies are all kept
        // by the hub rather than deduped down to one.
        batch = Array.from({ length: body.count }, () =>
          buildCustom({
            module: body.module,
            title: body.title,
            description: body.description,
            priority: body.priority,
            actions: body.actions,
            audience: body.audience ?? { scope: "global" },
          }),
        );
      } catch (err) {
        reply
          .code(400)
          .send({ error: err instanceof Error ? err.message : "invalid custom notification" });
        return;
      }
    }

    let res: Response;
    try {
      res = await fetchImpl(`${config.hubUrl}/internal/publish`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-internal-token": config.intakeToken,
        },
        body: JSON.stringify(batch),
      });
    } catch {
      reply.code(502).send({ error: "hub unreachable" });
      return;
    }

    if (!res.ok) {
      reply.code(502).send({ error: "hub rejected publish", status: res.status });
      return;
    }

    reply.code(200).send({ published: batch.length });
  });
}
