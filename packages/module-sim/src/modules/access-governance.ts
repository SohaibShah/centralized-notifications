import type { ModuleActionResponse, NotificationAction } from "@notifications/shared";
import type { ActionCatalogEntry, SimModule } from "./types";

function grantId(): string {
  return `grant-${Math.random().toString(36).slice(2, 8)}`;
}

const processed = new Set<string>();

const catalog: ActionCatalogEntry[] = [
  {
    name: "revoke",
    label: "Revoke access",
    method: "POST",
    makeAction: (): NotificationAction => ({
      label: "Revoke access",
      kind: "dispatch",
      method: "POST",
      path: "/actions/revoke",
      metadata: { grantId: grantId() },
    }),
  },
];

/** Simulates an Access Governance module: revoke a flagged over-privileged grant. */
export const accessGovernance: SimModule = {
  key: "access-governance",
  catalog,
  handle(name, body): ModuleActionResponse {
    if (name !== "revoke") return { ok: false, message: "Unknown action" };
    const key = `${name}:${body.notificationId}`;
    if (processed.has(key)) return { ok: false, message: "Already processed" };
    processed.add(key);
    return { ok: true, message: "Access revoked", resolve: true };
  },
};
