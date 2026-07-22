import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import type { NotificationService } from "@notifications/core";

const moduleParamsSchema = z.object({ key: z.string().min(1).max(100) });
const modulePatchSchema = z.object({ enabled: z.boolean() });
const settingsPatchSchema = z
  .object({
    aiSummaryEnabled: z.boolean().optional(),
    chatbotEnabled: z.boolean().optional(),
    groupingEnabled: z.boolean().optional(),
    actionsEnabled: z.boolean().optional(),
    retentionDays: z.number().int().positive().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, "no fields to update");

/**
 * Admin routes (module toggle + settings), gated on the admin role, plus the `GET /settings/features`
 * read that any authenticated principal may call (the frontend reads it to gate AI/grouping UI).
 */
export function notificationAdminRoutes(
  app: FastifyInstance,
  deps: {
    service: NotificationService;
    requireAdmin: preHandlerHookHandler;
    requirePrincipal: preHandlerHookHandler;
  },
): void {
  const { service, requireAdmin, requirePrincipal } = deps;

  app.get("/admin/modules", { preHandler: requireAdmin }, async (_req, reply) => {
    // Wire contract exposes the module id as `key` (what producers publish under and the admin UI
    // renders/toggles on); core models it as `id` internally.
    const modules = (await service.listModules()).map((m) => ({
      key: m.id,
      label: m.label,
      enabled: m.enabled,
      lastSeenAt: m.lastSeenAt,
      total: m.total,
      suppressed: m.suppressed,
      byPriority: m.byPriority,
    }));
    return reply.code(200).send(modules);
  });

  app.patch("/admin/modules/:key", { preHandler: requireAdmin }, async (req, reply) => {
    const params = moduleParamsSchema.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: "invalid module key" });
    const body = modulePatchSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid request body" });

    const known = (await service.listModules()).some((m) => m.id === params.data.key);
    if (!known) return reply.code(404).send({ error: "module not found" });

    await service.setModuleEnabled(params.data.key, body.data.enabled);
    return reply.code(204).send();
  });

  app.get("/admin/settings", { preHandler: requireAdmin }, async (_req, reply) => {
    return reply.code(200).send(await service.getSettings());
  });

  app.patch("/admin/settings", { preHandler: requireAdmin }, async (req, reply) => {
    const body = settingsPatchSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid request body" });
    await service.updateSettings(body.data);
    return reply.code(204).send();
  });

  app.get("/settings/features", { preHandler: requirePrincipal }, async (_req, reply) => {
    const { aiSummaryEnabled, chatbotEnabled, groupingEnabled, actionsEnabled } =
      await service.getSettings();
    return reply
      .code(200)
      .send({ aiSummaryEnabled, chatbotEnabled, groupingEnabled, actionsEnabled });
  });
}
