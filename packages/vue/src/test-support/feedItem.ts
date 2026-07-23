import type { FeedNotification } from "@notifications/shared";

/** Build a complete FeedNotification for tests; override any field via `over`. */
export function feedItem(over: Partial<FeedNotification> & { id: string }): FeedNotification {
  return {
    module: "mod",
    title: "Title",
    description: "",
    priority: "normal",
    snoozable: true,
    audience: { scope: "global" },
    createdAt: "2026-07-01T00:00:00.000000Z",
    read: false,
    ...over,
  };
}
