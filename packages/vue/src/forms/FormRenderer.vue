<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import Button from "../ui/Button.vue";
import Spinner from "../ui/Spinner.vue";
import SelectField from "./fields/SelectField.vue";
import SwitchField from "./fields/SwitchField.vue";
import TextField from "./fields/TextField.vue";
import type { FormSchema, FormValues } from "./types";
import { buildSchema } from "./validation";
import { useUi } from "../theming/useUi";

const parts = {
  root: "flex flex-col gap-4",
  heading: "mt-6 font-mono text-[11px] font-semibold uppercase tracking-wide text-muted first:mt-0",
  error: "text-[13px] text-danger",
} as const;

// The one shared form component: walk a schema, render a field per entry, validate on
// submit from the schema-generated zod, and emit clean values. New field types get a
// new component + a branch here — never a parallel hand-rolled form.
const props = defineProps<{
  schema: FormSchema;
  /** In-flight state: the submit button stays enabled until submit starts, then spins. */
  submitting?: boolean;
  /** A server-side/form-level error (e.g. bad credentials), shown above the button. */
  error?: string | null;
  /** Seed values (e.g. current settings loaded from the server) before user edits. */
  initialValues?: FormValues;
  ui?: Partial<Record<keyof typeof parts, string>>;
}>();
const ui = useUi("form", parts, () => props.ui);
const emit = defineEmits<{ submit: [values: FormValues] }>();

const isBooleanField = (type: FormSchema["fields"][number]["type"]): boolean =>
  type === "checkbox" || type === "switch";

const formEl = ref<HTMLFormElement>();
const values = reactive<FormValues>(
  Object.fromEntries(
    props.schema.fields.map((f) => [
      f.name,
      props.initialValues?.[f.name] ?? f.default ?? (isBooleanField(f.type) ? false : ""),
    ]),
  ),
);
const errors = reactive<Record<string, string>>({});

// showIf: a field is shown only when its referenced field currently matches the condition.
// Fields using showIf must be optional — a hidden field's value stays in `values` and is
// still validated on submit.
function isVisible(field: FormSchema["fields"][number]): boolean {
  const cond = field.showIf;
  if (!cond) return true;
  const current = values[cond.field];
  if (cond.equals !== undefined) return current === cond.equals;
  if (cond.notEquals !== undefined) return current !== cond.notEquals;
  return true;
}
const visibleFields = computed(() => props.schema.fields.filter(isVisible));

// Flatten the visible fields into a render list, inserting a section heading whenever the `group`
// changes. A group's heading only appears if at least one of its fields is visible (an all-hidden
// group — e.g. AI settings while AI summary is off — contributes no orphan heading).
type RenderItem =
  | { kind: "heading"; label: string; key: string }
  | { kind: "field"; field: FormSchema["fields"][number]; key: string };
const renderItems = computed<RenderItem[]>(() => {
  const items: RenderItem[] = [];
  let lastGroup: string | undefined;
  for (const field of visibleFields.value) {
    if (field.group && field.group !== lastGroup) {
      items.push({ kind: "heading", label: field.group, key: `group-${field.group}` });
    }
    items.push({ kind: "field", field, key: field.name });
    lastGroup = field.group;
  }
  return items;
});

function handleSubmit() {
  for (const key of Object.keys(errors)) delete errors[key];
  const result = buildSchema(props.schema).safeParse(values);
  if (!result.success) {
    for (const issue of result.error.issues) {
      const key = String(issue.path[0]);
      if (key && !errors[key]) errors[key] = issue.message;
    }
    // Move focus to the first field with an error (web interface guidelines).
    const firstBad = props.schema.fields.find((f) => errors[f.name]);
    if (firstBad) {
      formEl.value?.querySelector<HTMLElement>(`[name="${firstBad.name}"]`)?.focus();
    }
    return;
  }
  emit("submit", result.data as FormValues);
}
</script>

<template>
  <form ref="formEl" novalidate :class="ui('root')" @submit.prevent="handleSubmit">
    <template v-for="item in renderItems" :key="item.key">
      <p v-if="item.kind === 'heading'" data-test="form-group-heading" :class="ui('heading')">
        {{ item.label }}
      </p>
      <template v-else>
        <SwitchField
          v-if="item.field.type === 'switch'"
          v-model="values[item.field.name]"
          :field="item.field"
          :error="errors[item.field.name]"
        />
        <SelectField
          v-else-if="item.field.type === 'select'"
          v-model="values[item.field.name]"
          :field="item.field"
          :error="errors[item.field.name]"
        />
        <TextField
          v-else
          v-model="values[item.field.name]"
          :field="item.field"
          :error="errors[item.field.name]"
        />
      </template>
    </template>

    <p v-if="error" role="alert" aria-live="polite" :class="ui('error')">{{ error }}</p>

    <!-- "end": the button wraps its label and right-aligns (settings/admin). "full" (default): a
         full-width button for prominent single-action forms like login. -->
    <div :class="schema.submitAlign === 'end' ? 'mt-2 flex justify-end' : 'contents'">
      <Button
        type="submit"
        :disabled="submitting"
        :class="schema.submitAlign === 'end' ? '' : 'mt-1 w-full'"
      >
        <Spinner v-if="submitting" :size="15" />
        {{ submitting ? (schema.submittingLabel ?? "Working…") : (schema.submitLabel ?? "Submit") }}
      </Button>
    </div>
  </form>
</template>
