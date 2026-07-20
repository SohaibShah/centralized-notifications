import type { Notification, NotificationAction } from "@notifications/shared";

/**
 * Named one-click templates for the dev/QA generator (backend/src/http/admin/simulate.ts).
 * Each `build()` returns a contract-valid notification body WITHOUT an id — the route
 * assigns a server-controlled id so repeated generation never dedupes against itself.
 * Deterministic (no RNG): a preset always produces the same body, which keeps the panel
 * predictable and the tests stable.
 */

export const PRESET_IDS = [
  "critical-dsr",
  "high-access",
  "normal-finding",
  "low-assessment",
  "long-body",
] as const;

export type PresetId = (typeof PRESET_IDS)[number];

/** Canned actions the generator can attach (custom mode's `sampleActions`, and presets). */
export const SAMPLE_ACTIONS: NotificationAction[] = [
  {
    label: "Review",
    kind: "link",
    method: "GET",
    url: "https://app.example.com/review",
    icon: "external-link",
  },
  {
    label: "Approve",
    kind: "dispatch",
    method: "POST",
    url: "https://app.example.com/approve",
    icon: "check",
  },
  {
    label: "Dismiss",
    kind: "dispatch",
    method: "POST",
    url: "https://app.example.com/dismiss",
    icon: "x",
  },
];

/** First `n` canned actions (n clamped to the available list). */
export function sampleActions(n: number): NotificationAction[] {
  return SAMPLE_ACTIONS.slice(0, Math.max(0, n));
}

const LONG_BODY = Array.from(
  { length: 12 },
  () =>
    "This is a deliberately long notification body used to exercise multi-line rendering, truncation, and the expand affordance in the feed and toast.",
).join(" ");

export const PRESETS: Record<
  PresetId,
  { label: string; blurb: string; build: () => Omit<Notification, "id"> }
> = {
  "critical-dsr": {
    label: "Critical DSR",
    blurb: "A data-subject request about to breach SLA.",
    build: () => ({
      module: "dsr",
      title: "DSR approaching SLA breach",
      description: "A data-subject request is within 24 hours of its statutory deadline.",
      priority: "critical",
      snoozable: false,
      category: "sla",
      audience: { scope: "global" },
      actions: [
        {
          label: "Open DSR",
          kind: "link",
          method: "GET",
          url: "https://app.example.com/dsr/1",
          icon: "folder-open",
        },
      ],
    }),
  },
  "high-access": {
    label: "High · access request",
    blurb: "Access approval with Approve/Deny/Review actions.",
    build: () => ({
      module: "access-governance",
      title: "Access request awaiting your approval",
      description: "A user requested elevated access to a data catalog.",
      priority: "high",
      snoozable: false,
      category: "approvals",
      audience: { scope: "global" },
      actions: sampleActions(3),
    }),
  },
  "normal-finding": {
    label: "Normal · data finding",
    blurb: "A routine scan classification result.",
    build: () => ({
      module: "data-mapping",
      title: "Sensitive data found in new data stores",
      description: "The latest scan classified sensitive data in 3 stores.",
      priority: "normal",
      snoozable: true,
      audience: { scope: "global" },
    }),
  },
  "low-assessment": {
    label: "Low · assessment reminder",
    blurb: "A low-priority reminder with a single link.",
    build: () => ({
      module: "assessments",
      title: "Assessments due this week",
      description: "4 assessments assigned to you are still in draft.",
      priority: "low",
      snoozable: true,
      category: "reminders",
      audience: { scope: "global" },
      actions: [
        {
          label: "View assessments",
          kind: "link",
          method: "GET",
          url: "https://app.example.com/assessments",
          icon: "clipboard-list",
        },
      ],
    }),
  },
  "long-body": {
    label: "Long body",
    blurb: "A very long description to test truncation/expand.",
    build: () => ({
      module: "data-mapping",
      title: "Detailed scan report with an unusually long summary",
      description: LONG_BODY,
      priority: "normal",
      snoozable: true,
      audience: { scope: "global" },
    }),
  },
};

export function buildPreset(id: PresetId): Omit<Notification, "id"> {
  return PRESETS[id].build();
}
