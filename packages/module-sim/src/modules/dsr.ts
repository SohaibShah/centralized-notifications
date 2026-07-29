import type { ModuleActionResponse, NotificationAction } from "@notifications/shared";
import type { ActionCatalogEntry, SimModule } from "./types";

function requestId(): string {
  return `req-${Math.random().toString(36).slice(2, 8)}`;
}

// Keyed on `${name}:${notificationId}` so approve/reject are tracked independently even if
// somehow dispatched against the same notification. Module-local, in-memory, dev-only — resets
// on restart, which is fine: module-sim never persists state across runs.
const processed = new Set<string>();

const catalog: ActionCatalogEntry[] = [
  {
    name: "approve",
    label: "Approve",
    method: "POST",
    makeAction: (): NotificationAction => ({
      label: "Approve",
      kind: "dispatch",
      method: "POST",
      path: "/actions/approve",
      metadata: { requestId: requestId() },
    }),
  },
  {
    name: "reject",
    label: "Reject",
    method: "POST",
    makeAction: (): NotificationAction => ({
      label: "Reject",
      kind: "dispatch",
      method: "POST",
      path: "/actions/reject",
      metadata: { requestId: requestId() },
    }),
  },
];

/** Simulates a Data Subject Request module: approve/reject a subject access request. */
export const dsr: SimModule = {
  key: "dsr",
  catalog,
  handle(name, body): ModuleActionResponse {
    if (name !== "approve" && name !== "reject") {
      return { ok: false, message: "Unknown action" };
    }
    const key = `${name}:${body.notificationId}`;
    if (processed.has(key)) return { ok: false, message: "Already processed" };
    processed.add(key);
    return name === "approve"
      ? { ok: true, message: "DSR approved", resolve: true }
      : { ok: true, message: "DSR rejected", resolve: true };
  },
};
