import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAdmin, requireUser } from "../../auth/guards";
import { query } from "../../db/pool";
import { deriveLabel } from "../../pipeline/modules";
import { getFeatureFlags, getRetentionDays, invalidatePolicyCache } from "../../pipeline/policy";

const moduleParamsSchema = z.object({ key: z.string().min(1).max(100) });
const modulePatchSchema = z
  .object({ enabled: z.boolean().optional(), label: z.string().max(100).optional() })
  .refine((b) => b.enabled !== undefined || b.label !== undefined, "no fields to update");
const settingsPatchSchema = z
  .object({
    aiSummaryEnabled: z.boolean().optional(),
    chatbotEnabled: z.boolean().optional(),
    groupingEnabled: z.boolean().optional(),
    actionsEnabled: z.boolean().optional(),
    retentionDays: z.number().int().positive().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, "no fields to update");

interface ModuleAggRow {
  key: string;
  label: string;
  enabled: boolean;
  last_seen_iso: string;
  total: string;
  suppressed: string;
  crit: string;
  high: string;
  normal: string;
  low: string;
}

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin/modules", { preHandler: requireAdmin }, async (_req, reply) => {
    const { rows } = await query<ModuleAggRow>(
      `SELECT m.key, m.label, m.enabled,
              to_char(m.last_seen_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.USZ') AS last_seen_iso,
              count(n.id) AS total,
              count(n.id) FILTER (WHERE n.suppressed) AS suppressed,
              count(n.id) FILTER (WHERE n.priority = 'critical') AS crit,
              count(n.id) FILTER (WHERE n.priority = 'high') AS high,
              count(n.id) FILTER (WHERE n.priority = 'normal') AS normal,
              count(n.id) FILTER (WHERE n.priority = 'low') AS low
         FROM modules m
         LEFT JOIN notifications n ON n.module = m.key
        GROUP BY m.key, m.label, m.enabled, m.last_seen_at
        ORDER BY m.last_seen_at DESC`,
    );
    return reply.code(200).send(
      rows.map((r) => ({
        key: r.key,
        label: r.label,
        enabled: r.enabled,
        lastSeenAt: r.last_seen_iso,
        total: Number(r.total),
        suppressed: Number(r.suppressed),
        byPriority: {
          critical: Number(r.crit),
          high: Number(r.high),
          normal: Number(r.normal),
          low: Number(r.low),
        },
      })),
    );
  });

  app.patch("/admin/modules/:key", { preHandler: requireAdmin }, async (req, reply) => {
    const params = moduleParamsSchema.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: "invalid module key" });
    const body = modulePatchSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid request body" });

    const exists = await query("SELECT 1 FROM modules WHERE key = $1", [params.data.key]);
    if (exists.rowCount === 0) return reply.code(404).send({ error: "module not found" });

    if (body.data.enabled !== undefined) {
      await query("UPDATE modules SET enabled = $2 WHERE key = $1", [
        params.data.key,
        body.data.enabled,
      ]);
    }
    if (body.data.label !== undefined) {
      const trimmed = body.data.label.trim();
      const label = trimmed === "" ? deriveLabel(params.data.key) : trimmed;
      await query("UPDATE modules SET label = $2 WHERE key = $1", [params.data.key, label]);
    }
    invalidatePolicyCache();
    return reply.code(204).send();
  });

  app.get("/admin/settings", { preHandler: requireAdmin }, async (_req, reply) => {
    return reply
      .code(200)
      .send({ ...(await getFeatureFlags()), retentionDays: await getRetentionDays() });
  });

  app.patch("/admin/settings", { preHandler: requireAdmin }, async (req, reply) => {
    const body = settingsPatchSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid request body" });
    const map: Record<string, string> = {
      aiSummaryEnabled: "ai_summary_enabled",
      chatbotEnabled: "chatbot_enabled",
      groupingEnabled: "grouping_enabled",
      actionsEnabled: "actions_enabled",
      retentionDays: "retention_days",
    };
    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const [k, col] of Object.entries(map)) {
      const v = (body.data as Record<string, boolean | number | undefined>)[k];
      if (v !== undefined) {
        vals.push(v);
        sets.push(`${col} = $${vals.length}`);
      }
    }
    sets.push("updated_at = now()");
    await query(`UPDATE global_settings SET ${sets.join(", ")} WHERE id = true`, vals);
    invalidatePolicyCache();
    return reply.code(204).send();
  });

  app.get("/settings/features", { preHandler: requireUser }, async (_req, reply) => {
    return reply.code(200).send(await getFeatureFlags());
  });
}
