import type { Pool } from "pg";
import type { FeedSort, NotificationCounts, NotificationPage } from "@notifications/shared";
import { createDb } from "./db";
import { DeliveryHub } from "./delivery/hub";
import { ingest } from "./pipeline/ingest";
import type { IngestResult } from "./pipeline/boundary";
import { PolicyStore } from "./policy/store";
import { counts } from "./read/counts";
import { list } from "./read/feed";
import { markRead, markReadBulk, markUnread } from "./read/read-state";
import { SummaryEngine } from "./ai/summarize";
import { AnswerEngine, type ChatTurn } from "./ai/answer";
import type { ModulePolicyView, NotificationServiceConfig, Principal, Settings } from "./types";

/** `list` was given a cursor that doesn't decode or was issued for a different sort. */
export class InvalidCursorError extends Error {
  constructor() {
    super("invalid cursor");
    this.name = "InvalidCursorError";
  }
}

/** `markRead` targeted an id outside the caller's audience (indistinguishable from nonexistent). */
export class NotFoundError extends Error {
  constructor() {
    super("not found");
    this.name = "NotFoundError";
  }
}

export interface NotificationService {
  /** Run one-time startup reconciliation (module state rows for the configured catalog). */
  ready(): Promise<void>;

  ingest(raw: unknown): Promise<IngestResult>;

  list(args: {
    principal: Principal;
    cursor?: string;
    limit?: number;
    sort?: FeedSort;
  }): Promise<NotificationPage>;
  counts(args: { principal: Principal }): Promise<NotificationCounts>;
  markRead(args: { principal: Principal; id: string }): Promise<void>;
  markReadBulk(args: { principal: Principal; ids: string[] }): Promise<void>;
  markUnread(args: { principal: Principal; id: string }): Promise<void>;

  listModules(): Promise<ModulePolicyView[]>;
  setModuleEnabled(id: string, enabled: boolean): Promise<void>;
  getSettings(): Promise<Settings>;
  updateSettings(patch: Partial<Settings>): Promise<void>;

  /** AI triage digest of the caller's audience-scoped unread set. Throws AiDisabledError (feature
   *  off), AiNotConfiguredError (no provider), AiRateLimitError, or AiProviderError. */
  summarize(args: { principal: Principal }): Promise<{ summary: string; basedOn: number }>;

  /** Streaming Q/A grounded in the caller's audience-scoped notifications (read+unread). The async
   *  generator gates on its first `.next()`: throws AiDisabledError (chat off), AiNotConfiguredError
   *  (no streaming provider), AiRateLimitError, then yields token deltas; AiProviderError mid-stream. */
  answer(args: {
    principal: Principal;
    question: string;
    history: ChatTurn[];
  }): AsyncIterable<string>;

  /** In-process delivery hub — the SSE transport subscribes here with a principal. */
  readonly delivery: DeliveryHub;
  /** Role that gates admin operations (module toggle, settings). */
  readonly adminRole: string;
}

/**
 * Assemble the notification service over an injected pool + host config. Framework-agnostic: the
 * read methods take an already-resolved `Principal` (a transport adapter produces it from the host's
 * auth). Reads no env, owns no identity table.
 */
export function createNotificationService(opts: {
  pool: Pool;
  config: NotificationServiceConfig;
}): NotificationService {
  const { query } = createDb(opts.pool);
  const hub = new DeliveryHub();
  const policy = new PolicyStore({ query, catalog: opts.config.modules });
  const deps = { query, hub, policy };
  const adminRole = opts.config.adminRole ?? "admin";
  const summaryEngine = new SummaryEngine({
    query,
    getSettings: () => policy.getSettings(),
    provider: opts.config.ai?.provider,
  });
  const answerEngine = new AnswerEngine({
    query,
    getSettings: () => policy.getSettings(),
    provider: opts.config.ai?.provider,
  });

  return {
    delivery: hub,
    adminRole,
    ready: () => policy.reconcile(),
    ingest: (raw) => ingest(deps, raw),
    list: async (args) => {
      const result = await list(query, args);
      if (!result.ok) throw new InvalidCursorError();
      return result.page;
    },
    counts: (args) => counts(query, args),
    markRead: async (args) => {
      const result = await markRead(query, args);
      if (!result.ok) throw new NotFoundError();
    },
    markReadBulk: (args) => markReadBulk(query, args),
    markUnread: (args) => markUnread(query, args),
    listModules: () => policy.listModules(),
    setModuleEnabled: (id, enabled) => policy.setModuleEnabled(id, enabled),
    getSettings: () => policy.getSettings(),
    updateSettings: (patch) => policy.updateSettings(patch),
    summarize: (args) => summaryEngine.summarize(args.principal),
    answer: (args) => answerEngine.answer(args),
  };
}
