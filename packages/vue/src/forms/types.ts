/**
 * Form schema types (see the `json-form-conventions` skill). Every form in the app is
 * described by one of these and rendered by <FormRenderer> — never hand-placed inputs.
 */

export type FieldType =
  "text" | "email" | "password" | "number" | "textarea" | "select" | "checkbox" | "switch" | "time";

export interface FormField {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  placeholder?: string;
  autocomplete?: string;
  maxLength?: number;
  /** Secondary explanatory line under the label (e.g. a switch's effect / availability). */
  hint?: string;
  default?: string | number | boolean;
  /** For select/radio-group (added as those field components land). */
  options?: { value: string; label: string }[];
  /** Show this field only when another field's current value matches (equals) / differs from (notEquals). */
  showIf?: {
    field: string;
    equals?: string | number | boolean;
    notEquals?: string | number | boolean;
  };
  /** Optional section label. Consecutive fields sharing a `group` render under one heading; the
   *  heading is skipped when every field in the group is hidden by `showIf`. Ungrouped fields render
   *  with no heading (the default for simple forms like login). */
  group?: string;
}

export interface FormSchema {
  id: string;
  title?: string;
  fields: FormField[];
  submitLabel?: string;
  /** Label shown on the submit button while the request is in flight (ends with …). */
  submittingLabel?: string;
  /** Submit button placement. "full" (default) = full-width (e.g. login). "end" = wraps its content
   *  and right-aligns (settings/admin forms, where a full-width button reads as heavy). */
  submitAlign?: "full" | "end";
}

export type FieldValue = string | number | boolean | undefined;
export type FormValues = Record<string, FieldValue>;
