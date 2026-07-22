import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { NotificationService } from "@notifications/core";
import { requireAdmin } from "../../auth/guards";
import { query } from "../../db/pool";

/**
 * Dev/QA database maintenance (POST /admin/maintenance/*). Registered only in non-production
 * (see server.ts isSimulatorEnabled) alongside the generator. All routes are requireAdmin and
 * destructive; each returns the affected row count. SQL is parameterized throughout. Module/settings
 * resets go THROUGH the service so its policy cache invalidates; raw deletes touch notifications only.
 */

const olderThanSchema = z.object({ days: z.number().int().positive() });

export async function maintenanceRoutes(
  app: FastifyInstance,
  service: NotificationService,
): Promise<void> {
  // Dev/QA routes — REFERENCE-APP concerns, not part of the library. They deliberately authorize via
  // the host's own session guard (`requireAdmin`), NOT the plugin's Principal-based admin check; keep
  // the two role checks semantically in sync (both mean "holds the admin role").
  app.post(
    "/admin/maintenance/notifications/delete-all",
    { preHandler: requireAdmin },
    async (_req, reply) => {
      // notification_reads has ON DELETE CASCADE (migration 003), so reads go with the rows.
      const res = await query("DELETE FROM notifications");
      return reply.code(200).send({ deleted: res.rowCount ?? 0 });
    },
  );

  app.post(
    "/admin/maintenance/notifications/delete-read",
    { preHandler: requireAdmin },
    async (_req, reply) => {
      const res = await query(
        "DELETE FROM notifications WHERE id IN (SELECT notification_id FROM notification_reads)",
      );
      return reply.code(200).send({ deleted: res.rowCount ?? 0 });
    },
  );

  app.post(
    "/admin/maintenance/notifications/delete-older-than",
    { preHandler: requireAdmin },
    async (req, reply) => {
      const parsed = olderThanSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: "invalid request body" });
      const res = await query(
        "DELETE FROM notifications WHERE created_at < now() - make_interval(days => $1)",
        [parsed.data.days],
      );
      return reply.code(200).send({ deleted: res.rowCount ?? 0 });
    },
  );

  app.post(
    "/admin/maintenance/modules/reset",
    { preHandler: requireAdmin },
    async (_req, reply) => {
      // "reset" re-enables every disabled module (via the service, so its policy cache invalidates).
      const disabled = (await service.listModules()).filter((m) => !m.enabled);
      for (const m of disabled) await service.setModuleEnabled(m.id, true);
      return reply.code(200).send({ updated: disabled.length });
    },
  );

  app.post(
    "/admin/maintenance/settings/reset",
    { preHandler: requireAdmin },
    async (_req, reply) => {
      await service.updateSettings({
        aiSummaryEnabled: true,
        chatbotEnabled: true,
        groupingEnabled: true,
        actionsEnabled: true,
        retentionDays: 30,
      });
      return reply.code(200).send({ ok: true });
    },
  );
}
