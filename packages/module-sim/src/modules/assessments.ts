import type { ModuleActionResponse, NotificationAction } from "@notifications/shared";
import type { ActionCatalogEntry, SimModule } from "./types";

const catalog: ActionCatalogEntry[] = [
  {
    name: "snooze",
    label: "Snooze 7 days",
    method: "GET",
    makeAction: (): NotificationAction => ({
      label: "Snooze 7 days",
      kind: "dispatch",
      method: "GET",
      path: "/actions/snooze",
      metadata: { days: 7 },
    }),
  },
];

const processed = new Set<string>();

// Snoozing doesn't resolve the notification (it reappears later) so `resolve` is
// intentionally omitted from its response.
export const assessments: SimModule = {
  key: "assessments",
  catalog,
  handle(name, body): ModuleActionResponse {
    if (name !== "snooze") return { ok: false, message: "Unknown action" };
    const key = `${name}:${body.notificationId}`;
    if (processed.has(key)) return { ok: false, message: "Already processed" };
    processed.add(key);
    return { ok: true, message: "Snoozed 7 days" };
  },
};
