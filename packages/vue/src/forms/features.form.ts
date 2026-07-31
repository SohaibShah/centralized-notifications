import type { FormSchema } from "./types";

/** Global feature kill-switches shown in the admin Features panel. */
export const featuresForm: FormSchema = {
  id: "features",
  fields: [
    {
      name: "aiSummaryEnabled",
      label: "AI summary",
      type: "switch",
      hint: "Show the AI digest band in the notification panel.",
      group: "AI",
    },
    {
      name: "summaryTime",
      label: "Daily summary time",
      type: "time",
      hint: "When each user's AI summary is generated, in their own timezone.",
      group: "AI",
      // Only relevant while AI summaries are on; hidden (but its value is preserved) when off.
      showIf: { field: "aiSummaryEnabled", equals: true },
    },
    {
      name: "chatbotEnabled",
      label: "AI chatbot",
      type: "switch",
      hint: "Enable the Ask AI assistant.",
      group: "AI",
    },
    {
      name: "actionsEnabled",
      label: "Actions",
      type: "switch",
      hint: "Allow module action buttons on notification cards.",
      group: "Notifications",
    },
    {
      name: "groupingEnabled",
      label: "Grouping",
      type: "switch",
      hint: "Collapse related notifications into one grouped card (coming soon).",
      group: "Notifications",
    },
  ],
  submitLabel: "Save changes",
  submittingLabel: "Saving…",
  submitAlign: "end",
};
