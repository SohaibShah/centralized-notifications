---
name: json-form-conventions
description: How forms are built in this project — every form is JSON-driven, rendered by a shared FormRenderer. Use whenever creating, editing, or discussing any form, input group, or wizard step.
---

# JSON-driven forms

This project never hand-rolls a one-off form component. Every form — from a two-field
login to a multi-step wizard — is described as data and rendered by one shared component.
This gives us consistent validation, consistent styling, and the ability to change a
form without touching component code.

## The pattern

1. **Schema**: a JSON (or `.ts` object satisfying the schema type) describing fields,
   layout, and validation. Lives in `frontend/src/forms/*.form.ts`.
2. **Validation**: each field's validation maps to a zod schema, generated from the same
   form config so the two never drift. Shared with the backend via `packages/shared`
   when the same shape is validated server-side too.
3. **Rendering**: `<FormRenderer :schema="mySchema" v-model="formData" @submit="..." />`
   walks the schema and renders the right field component for each field `type`.

## Schema shape

```ts
// frontend/src/forms/invite-user.form.ts
import type { FormSchema } from '@/forms/types'

export const inviteUserForm: FormSchema = {
  id: 'invite-user',
  title: 'Invite a teammate',
  fields: [
    {
      name: 'email',
      type: 'email',
      label: 'Email address',
      required: true,
      validation: { format: 'email' },
    },
    {
      name: 'role',
      type: 'select',
      label: 'Role',
      required: true,
      options: [
        { value: 'admin', label: 'Admin' },
        { value: 'member', label: 'Member' },
      ],
      default: 'member',
    },
    {
      name: 'message',
      type: 'textarea',
      label: 'Personal note (optional)',
      required: false,
      maxLength: 500,
    },
  ],
  submitLabel: 'Send invite',
}
```

## Field types supported by `<FormRenderer>`

`text`, `email`, `password`, `number`, `select`, `multiselect`, `checkbox`, `radio-group`,
`textarea`, `date`, `file`. If a form needs a field type that doesn't exist yet, add it to
the renderer as a new case — don't build a parallel form just to sidestep the renderer.

## When a form has conditional fields or multiple steps

- Conditional visibility: add a `showIf: { field: 'otherFieldName', equals: 'value' }` to
  the field definition. The renderer evaluates this against current form state.
- Multi-step: the schema's `fields` becomes `steps: [{ title, fields: [...] }, ...]`.
  `<FormRenderer>` detects the `steps` key and renders a stepper automatically.

## What NOT to do

- Don't write a `<template>` with hand-placed `<input>` elements for a new feature form.
  If you're tempted, it usually means a field type is missing from the renderer — add it
  there instead.
- Don't duplicate validation logic in the component; validation lives in the schema.
- Don't inline a schema as a literal object inside a `.vue` file for anything beyond a
  trivial one-off (e.g. a search box) — schemas live in `forms/*.form.ts` so they're
  reusable and testable on their own.

## Styling

Field components pull spacing, color, and type from the design tokens in the
`design-system` skill — never one-off pixel values inside a field component.
