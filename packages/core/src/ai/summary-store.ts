import type { QueryFn } from "../db";
import type { StoredSummary } from "../types";

interface Row {
  summary: string;
  based_on: number;
  generated_at: Date;
}

/** Latest-only per-user persisted summary, keyed by user_key (identity-free — no join to users). */
export function createSummaryStore(query: QueryFn): {
  get(userKey: string): Promise<StoredSummary | null>;
  upsert(userKey: string, s: StoredSummary): Promise<void>;
} {
  return {
    async get(userKey) {
      const { rows } = await query<Row>(
        "SELECT summary, based_on, generated_at FROM user_summaries WHERE user_key = $1",
        [userKey],
      );
      const r = rows[0];
      if (!r) return null;
      return {
        summary: r.summary,
        basedOn: r.based_on,
        generatedAt: new Date(r.generated_at).toISOString(),
      };
    },
    async upsert(userKey, s) {
      await query(
        `INSERT INTO user_summaries (user_key, summary, based_on, generated_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_key) DO UPDATE
           SET summary = EXCLUDED.summary,
               based_on = EXCLUDED.based_on,
               generated_at = EXCLUDED.generated_at`,
        [userKey, s.summary, s.basedOn, s.generatedAt],
      );
    },
  };
}
