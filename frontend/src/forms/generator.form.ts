import { AUDIENCE_SCOPES, NOTIFICATION_PRIORITIES } from "@notifications/shared";
import type { AudienceScope, NotificationPriority } from "@notifications/shared";
import type { CustomSpec } from "@/features/admin/adminApi";
import type { FormSchema, FormValues } from "./types";

/** The custom-notification form. `modules` become datalist suggestions on the free-text module field. */
export function generatorForm(modules: string[]): FormSchema {
  return {
    id: "generator",
    fields: [
      {
        name: "module",
        label: "Module",
        type: "text",
        required: true,
        maxLength: 100,
        placeholder: "e.g. dsr",
        options: modules.map((m) => ({ value: m, label: m })),
      },
      { name: "title", label: "Title", type: "text", required: true, maxLength: 500 },
      { name: "description", label: "Description", type: "textarea", maxLength: 5000 },
      {
        name: "priority",
        label: "Priority",
        type: "select",
        required: true,
        default: "normal",
        options: NOTIFICATION_PRIORITIES.map((p) => ({ value: p, label: p })),
      },
      {
        name: "category",
        label: "Category",
        type: "text",
        maxLength: 100,
        placeholder: "optional",
      },
      { name: "snoozable", label: "Snoozable", type: "switch" },
      {
        name: "audienceScope",
        label: "Audience scope",
        type: "select",
        required: true,
        default: "global",
        options: AUDIENCE_SCOPES.map((s) => ({ value: s, label: s })),
      },
      {
        name: "audienceId",
        label: "Audience ID",
        type: "text",
        maxLength: 200,
        placeholder: "team / role / user id",
        showIf: { field: "audienceScope", notEquals: "global" },
      },
      { name: "sampleActions", label: "Sample actions (0–3)", type: "number", default: 0 },
    ],
    submitLabel: "Publish notification",
    submittingLabel: "Publishing…",
  };
}

/** Map the flat form values into the nested POST /admin/simulate custom spec. */
export function toCustomSpec(values: FormValues): CustomSpec {
  const scope = String(values.audienceScope) as AudienceScope;
  const audience =
    scope === "global"
      ? { scope: "global" as const }
      : { scope, id: String(values.audienceId ?? "") };
  // Clamp to the server's accepted 0–3 range so a stray value fails the form here with a
  // clear message rather than round-tripping to a generic 400.
  const n = Math.max(0, Math.min(3, Math.floor(Number(values.sampleActions ?? 0)) || 0));
  return {
    mode: "custom",
    notification: {
      module: String(values.module),
      title: String(values.title),
      description: String(values.description ?? ""),
      priority: String(values.priority) as NotificationPriority,
      snoozable: values.snoozable === true,
      audience,
      ...(values.category ? { category: String(values.category) } : {}),
    },
    ...(n > 0 ? { sampleActions: n } : {}),
  };
}
