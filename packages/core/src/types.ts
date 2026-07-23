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
}

/** Runtime-toggleable notification-domain settings (feature flags + retention). Library-owned state. */
export interface Settings {
  aiSummaryEnabled: boolean;
  chatbotEnabled: boolean;
  groupingEnabled: boolean;
  actionsEnabled: boolean;
  retentionDays: number;
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

/** What a host injects when constructing the service. `modules` is the host-owned catalog; only
 *  runtime state (enabled/disabled, last_seen) lives in the library's DB. */
export interface NotificationServiceConfig {
  modules: ModuleCatalogEntry[];
  /** Role that gates admin operations (module toggle, settings). Defaults to "admin". */
  adminRole?: string;
  /** Optional AI transport. When absent, AI features (summarize) report "not configured". */
  ai?: { provider: AiProvider };
}
