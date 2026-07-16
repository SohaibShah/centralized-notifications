import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { type Notification, notificationSchema } from "@notifications/shared";
import { requireAdmin } from "../../auth/guards";
import { getEnv } from "../../config/env";
import { ingest } from "../../pipeline/ingest";
import { isModuleEnabled } from "../../pipeline/policy";
import { buildPreset, PRESET_IDS, sampleActions } from "../../sim/presets";
import { simulate } from "../../sim/simulator";

/**
 * The dev/QA notification generator (POST /admin/simulate). Registered only in
 * non-production (see server.ts `isSimulatorEnabled`) so the route is absent in prod.
 * Every mode server-assigns notification ids and runs each notification through the
 * real `ingest()` pipeline, so dedupe, policy/suppression, and SSE all fire authentically.
 */

const customSchema = z.object({
  mode: z.literal("custom"),
  // Client id is ignored — omit it from the accepted shape so the server always assigns one.
  notification: notificationSchema.omit({ id: true }),
  sampleActions: z.number().int().min(0).max(3).optional(),
});
const presetSchema = z.object({ mode: z.literal("preset"), preset: z.enum(PRESET_IDS) });
const burstSchema = z.object({
  mode: z.literal("burst"),
  count: z.number().int().positive(),
  seed: z.number().int().optional(),
});

// The ceiling is env-configurable, so it can't be a static `.max()` on the member; a
// discriminated-union member also can't be a ZodEffects. Enforce it on the whole union.
const simulateSchema = z
  .discriminatedUnion("mode", [customSchema, presetSchema, burstSchema])
  .superRefine((val, ctx) => {
    if (val.mode === "burst") {
      const max = getEnv().SIMULATE_MAX_BURST;
      if (val.count > max) {
        ctx.addIssue({
          code: z.ZodIssueCode.too_big,
          type: "number",
          maximum: max,
          inclusive: true,
          path: ["count"],
          message: `count exceeds SIMULATE_MAX_BURST (${max})`,
        });
      }
    }
  });

type SimulateInput = z.infer<typeof simulateSchema>;

interface SimulateResult {
  published: number;
  suppressed: number;
}

let simCounter = 0;
function makeSimId(): string {
  // ts + monotonic counter + random keeps ids unique even within a tight burst loop.
  return `sim-${Date.now().toString(36)}-${(simCounter++).toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function buildBatch(spec: SimulateInput): Notification[] {
  switch (spec.mode) {
    case "custom": {
      const actions =
        spec.sampleActions && spec.sampleActions > 0 && !spec.notification.actions
          ? sampleActions(spec.sampleActions)
          : spec.notification.actions;
      return [{ ...spec.notification, id: makeSimId(), ...(actions ? { actions } : {}) }];
    }
    case "preset":
      return [{ ...buildPreset(spec.preset), id: makeSimId() }];
    case "burst":
      // simulate() assigns its own unique per-burst ids — already server-controlled.
      return simulate({ count: spec.count, seed: spec.seed });
  }
}

const CHUNK = 500;

/**
 * Ingest a batch, chunked, tallying published vs policy-suppressed. Since the pipeline's
 * IngestResult doesn't expose the delivered/suppressed flag, we re-derive it per module
 * via isModuleEnabled (cheap, cached in the policy layer and locally memoized here).
 */
async function ingestAll(batch: Notification[]): Promise<SimulateResult> {
  let published = 0;
  let suppressed = 0;
  const enabledByModule = new Map<string, boolean>();
  for (let i = 0; i < batch.length; i += CHUNK) {
    const chunk = batch.slice(i, i + CHUNK);
    await Promise.all(
      chunk.map(async (n) => {
        const res = await ingest(n);
        if (res.status !== "accepted") return; // duplicate/invalid: not counted (ids are unique)
        let enabled = enabledByModule.get(n.module);
        if (enabled === undefined) {
          enabled = await isModuleEnabled(n.module);
          enabledByModule.set(n.module, enabled);
        }
        if (enabled) published++;
        else suppressed++;
      }),
    );
  }
  return { published, suppressed };
}

export async function simulateRoutes(app: FastifyInstance): Promise<void> {
  app.post("/admin/simulate", { preHandler: requireAdmin }, async (req, reply) => {
    const parsed = simulateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid request body" });
    const result = await ingestAll(buildBatch(parsed.data));
    return reply.code(200).send(result);
  });
}
