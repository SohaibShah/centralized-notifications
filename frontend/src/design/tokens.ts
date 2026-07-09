import type { NotificationPriority } from "@notifications/shared";

/**
 * Typed mirror of the visual system. CSS classes (Tailwind utilities off the `@theme`
 * tokens in styles/main.css) are the primary styling surface — this file exists only for
 * the places TS needs a token-derived value or a semantic mapping. Never hardcode hex/px
 * in components; go through the tokens.
 */

/** Priority → the dot's classes (critical/high are solid; normal muted; low is a hollow ring). */
export const priorityDotClass: Record<NotificationPriority, string> = {
  critical: "bg-danger",
  high: "bg-warning",
  normal: "bg-faint",
  low: "ring-1 ring-inset ring-faint",
};

export const priorityLabel: Record<NotificationPriority, string> = {
  critical: "Critical",
  high: "High",
  normal: "Normal",
  low: "Low",
};

/** Order used when sorting/grouping the feed by urgency. */
export const priorityRank: Record<NotificationPriority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};
