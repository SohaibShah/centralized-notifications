<script setup lang="ts">
import { reactive, ref } from "vue";
import Button from "@/components/ui/Button.vue";
import Spinner from "@/components/ui/Spinner.vue";
import TextField from "./fields/TextField.vue";
import type { FormSchema, FormValues } from "./types";
import { buildSchema } from "./validation";

// The one shared form component: walk a schema, render a field per entry, validate on
// submit from the schema-generated zod, and emit clean values. New field types get a
// new component + a branch here — never a parallel hand-rolled form.
const props = defineProps<{
  schema: FormSchema;
  /** In-flight state: the submit button stays enabled until submit starts, then spins. */
  submitting?: boolean;
  /** A server-side/form-level error (e.g. bad credentials), shown above the button. */
  error?: string | null;
}>();
const emit = defineEmits<{ submit: [values: FormValues] }>();

const formEl = ref<HTMLFormElement>();
const values = reactive<FormValues>(
  Object.fromEntries(
    props.schema.fields.map((f) => [f.name, f.default ?? (f.type === "checkbox" ? false : "")]),
  ),
);
const errors = reactive<Record<string, string>>({});

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
  <form ref="formEl" novalidate class="flex flex-col gap-4" @submit.prevent="handleSubmit">
    <TextField
      v-for="field in schema.fields"
      :key="field.name"
      v-model="values[field.name]"
      :field="field"
      :error="errors[field.name]"
    />

    <p v-if="error" role="alert" aria-live="polite" class="text-[13px] text-danger">{{ error }}</p>

    <Button type="submit" :disabled="submitting" class="mt-1 w-full">
      <Spinner v-if="submitting" :size="15" />
      {{ submitting ? (schema.submittingLabel ?? "Working…") : (schema.submitLabel ?? "Submit") }}
    </Button>
  </form>
</template>
