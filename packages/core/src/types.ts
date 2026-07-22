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

/** Runtime-toggleable notification-domain settings (feature flags + retention). Library-owned state. */
export interface Settings {
  aiSummaryEnabled: boolean;
  chatbotEnabled: boolean;
  groupingEnabled: boolean;
  actionsEnabled: boolean;
  retentionDays: number;
}

/** What a host injects when constructing the service. `modules` is the host-owned catalog; only
 *  runtime state (enabled/disabled, last_seen) lives in the library's DB. */
export interface NotificationServiceConfig {
  modules: ModuleCatalogEntry[];
  /** Role that gates admin operations (module toggle, settings). Defaults to "admin". */
  adminRole?: string;
  // ai?: LlmProviderConfig  // RESERVED for the summarizer sub-project — not built in this pass.
}
