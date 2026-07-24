import type { ModuleActionResponse, NotificationAction } from "@notifications/shared";

/**
 * One dispatchable action a module exposes. `makeAction()` builds the
 * `NotificationAction` a simulated notification would carry (see the emit API,
 * Task 12) — it must produce a valid `kind: "dispatch"` action: a relative
 * `path` starting with `/` (resolved against the module's registered
 * `base_url` by the hub) and metadata under the shared 4KB bound.
 */
export interface ActionCatalogEntry {
  name: string;
  label: string;
  method: "GET" | "POST";
  makeAction(): NotificationAction;
}

/**
 * A simulated module: its dispatchable action catalog plus the handler that
 * mutates its tiny in-memory state and returns the module's verdict. `handle`
 * is called only for a `name` present in `catalog` (the route 404s otherwise)
 * but must still degrade gracefully — it runs inside the route's try/catch, so
 * a throw here never crashes the process.
 */
export interface SimModule {
  key: string;
  catalog: ActionCatalogEntry[];
  handle(name: string, body: { notificationId: string; metadata?: unknown }): ModuleActionResponse;
}
