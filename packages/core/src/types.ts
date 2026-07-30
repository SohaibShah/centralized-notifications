import type { NotificationAction } from "@notifications/shared";

/**
 * WHO is asking, as the audience filter needs them. The library's identity contract — the host's
 * auth adapter produces this; core never derives it from an owned users table. `userKey` matches
 * `audience.id` for scope="user"; `roles`/`teamKeys` match scope="role"/"team".
 */
export interface Principal {
  userKey: string;
  roles: string[];
  teamKeys: string[];
}

/** A module the host declares. `id` is the module key producers publish under; `label` is display. */
export interface ModuleCatalogEntry {
  id: string;
  label: string;
}

/** Admin view of a module: host-config label ⨝ library state ⨝ notification aggregate. */
export interface ModulePolicyView {
  id: string;
  label: string;
  enabled: boolean;
  lastSeenAt: string;
  total: number;
  suppressed: number;
  byPriority: Record<"critical" | "high" | "normal" | "low", number>;
  /** The module's registered API base URL (registry data, admin-editable). Null = not dispatchable —
   *  the action dispatcher rejects dispatch actions for this module until an admin sets one. */
  baseUrl: string | null;
}

/** Runtime-toggleable notification-domain settings (feature flags + retention). Library-owned state. */
export interface Settings {
  aiSummaryEnabled: boolean;
  chatbotEnabled: boolean;
  groupingEnabled: boolean;
  actionsEnabled: boolean;
  retentionDays: number;
  /** Admin-configured daily summary time-of-day, 'HH:MM' 24h, applied in each user's own tz. */
  summaryTime: string;
}

/** One chat message in the OpenAI-compatible shape. */
export interface AiMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * A raw model transport the host injects. Core owns the domain prompts (summary now, Q/A later) and
 * only asks the provider to turn messages into a completion — so a host brings a model endpoint, not
 * prompt logic. OpenAI-compatible on purpose: local Ollama, a cloud API, or a scaled cluster all fit.
 */
export interface AiProvider {
  complete(
    messages: AiMessage[],
    opts?: { maxTokens?: number; temperature?: number },
  ): Promise<string>;
  /** OPTIONAL streaming variant for chat — yields token deltas. A summary-only host may omit it;
   *  `service.answer` treats its absence as "AI not configured". */
  completeStream?(
    messages: AiMessage[],
    opts?: { maxTokens?: number; temperature?: number },
  ): AsyncIterable<string>;
}

/**
 * Host-injected outbound transport for `dispatch` actions. Core composes the absolute `url` from the
 * module's registry `base_url` + the action's relative `path`, chooses the `method`, and builds the
 * `body` ({notificationId, actionRef, metadata, actor}); the host impl performs the actual outbound
 * call and returns the parsed JSON body + HTTP status. Core then validates the body. Keeping the
 * concrete HTTP client out of core is what lets `packages/core` stay identity/env-free.
 */
export interface ActionDispatcher {
  dispatch(input: {
    url: string;
    method: "GET" | "POST";
    body: unknown;
  }): Promise<{ status: number; body: unknown }>;
}

/** The relayed outcome of a dispatch action — the hub never interprets it beyond validating shape.
 *  `resolve` mirrors the module's request to mark the source notification read; `actions` lets the
 *  module hand back a replacement action set (e.g. an "Undo"). */
export interface ActionDispatchResult {
  ok: boolean;
  message?: string;
  resolve?: boolean;
  actions?: NotificationAction[];
}

/** What a host injects when constructing the service. `modules` is the host-owned catalog; only
 *  runtime state (enabled/disabled, last_seen) lives in the library's DB. */
export interface NotificationServiceConfig {
  modules: ModuleCatalogEntry[];
  /** Role that gates admin operations (module toggle, settings). Defaults to "admin". */
  adminRole?: string;
  /** Optional AI transport. When absent, AI features (summarize) report "not configured". */
  ai?: { provider: AiProvider };
  /** Optional outbound transport for `dispatch` actions. When absent, dispatch actions report
   *  "module unavailable" (there is no way to reach the module). */
  actionDispatcher?: ActionDispatcher;
}
