import { createHash } from "node:crypto";
import type { NotificationPriority } from "@notifications/shared";
import type { QueryFn } from "../db";
import type { AiProvider, Principal, Settings } from "../types";
import { audienceWhere } from "../audience/match";
import { counts } from "../read/counts";
import { AiDisabledError, AiNotConfiguredError, AiProviderError, AiRateLimitError } from "./errors";
import { buildSummaryMessages } from "./prompt";

export interface SummaryItem {
  title: string;
  description: string; // truncated to 280 chars
  priority: NotificationPriority;
  module: string;
  category?: string;
  ageMinutes: number;
  hasActions: boolean;
}
export interface SummaryContext {
  items: SummaryItem[];
  totalUnread: number;
  now: string; // ISO reference time for staleness reasoning
}

interface Row {
  id: string;
  title: string;
  description: string;
  priority: NotificationPriority;
  module: string;
  category: string | null;
  actions: unknown[] | null;
  created_at: Date;
}

/** The principal's audience-scoped UNREAD set, capped, critical-first then oldest, shaped for the
 *  prompt. Also returns the ordered ids (for the cache signature). No identity-table join. */
export async function buildSummaryContext(
  query: QueryFn,
  principal: Principal,
  cap: number,
): Promise<{ context: SummaryContext; ids: string[] }> {
  const params: unknown[] = [principal.userKey];
  const audience = audienceWhere(principal, params);
  params.push(cap);
  const { rows } = await query<Row>(
    `SELECT n.id, n.title, n.description, n.priority, n.module, n.category, n.actions, n.created_at
       FROM notifications n
       LEFT JOIN notification_reads r ON r.notification_id = n.id AND r.user_key = $1
      WHERE n.suppressed = false AND r.user_key IS NULL AND ${audience}
      ORDER BY n.priority_rank ASC, n.created_at ASC
      LIMIT $${params.length}`,
    params,
  );

  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const items: SummaryItem[] = rows.map((r) => ({
    title: r.title,
    description: r.description.slice(0, 280),
    priority: r.priority,
    module: r.module,
    ...(r.category != null ? { category: r.category } : {}),
    ageMinutes: Math.max(0, Math.floor((nowMs - r.created_at.getTime()) / 60000)),
    hasActions: Array.isArray(r.actions) && r.actions.length > 0,
  }));
  const totalUnread = (await counts(query, { principal })).unread;
  return { context: { items, totalUnread, now }, ids: rows.map((r) => r.id) };
}

const CAP = 25;
const RATE_LIMIT = 6; // provider calls per recipient per minute

/**
 * Produces the AI triage summary for a principal. Owns gating, the signature cache (so re-asking an
 * unchanged unread set is free), the per-recipient rate limit, and the provider call. Never logs the
 * context or the model output (PII). Single-instance cache, like the policy cache.
 */
export class SummaryEngine {
  private readonly cache = new Map<
    string,
    { signature: string; summary: string; basedOn: number }
  >();
  private readonly calls = new Map<string, number[]>();

  constructor(
    private readonly deps: {
      query: QueryFn;
      getSettings: () => Promise<Settings>;
      provider?: AiProvider;
    },
  ) {}

  async summarize(principal: Principal): Promise<{ summary: string; basedOn: number }> {
    if (!(await this.deps.getSettings()).aiSummaryEnabled) throw new AiDisabledError();
    if (!this.deps.provider) throw new AiNotConfiguredError();

    const { context, ids } = await buildSummaryContext(this.deps.query, principal, CAP);
    if (context.items.length === 0) return { summary: "You're all caught up.", basedOn: 0 };

    const signature = createHash("sha256").update(ids.join("|")).digest("hex");
    const cached = this.cache.get(principal.userKey);
    if (cached && cached.signature === signature) {
      return { summary: cached.summary, basedOn: cached.basedOn };
    }

    this.checkRate(principal.userKey);
    let text: string;
    try {
      text = await this.deps.provider.complete(buildSummaryMessages(context), {
        maxTokens: 300,
        temperature: 0.3,
      });
    } catch (err) {
      throw new AiProviderError((err as Error).message);
    }
    const result = { summary: text.trim(), basedOn: context.items.length };
    this.cache.set(principal.userKey, { signature, ...result });
    return result;
  }

  private checkRate(userKey: string): void {
    const now = Date.now();
    const recent = (this.calls.get(userKey) ?? []).filter((t) => now - t < 60_000);
    if (recent.length >= RATE_LIMIT) throw new AiRateLimitError();
    recent.push(now);
    this.calls.set(userKey, recent);
  }
}
