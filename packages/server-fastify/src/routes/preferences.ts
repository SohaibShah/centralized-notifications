import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import type { NotificationService } from "@notifications/core";
import {
  MUTE_TARGET_KINDS,
  preferencesPatchSchema,
  putMuteBodySchema,
} from "@notifications/shared";

const patchSchema = preferencesPatchSchema.refine((b) => Object.keys(b).length > 0, {
  message: "no fields to update",
});

const muteParamsSchema = z.object({
  kind: z.enum(MUTE_TARGET_KINDS),
  target: z.string().min(1).max(100),
});

/** Upper bound on distinct snooze/mute rules per user — well above any realistic module+category
 *  count, but a hard stop against unbounded growth from a free-form category loop. */
const MAX_MUTE_RULES = 200;

/**
 * Per-user preferences + snooze/mute rules for the authenticated principal. Every read and write is
 * scoped to `req.principal.userKey` — a user can only ever see or change their own preferences. All
 * input is zod-validated; a module target is checked against the registry so a bogus module can't be
 * written (categories are free-form, validated by shape only).
 */
export function notificationPreferencesRoutes(
  app: FastifyInstance,
  deps: { service: NotificationService; requirePrincipal: preHandlerHookHandler },
): void {
  const { service, requirePrincipal } = deps;

  // The module catalog (id + label only), readable by any authenticated user so the settings page
  // can list modules to snooze/mute. Not the admin view — no per-module stats or state are exposed.
  app.get("/notifications/modules", { preHandler: requirePrincipal }, async (req, reply) => {
    if (!req.principal) return reply.code(401).send({ error: "authentication required" });
    const modules = (await service.listModules()).map((m) => ({ id: m.id, label: m.label }));
    return reply.code(200).send(modules);
  });

  app.get("/notifications/preferences", { preHandler: requirePrincipal }, async (req, reply) => {
    const principal = req.principal;
    if (!principal) return reply.code(401).send({ error: "authentication required" });
    const [prefs, rules] = await Promise.all([
      service.getPreferences({ principal }),
      service.listMuteRules({ principal }),
    ]);
    return reply.code(200).send({ ...prefs, rules });
  });

  app.patch("/notifications/preferences", { preHandler: requirePrincipal }, async (req, reply) => {
    const principal = req.principal;
    if (!principal) return reply.code(401).send({ error: "authentication required" });
    const body = patchSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid request body" });
    const updated = await service.updatePreferences({ principal, patch: body.data });
    return reply.code(200).send(updated);
  });

  app.post(
    "/notifications/mutes/:kind/:target",
    { preHandler: requirePrincipal },
    async (req, reply) => {
      const principal = req.principal;
      if (!principal) return reply.code(401).send({ error: "authentication required" });
      const params = muteParamsSchema.safeParse(req.params);
      if (!params.success) return reply.code(400).send({ error: "invalid mute target" });
      const body = putMuteBodySchema.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: "invalid request body" });

      const { kind, target } = params.data;
      const { until } = body.data;
      // A snooze must be in the future; a mute (null) has no time to check.
      if (until !== null && new Date(until).getTime() <= Date.now()) {
        return reply.code(400).send({ error: "until must be in the future" });
      }
      // Module targets must exist in the registry; categories are free-form (any notification may carry
      // an arbitrary category string), so only their shape is validated.
      if (kind === "module") {
        const known = (await service.listModules()).some((m) => m.id === target);
        if (!known) return reply.code(400).send({ error: "unknown module" });
      }

      // Bound the number of distinct rules a user can create (categories are free-form, so a buggy or
      // hostile client loop could otherwise grow the table unboundedly). Re-muting an existing target
      // is always allowed (it's an upsert, not growth).
      const existing = await service.listMuteRules({ principal });
      const isNewTarget = !existing.some((r) => r.targetKind === kind && r.target === target);
      if (isNewTarget && existing.length >= MAX_MUTE_RULES) {
        return reply.code(400).send({ error: "too many mute rules" });
      }

      await service.putMuteRule({ principal, targetKind: kind, target, until });
      return reply.code(204).send();
    },
  );

  app.delete(
    "/notifications/mutes/:kind/:target",
    { preHandler: requirePrincipal },
    async (req, reply) => {
      const principal = req.principal;
      if (!principal) return reply.code(401).send({ error: "authentication required" });
      const params = muteParamsSchema.safeParse(req.params);
      if (!params.success) return reply.code(400).send({ error: "invalid mute target" });
      // Idempotent: removing an already-absent rule still succeeds.
      await service.deleteMuteRule({
        principal,
        targetKind: params.data.kind,
        target: params.data.target,
      });
      return reply.code(204).send();
    },
  );
}
