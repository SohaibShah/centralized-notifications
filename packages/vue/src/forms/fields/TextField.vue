<script setup lang="ts">
import { computed } from "vue";
import type { FieldValue, FormField } from "../types";

const props = defineProps<{ field: FormField; error?: string }>();
const model = defineModel<FieldValue>();

// TextField only renders text-like inputs, but the shared model allows boolean (for
// checkboxes elsewhere). Narrow to a string/number the <input> can bind to.
const value = computed<string | number | undefined>({
  get: () => (typeof model.value === "boolean" ? undefined : model.value),
  set: (v) => {
    model.value = v;
  },
});

const fieldId = computed(() => `field-${props.field.name}`);
const errorId = computed(() => `${fieldId.value}-error`);
const isTextarea = computed(() => props.field.type === "textarea");
// Disable spellcheck on identity/secret fields (web interface guidelines).
const spellcheck = computed(() =>
  props.field.type === "password" || props.field.type === "email" ? false : undefined,
);
const inputType = computed(() => (props.field.type === "textarea" ? "text" : props.field.type));

const controlClass =
  "w-full rounded-md border bg-surface px-3 py-2 text-[16px] text-text placeholder:text-faint " +
  "transition-colors duration-100 focus-visible:outline-2 focus-visible:outline-offset-2 " +
  "focus-visible:outline-accent";
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <label :for="fieldId" class="text-[13px] font-medium text-text">
      {{ field.label }}
      <span v-if="field.required" class="text-danger" aria-hidden="true">*</span>
    </label>

    <textarea
      v-if="isTextarea"
      :id="fieldId"
      v-model="value"
      :name="field.name"
      :placeholder="field.placeholder"
      :maxlength="field.maxLength"
      :aria-invalid="error ? 'true' : undefined"
      :aria-describedby="error ? errorId : undefined"
      rows="3"
      :class="[controlClass, error ? 'border-danger' : 'border-line-strong']"
    />
    <input
      v-else
      :id="fieldId"
      v-model="value"
      :name="field.name"
      :type="inputType"
      :placeholder="field.placeholder"
      :autocomplete="field.autocomplete"
      :maxlength="field.maxLength"
      :spellcheck="spellcheck"
      :list="field.options?.length ? `${fieldId}-list` : undefined"
      :aria-invalid="error ? 'true' : undefined"
      :aria-describedby="error ? errorId : undefined"
      :class="[controlClass, error ? 'border-danger' : 'border-line-strong']"
    />
    <datalist v-if="field.options?.length" :id="`${fieldId}-list`">
      <option v-for="opt in field.options" :key="opt.value" :value="opt.value" />
    </datalist>

    <p v-if="error" :id="errorId" role="alert" class="text-[12px] text-danger">{{ error }}</p>
  </div>
</template>
