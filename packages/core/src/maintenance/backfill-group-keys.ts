import type { Notification } from "@notifications/shared";
import type { QueryFn } from "../db";
import type { GroupingStrategy } from "../grouping/types";

/**
 * Re-key every notification by running `strategy.keyFor` and updating group_key/group_label.
 * Idempotent and safe to re-run. Processes in id-keyset batches so it never loads the whole table.
 * Intended for a strategy swap or the initial rollout; run from the reference host.
 */
export async function backfillGroupKeys(
  query: QueryFn,
  strategy: GroupingStrategy,
  batchSize = 500,
): Promise<{ updated: number }> {
  let after = "";
  let updated = 0;
  for (;;) {
    const { rows } = await query<{
      id: string;
      module: string;
      title: string;
      category: string | null;
      metadata: Record<string, unknown> | null;
      priority: Notification["priority"];
    }>(
      `SELECT id, module, title, category, metadata, priority
         FROM notifications WHERE id > $1 ORDER BY id LIMIT $2`,
      [after, batchSize],
    );
    if (rows.length === 0) break;
    for (const r of rows) {
      const g = strategy.keyFor({
        id: r.id,
        module: r.module,
        title: r.title,
        description: "",
        priority: r.priority,
        snoozable: true,
        audience: { scope: "global" },
        ...(r.category != null ? { category: r.category } : {}),
        ...(r.metadata != null ? { metadata: r.metadata } : {}),
      });
      await query("UPDATE notifications SET group_key = $2, group_label = $3 WHERE id = $1", [
        r.id,
        g?.key ?? null,
        g?.label ?? null,
      ]);
      updated++;
    }
    const last = rows[rows.length - 1];
    if (!last) break;
    after = last.id;
  }
  return { updated };
}
