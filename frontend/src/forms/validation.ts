import { z, type ZodTypeAny } from "zod";
import type { FormField, FormSchema } from "./types";

// Validation is generated from the same schema that renders the form, so the two can't
// drift (json-form-conventions). Returns a zod object keyed by field name.
function fieldSchema(field: FormField): ZodTypeAny {
  // A switch is a plain boolean toggle (never "required true" the way an opt-in checkbox is).
  if (field.type === "switch") {
    return z.boolean().optional();
  }
  if (field.type === "checkbox") {
    return field.required
      ? z.boolean().refine((v) => v === true, { message: `${field.label} is required` })
      : z.boolean().optional();
  }
  if (field.type === "number") {
    // Treat blank/empty as "no value" BEFORE coercion — otherwise z.coerce.number() turns
    // "" into 0, so a cleared required number would pass as 0 and only fail at the server.
    const blankToUndefined = (v: unknown) => (v === "" || v === null ? undefined : v);
    if (field.required) {
      return z.preprocess(
        blankToUndefined,
        z.coerce.number({ invalid_type_error: `${field.label} is required` }),
      );
    }
    return z.preprocess(blankToUndefined, z.coerce.number().optional());
  }

  if (field.type === "select" && field.options?.length) {
    const optionValues = field.options.map((o) => o.value) as [string, ...string[]];
    const base = z.enum(optionValues);
    return field.required ? base : base.optional();
  }

  let base = z.string();
  if (field.type === "email") base = base.email({ message: "Enter a valid email address" });
  if (field.maxLength) base = base.max(field.maxLength);
  return field.required ? base.min(1, { message: `${field.label} is required` }) : base.optional();
}

export function buildSchema(schema: FormSchema) {
  const shape: Record<string, ZodTypeAny> = {};
  for (const field of schema.fields) shape[field.name] = fieldSchema(field);
  return z.object(shape);
}
