import type { NotificationAction } from "@notifications/shared";
import { useFeedStore } from "@/stores/feed";

/** The single action path shared by the notification card and the AI chat. A module action's `kind`
 *  (not its HTTP method) decides behavior: "link" opens the url in a new tab; "dispatch" runs a
 *  server-side action proxy (a later cycle) — stubbed now. Firing any action also marks it read. */
export function useNotificationActions(): {
  runAction: (action: NotificationAction, target: { id: string }) => void;
} {
  const feed = useFeedStore();
  function runAction(action: NotificationAction, target: { id: string }): void {
    feed.markRead(target.id);
    if (action.kind === "dispatch") {
      console.info(`[actions] "${action.label}" (dispatch) — coming soon`);
    } else {
      // "link" — or a legacy action persisted before `kind` existed (treated as link).
      window.open(action.url, "_blank", "noopener,noreferrer");
    }
  }
  return { runAction };
}
