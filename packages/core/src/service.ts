import type { Pool } from "pg";
import type {
  CategoryMuteTarget,
  FeedSort,
  FeedView,
  MuteRule,
  MuteTargetKind,
  MuteTargetsResponse,
  NotificationCounts,
  NotificationPage,
  GroupedPage,
  NotificationPriority,
  PreferencesPatch,
  UserPreferences,
} from "@notifications/shared";
import { NOTIFICATION_PRIORITIES } from "@notifications/shared";
import { createDb } from "./db";
import { DeliveryHub } from "./delivery/hub";
import { createTextGroupingStrategy } from "./grouping/text-strategy";
import { ingest } from "./pipeline/ingest";
import type { IngestResult } from "./pipeline/boundary";
import { PolicyStore } from "./policy/store";
import { counts } from "./read/counts";
import { list } from "./read/feed";
import { listGrouped } from "./read/grouped";
import { muteTargetCounts } from "./read/mute-targets";
import { markRead, markReadBulk, markReadGroup, markUnread } from "./read/read-state";
import { SummaryEngine } from "./ai/summarize";
import { createSummaryStore } from "./ai/summary-store";
import { createPreferencesStore } from "./preferences/store";
import { AnswerEngine, type AnswerChunk, type ChatTurn } from "./ai/answer";
import { dispatchAction } from "./action/dispatch";
import type {
  ActionDispatchResult,
  ModulePolicyView,
  NotificationServiceConfig,
  Principal,
  Settings,
  StoredSummary,
} from "./types";

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
    view?: FeedView;
    group?: string;
    read?: boolean;
  }): Promise<NotificationPage>;
  /** The collapsed grouped feed: one entry per (group, read-state) with per-section aggregates. */
  listGrouped(args: {
    principal: Principal;
    cursor?: string;
    limit?: number;
    sort?: FeedSort;
  }): Promise<GroupedPage>;
  counts(args: { principal: Principal }): Promise<NotificationCounts>;
  markRead(args: { principal: Principal; id: string }): Promise<void>;
  markReadBulk(args: { principal: Principal; ids: string[] }): Promise<void>;
  /** Mark every visible member of one group read (a stack's "Mark all read"). */
  markReadGroup(args: { principal: Principal; group: string }): Promise<void>;
  markUnread(args: { principal: Principal; id: string }): Promise<void>;

  /** Forward a user's `dispatch` action to its owning module and relay the module's response. Throws
   *  ActionsDisabledError (feature off), ModuleUnavailableError (no dispatcher / module disabled /
   *  no base_url), or NotFoundError (notification not visible / bad actionRef / not a dispatch
   *  action). Idempotent on `idempotencyKey`: a replay returns the recorded result without
   *  re-dispatching. */
  dispatchAction(args: {
    principal: Principal;
    notificationId: string;
    actionRef: string;
    idempotencyKey: string;
  }): Promise<ActionDispatchResult>;

  listModules(): Promise<ModulePolicyView[]>;
  setModuleEnabled(id: string, enabled: boolean): Promise<void>;
  setModuleBaseUrl(id: string, baseUrl: string | null): Promise<void>;
  getSettings(): Promise<Settings>;
  updateSettings(patch: Partial<Settings>): Promise<void>;

  /** AI triage digest of the caller's audience-scoped unread set. Throws AiDisabledError (feature
   *  off), AiNotConfiguredError (no provider), AiRateLimitError, or AiProviderError. */
  summarize(args: { principal: Principal }): Promise<{ summary: string; basedOn: number }>;

  /** Read the caller's persisted summary (scheduled or last manual refresh). Null = none yet. */
  getStoredSummary(args: { principal: Principal }): Promise<StoredSummary | null>;

  /** Generate the caller's summary now, persist it with a fresh generatedAt, and return it. Same
   *  gating/rate-limit as `summarize`. Nothing unread → a based_on:0 marker, no provider call. */
  refreshSummary(args: { principal: Principal }): Promise<StoredSummary>;

  /** Streaming Q/A grounded in the caller's audience-scoped notifications (read+unread). The async
   *  generator gates on its first `.next()`: throws AiDisabledError (chat off), AiNotConfiguredError
   *  (no streaming provider), AiRateLimitError; then yields a `sources` chunk followed by `delta`
   *  token chunks; AiProviderError mid-stream. */
  answer(args: {
    principal: Principal;
    question: string;
    history: ChatTurn[];
  }): AsyncIterable<AnswerChunk>;

  /** The caller's scalar preferences (grouping / summary opt-out / toast). Column defaults when unset. */
  getPreferences(args: { principal: Principal }): Promise<UserPreferences>;
  /** Partial-update the caller's scalar preferences; returns the merged result. */
  updatePreferences(args: {
    principal: Principal;
    patch: PreferencesPatch;
  }): Promise<UserPreferences>;
  /** The caller's active snooze/mute rules. */
  listMuteRules(args: { principal: Principal }): Promise<MuteRule[]>;
  /** Upsert a snooze/mute rule for the caller. `until` null = mute; ISO datetime = snooze-until. */
  putMuteRule(args: {
    principal: Principal;
    targetKind: MuteTargetKind;
    target: string;
    until: string | null;
  }): Promise<void>;
  /** Remove a snooze/mute rule for the caller. Returns whether a row was deleted. */
  deleteMuteRule(args: {
    principal: Principal;
    targetKind: MuteTargetKind;
    target: string;
  }): Promise<boolean>;

  /** The modules + categories the caller can snooze/mute, each with their own priority mix. Modules
   *  come from the host catalog; categories are every category in the caller's notifications plus any
   *  they've already muted (so a muted target stays visible to un-mute). */
  getMuteTargets(args: { principal: Principal }): Promise<MuteTargetsResponse>;

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
  const groupingStrategy = opts.config.groupingStrategy ?? createTextGroupingStrategy();
  const deps = { query, hub, policy, groupingStrategy };
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
  const summaryStore = createSummaryStore(query);
  const preferences = createPreferencesStore(query);

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
    listGrouped: async (args) => {
      const result = await listGrouped(query, args);
      if (!result.ok) throw new InvalidCursorError();
      return result.page;
    },
    counts: (args) => counts(query, args),
    markRead: async (args) => {
      const result = await markRead(query, args);
      if (!result.ok) throw new NotFoundError();
    },
    markReadBulk: (args) => markReadBulk(query, args),
    markReadGroup: (args) => markReadGroup(query, args),
    markUnread: (args) => markUnread(query, args),
    dispatchAction: (args) =>
      dispatchAction({ query, policy, dispatcher: opts.config.actionDispatcher }, args),
    listModules: () => policy.listModules(),
    setModuleEnabled: (id, enabled) => policy.setModuleEnabled(id, enabled),
    setModuleBaseUrl: (id, baseUrl) => policy.setModuleBaseUrl(id, baseUrl),
    getSettings: () => policy.getSettings(),
    updateSettings: (patch) => policy.updateSettings(patch),
    summarize: (args) => summaryEngine.summarize(args.principal),
    getStoredSummary: (args) => summaryStore.get(args.principal.userKey),
    refreshSummary: async (args) => {
      const r = await summaryEngine.summarize(args.principal); // reuses gating + rate-limit + caught-up
      const generatedAt = new Date().toISOString();
      await summaryStore.upsert(args.principal.userKey, {
        summary: r.summary,
        basedOn: r.basedOn,
        generatedAt,
      });
      return { summary: r.summary, basedOn: r.basedOn, generatedAt };
    },
    answer: (args) => answerEngine.answer(args),
    getPreferences: (args) => preferences.getPreferences(args.principal.userKey),
    updatePreferences: (args) => preferences.updatePreferences(args.principal.userKey, args.patch),
    listMuteRules: (args) => preferences.listRules(args.principal.userKey),
    putMuteRule: (args) =>
      preferences.putRule(args.principal.userKey, args.targetKind, args.target, args.until),
    deleteMuteRule: (args) =>
      preferences.deleteRule(args.principal.userKey, args.targetKind, args.target),
    getMuteTargets: async (args) => {
      const [countsByTarget, rules] = await Promise.all([
        muteTargetCounts(query, args.principal),
        preferences.listRules(args.principal.userKey),
      ]);
      const zero = (): Record<NotificationPriority, number> =>
        Object.fromEntries(NOTIFICATION_PRIORITIES.map((p) => [p, 0])) as Record<
          NotificationPriority,
          number
        >;
      // Modules: the host catalog (clean labels), each with this user's mix (0 when they've had none).
      const modules = opts.config.modules.map((m) => {
        const c = countsByTarget.modules[m.id];
        return {
          id: m.id,
          label: m.label,
          byPriority: c?.byPriority ?? zero(),
          total: c?.total ?? 0,
        };
      });
      // Categories: every category present in the user's notifications, PLUS any they've already muted
      // (a muted category with no current items would otherwise vanish and be impossible to un-mute).
      const names = new Set<string>(Object.keys(countsByTarget.categories));
      for (const r of rules) if (r.targetKind === "category") names.add(r.target);
      const categories: CategoryMuteTarget[] = [...names].sort().map((name) => {
        const c = countsByTarget.categories[name];
        return { name, byPriority: c?.byPriority ?? zero(), total: c?.total ?? 0 };
      });
      return { modules, categories };
    },
  };
}
