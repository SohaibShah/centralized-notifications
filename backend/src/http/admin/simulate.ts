import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { NotificationService } from "@notifications/core";
import { type Notification, notificationSchema } from "@notifications/shared";
import { requireAdmin } from "../../auth/guards";
import { getEnv } from "../../config/env";
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
      // Reassign server-unique ids so a repeated burst never dedupes against itself. A
      // `seed` makes simulate()'s *content* reproducible, but it also makes its ids
      // deterministic — without this, re-running the same seeded burst would dedupe every
      // notification and silently report `published: 0`. Seed controls variety, not identity.
      return simulate({ count: spec.count, seed: spec.seed }).map((n) => ({
        ...n,
        id: makeSimId(),
      }));
  }
}

// Ingest in bounded chunks: each chunk's notifications run concurrently, chunks run in
// sequence. Keeps in-flight promises bounded even for a very large burst (up to
// SIMULATE_MAX_BURST) rather than fanning out thousands of concurrent DB writes at once.
const CHUNK = 100;

/**
 * Ingest a batch, chunked, tallying published vs policy-suppressed. IngestResult doesn't expose the
 * delivered/suppressed flag, so we re-derive per module from the service's module list (enabled
 * state), snapshotted once before the loop.
 */
async function ingestAll(
  service: NotificationService,
  batch: Notification[],
): Promise<SimulateResult> {
  let published = 0;
  let suppressed = 0;
  const enabledByModule = new Map((await service.listModules()).map((m) => [m.id, m.enabled]));
  for (let i = 0; i < batch.length; i += CHUNK) {
    const chunk = batch.slice(i, i + CHUNK);
    await Promise.all(
      chunk.map(async (n) => {
        const res = await service.ingest(n);
        if (res.status !== "accepted") return; // duplicate/invalid: not counted (ids are unique)
        if (enabledByModule.get(n.module) ?? true) published++;
        else suppressed++;
      }),
    );
  }
  return { published, suppressed };
}

export async function simulateRoutes(
  app: FastifyInstance,
  service: NotificationService,
): Promise<void> {
  // Dev/QA route — a REFERENCE-APP concern, not part of the library. It deliberately authorizes via
  // the host's own session guard (`requireAdmin`), NOT the plugin's Principal-based admin check; keep
  // the two role checks semantically in sync (both mean "holds the admin role").
  app.post("/admin/simulate", { preHandler: requireAdmin }, async (req, reply) => {
    const parsed = simulateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid request body" });
    const result = await ingestAll(service, buildBatch(parsed.data));
    return reply.code(200).send(result);
  });
}
