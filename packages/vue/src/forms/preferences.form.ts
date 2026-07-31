import type { FormSchema } from "./types";

/** The per-user "Notifications" preference form (scalar toggles), rendered by the shared FormRenderer
 *  on the settings page. Timezone is a separate host-owned section (it saves to a different endpoint)
 *  and snooze/mute is a dedicated editor, so neither appears here. */
export const preferencesForm: FormSchema = {
  id: "preferences",
  fields: [
    {
      name: "toastMinPriority",
      label: "Critical toast",
      type: "select",
      hint: "Which priorities pop the bottom-right toast.",
      group: "Notifications",
      options: [
        { value: "off", label: "Off" },
        { value: "critical", label: "Critical only" },
        { value: "high", label: "Critical + High" },
      ],
    },
    {
      name: "summaryOptOut",
      label: "Turn off my AI summary",
      type: "switch",
      hint: "Stop generating and showing your daily AI digest.",
      group: "Notifications",
    },
    {
      name: "groupingEnabled",
      label: "Group related notifications",
      type: "switch",
      hint: "Collapse related notifications into one card (coming soon).",
      group: "Notifications",
    },
  ],
  submitLabel: "Save preferences",
  submittingLabel: "Saving…",
};
