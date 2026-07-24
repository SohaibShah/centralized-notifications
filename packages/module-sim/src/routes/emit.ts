import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { NOTIFICATION_PRIORITIES, type Notification } from "@notifications/shared";
import type { AppConfig } from "../app";
import { buildCustom, generateBurst, generatePreset, PRESET_IDS } from "../generate";

/**
 * Ceiling on `burst.count` — mirrors the intent of the old admin generator's
 * `SIMULATE_MAX_BURST`. Keeps one `/emit` call from generating (and the hub from having to
 * fan out) an unbounded batch.
 */
export const MAX_BURST = 50;

const burstSchema = z.object({
  mode: z.literal("burst"),
  count: z.number().int().min(1),
  seed: z.number().int().optional(),
});

const presetSchema = z.object({
  mode: z.literal("preset"),
  preset: z.enum(PRESET_IDS),
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
});

const emitBodySchema = z.discriminatedUnion("mode", [burstSchema, presetSchema, customSchema]);

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
      if (body.count > MAX_BURST) {
        reply.code(400).send({ error: `count exceeds max burst of ${MAX_BURST}` });
        return;
      }
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
    } else {
      try {
        batch = [
          buildCustom({
            module: body.module,
            title: body.title,
            description: body.description,
            priority: body.priority,
            actions: body.actions,
          }),
        ];
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
