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
    },
    {
      name: "chatbotEnabled",
      label: "AI chatbot",
      type: "switch",
      hint: "Enable the Ask AI assistant.",
    },
    {
      name: "groupingEnabled",
      label: "Grouping",
      type: "switch",
      hint: "Collapse related notifications into one grouped card (coming soon).",
    },
    {
      name: "actionsEnabled",
      label: "Actions",
      type: "switch",
      hint: "Allow module action buttons on notification cards (coming soon).",
    },
  ],
  submitLabel: "Save changes",
  submittingLabel: "Saving…",
};
