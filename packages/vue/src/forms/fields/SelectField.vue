<script setup lang="ts">
import { computed } from "vue";
import type { FieldValue, FormField } from "../types";
import { useUi } from "../../theming/useUi";

const parts = {
  root: "flex flex-col gap-1.5",
  label: "text-[13px] font-medium text-text",
  select:
    "w-full rounded-md border bg-surface px-3 py-2 text-[16px] text-text transition-colors duration-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
  error: "text-[12px] text-danger",
} as const;
const props = defineProps<{
  field: FormField;
  error?: string;
  ui?: Partial<Record<keyof typeof parts, string>>;
}>();
const model = defineModel<FieldValue>();
const ui = useUi("select-field", parts, () => props.ui);

// A select always binds a string value from its options.
const value = computed<string>({
  get: () =>
    model.value === undefined || typeof model.value === "boolean" ? "" : String(model.value),
  set: (v) => {
    model.value = v;
  },
});

const fieldId = computed(() => `field-${props.field.name}`);
const errorId = computed(() => `${fieldId.value}-error`);
</script>

<template>
  <div :class="ui('root')">
    <label :for="fieldId" :class="ui('label')">
      {{ field.label }}
      <span v-if="field.required" class="text-danger" aria-hidden="true">*</span>
    </label>
    <select
      :id="fieldId"
      v-model="value"
      :name="field.name"
      :aria-invalid="error ? 'true' : undefined"
      :aria-describedby="error ? errorId : undefined"
      :class="ui('select', error ? 'border-danger' : 'border-line-strong')"
    >
      <option v-for="opt in field.options" :key="opt.value" :value="opt.value">
        {{ opt.label }}
      </option>
    </select>
    <p v-if="error" :id="errorId" role="alert" :class="ui('error')">{{ error }}</p>
  </div>
</template>
