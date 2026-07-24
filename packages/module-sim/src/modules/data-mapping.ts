import type { ModuleActionResponse, NotificationAction } from "@notifications/shared";
import type { ActionCatalogEntry, SimModule } from "./types";

function scanId(): string {
  return `scan-${Math.random().toString(36).slice(2, 8)}`;
}

const processed = new Set<string>();

const catalog: ActionCatalogEntry[] = [
  {
    name: "rescan",
    label: "Rescan",
    method: "POST",
    makeAction: (): NotificationAction => ({
      label: "Rescan",
      kind: "dispatch",
      method: "POST",
      path: "/actions/rescan",
      metadata: { scanId: scanId() },
    }),
  },
];

// Rescan doesn't resolve the notification (a new mapping scan is queued, not a final
// decision) so `resolve` is intentionally omitted from its response.
export const dataMapping: SimModule = {
  key: "data-mapping",
  catalog,
  handle(name, body): ModuleActionResponse {
    if (name !== "rescan") return { ok: false, message: "Unknown action" };
    const key = `${name}:${body.notificationId}`;
    if (processed.has(key)) return { ok: false, message: "Already processed" };
    processed.add(key);
    return { ok: true, message: "Rescan queued" };
  },
};
