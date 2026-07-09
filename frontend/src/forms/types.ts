/**
 * Form schema types (see the `json-form-conventions` skill). Every form in the app is
 * described by one of these and rendered by <FormRenderer> — never hand-placed inputs.
 */

export type FieldType =
  | "text"
  | "email"
  | "password"
  | "number"
  | "textarea"
  | "select"
  | "checkbox";

export interface FormField {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  placeholder?: string;
  autocomplete?: string;
  maxLength?: number;
  default?: string | number | boolean;
  /** For select/radio-group (added as those field components land). */
  options?: { value: string; label: string }[];
  /** Show this field only when another field currently equals a value. */
  showIf?: { field: string; equals: string | number | boolean };
}

export interface FormSchema {
  id: string;
  title?: string;
  fields: FormField[];
  submitLabel?: string;
  /** Label shown on the submit button while the request is in flight (ends with …). */
  submittingLabel?: string;
}

export type FieldValue = string | number | boolean | undefined;
export type FormValues = Record<string, FieldValue>;
