import type { FormSchema } from "./types";

/** Global feature kill-switches shown in the admin Features panel. */
export const featuresForm: FormSchema = {
  id: "features",
  fields: [
    {
      name: "aiSummaryEnabled",
      label: "AI summary",
      type: "switch",
      hint: "Show the AI digest band in the notification panel. Live now — off hides it for everyone.",
    },
    {
      name: "chatbotEnabled",
      label: "AI chatbot",
      type: "switch",
      hint: "The Ask-AI assistant tab. Persists now; takes effect when the assistant ships (Week 3).",
    },
    {
      name: "groupingEnabled",
      label: "Grouping",
      type: "switch",
      hint: "Collapse related notifications into one grouped card (Week 4).",
    },
    {
      name: "actionsEnabled",
      label: "Actions",
      type: "switch",
      hint: "Allow module action buttons on notification cards (Week 4).",
    },
  ],
  submitLabel: "Save changes",
  submittingLabel: "Saving…",
};
