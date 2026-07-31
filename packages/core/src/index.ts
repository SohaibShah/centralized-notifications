export { createDb, type QueryFn } from "./db";
export { migrate } from "./migrate";
export { DeliveryHub, type Subscriber } from "./delivery/hub";
export { CoalescingBuffer } from "./delivery/coalescing-buffer";
export {
  createNotificationService,
  InvalidCursorError,
  NotFoundError,
  type NotificationService,
} from "./service";
export { ActionsDisabledError, ModuleUnavailableError } from "./action/dispatch";
export type { IngestResult, IngestStatus } from "./pipeline/boundary";
export {
  AiDisabledError,
  AiNotConfiguredError,
  AiRateLimitError,
  AiProviderError,
} from "./ai/errors";
export type {
  Principal,
  ModuleCatalogEntry,
  ModulePolicyView,
  Settings,
  NotificationServiceConfig,
  ActionDispatcher,
  ActionDispatchResult,
  AiMessage,
  AiProvider,
  StoredSummary,
} from "./types";
export { computeDueSummaries } from "./ai/schedule";
export type { DueUser } from "./ai/schedule";
export type { ChatTurn, AnswerChunk } from "./ai/answer";
export type {
  ChatSource,
  UserPreferences,
  PreferencesPatch,
  MuteRule,
  MuteTargetKind,
  MuteTargetsResponse,
  ModuleMuteTarget,
  CategoryMuteTarget,
} from "@notifications/shared";
export { createPreferencesStore } from "./preferences/store";
export { muteWhere, isSuppressed } from "./preferences/mute";
export type { ChatContextItem } from "./ai/retrieve";
