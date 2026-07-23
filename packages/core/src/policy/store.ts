import type { QueryFn } from "../db";
import type { ModuleCatalogEntry, ModulePolicyView, Settings } from "../types";

interface Cached {
  disabled: Set<string>;
  settings: Settings;
}

/**
 * Module policy + settings, as library-owned state over an injected pool. The module CATALOG (which
 * modules exist + their labels) is HOST CONFIG; only runtime state (enabled/disabled, last_seen) and
 * the settings singleton live in the DB. `known` derives from the injected catalog, never a DB set —
 * a module absent from config is unknown even if a stale state row exists.
 *
 * Caches disabled-set + settings; any write invalidates. (Single-instance assumption: a horizontally
 * scaled host would need a TTL + pub/sub invalidation — a documented future seam.)
 */
export class PolicyStore {
  private readonly query: QueryFn;
  private readonly catalogIds: Set<string>;
  private readonly labels: Map<string, string>;
  private cache: Cached | null = null;

  constructor(deps: { query: QueryFn; catalog: ModuleCatalogEntry[] }) {
    this.query = deps.query;
    this.catalogIds = new Set(deps.catalog.map((m) => m.id));
    this.labels = new Map(deps.catalog.map((m) => [m.id, m.label]));
  }

  /** Ensure a state row exists (enabled by default) for every configured module. Idempotent. */
  async reconcile(): Promise<void> {
    for (const id of this.catalogIds) {
      await this.query("INSERT INTO modules (key) VALUES ($1) ON CONFLICT (key) DO NOTHING", [id]);
    }
    this.invalidate();
  }

  private async load(): Promise<Cached> {
    const mods = await this.query<{ key: string; enabled: boolean }>(
      "SELECT key, enabled FROM modules",
    );
    const s = await this.query<{
      ai_summary_enabled: boolean;
      chatbot_enabled: boolean;
      grouping_enabled: boolean;
      actions_enabled: boolean;
      retention_days: number;
    }>(
      `SELECT ai_summary_enabled, chatbot_enabled, grouping_enabled, actions_enabled, retention_days
         FROM global_settings WHERE id = true`,
    );
    const row = s.rows[0];
    return {
      disabled: new Set(mods.rows.filter((r) => !r.enabled).map((r) => r.key)),
      settings: {
        aiSummaryEnabled: row?.ai_summary_enabled ?? true,
        chatbotEnabled: row?.chatbot_enabled ?? true,
        groupingEnabled: row?.grouping_enabled ?? true,
        actionsEnabled: row?.actions_enabled ?? true,
        retentionDays: row?.retention_days ?? 30,
      },
    };
  }

  private async get(): Promise<Cached> {
    return (this.cache ??= await this.load());
  }

  private invalidate(): void {
    this.cache = null;
  }

  /** `known` = the module is in the host catalog; `enabled` = not explicitly disabled in state. */
  async resolveModule(id: string): Promise<{ known: boolean; enabled: boolean }> {
    const state = await this.get();
    return { known: this.catalogIds.has(id), enabled: !state.disabled.has(id) };
  }

  /** Bump a module's last_seen_at (feeds the admin recency sort). No-op for an unknown key. */
  async touchModule(id: string): Promise<void> {
    await this.query("UPDATE modules SET last_seen_at = now() WHERE key = $1", [id]);
  }

  /** Host-config label ⨝ state (enabled, last_seen) ⨝ per-module notification aggregate. */
  async listModules(): Promise<ModulePolicyView[]> {
    const { rows } = await this.query<{
      key: string;
      enabled: boolean;
      last_seen_iso: string;
      total: string;
      suppressed: string;
      crit: string;
      high: string;
      normal: string;
      low: string;
    }>(
      `SELECT m.key, m.enabled,
              to_char(m.last_seen_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.USZ') AS last_seen_iso,
              count(n.id) AS total,
              count(n.id) FILTER (WHERE n.suppressed) AS suppressed,
              count(n.id) FILTER (WHERE n.priority = 'critical') AS crit,
              count(n.id) FILTER (WHERE n.priority = 'high') AS high,
              count(n.id) FILTER (WHERE n.priority = 'normal') AS normal,
              count(n.id) FILTER (WHERE n.priority = 'low') AS low
         FROM modules m
         LEFT JOIN notifications n ON n.module = m.key
        GROUP BY m.key, m.enabled, m.last_seen_at
        ORDER BY m.last_seen_at DESC`,
    );
    return rows.map((r) => ({
      id: r.key,
      label: this.labels.get(r.key) ?? r.key,
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
    }));
  }

  /** Set a module's enabled kill-switch. (The caller checks existence for a 404; this is a no-op
   *  on an unknown key.) */
  async setModuleEnabled(id: string, enabled: boolean): Promise<void> {
    await this.query("UPDATE modules SET enabled = $2 WHERE key = $1", [id, enabled]);
    this.invalidate();
  }

  async getSettings(): Promise<Settings> {
    return (await this.get()).settings;
  }

  async updateSettings(patch: Partial<Settings>): Promise<void> {
    const map: Record<keyof Settings, string> = {
      aiSummaryEnabled: "ai_summary_enabled",
      chatbotEnabled: "chatbot_enabled",
      groupingEnabled: "grouping_enabled",
      actionsEnabled: "actions_enabled",
      retentionDays: "retention_days",
    };
    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const key of Object.keys(map) as (keyof Settings)[]) {
      const v = patch[key];
      if (v !== undefined) {
        vals.push(v);
        sets.push(`${map[key]} = $${vals.length}`);
      }
    }
    if (sets.length === 0) return; // nothing to update
    sets.push("updated_at = now()");
    await this.query(`UPDATE global_settings SET ${sets.join(", ")} WHERE id = true`, vals);
    this.invalidate();
  }
}
