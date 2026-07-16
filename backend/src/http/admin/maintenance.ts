import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAdmin } from "../../auth/guards";
import { query } from "../../db/pool";
import { invalidatePolicyCache } from "../../pipeline/policy";

/**
 * Dev/QA database maintenance (POST /admin/maintenance/*). Registered only in non-production
 * (see server.ts isSimulatorEnabled) alongside the generator. All routes are requireAdmin and
 * destructive; each returns the affected row count. SQL is parameterized throughout.
 */

const olderThanSchema = z.object({ days: z.number().int().positive() });

export async function maintenanceRoutes(app: FastifyInstance): Promise<void> {
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
      const res = await query("DELETE FROM modules");
      invalidatePolicyCache();
      return reply.code(200).send({ deleted: res.rowCount ?? 0 });
    },
  );

  app.post(
    "/admin/maintenance/settings/reset",
    { preHandler: requireAdmin },
    async (_req, reply) => {
      await query(
        `UPDATE global_settings
            SET ai_summary_enabled = true, chatbot_enabled = true, grouping_enabled = true,
                actions_enabled = true, retention_days = 30, updated_at = now()
          WHERE id = true`,
      );
      invalidatePolicyCache();
      return reply.code(200).send({ ok: true });
    },
  );
}
