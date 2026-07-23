<script setup lang="ts">
import { computed } from "vue";
import type { FieldValue, FormField } from "../types";

const props = defineProps<{ field: FormField; error?: string }>();
const model = defineModel<FieldValue>();

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

const controlClass =
  "w-full rounded-md border bg-surface px-3 py-2 text-[16px] text-text " +
  "transition-colors duration-100 focus-visible:outline-2 focus-visible:outline-offset-2 " +
  "focus-visible:outline-accent";
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <label :for="fieldId" class="text-[13px] font-medium text-text">
      {{ field.label }}
      <span v-if="field.required" class="text-danger" aria-hidden="true">*</span>
    </label>
    <select
      :id="fieldId"
      v-model="value"
      :name="field.name"
      :aria-invalid="error ? 'true' : undefined"
      :aria-describedby="error ? errorId : undefined"
      :class="[controlClass, error ? 'border-danger' : 'border-line-strong']"
    >
      <option v-for="opt in field.options" :key="opt.value" :value="opt.value">
        {{ opt.label }}
      </option>
    </select>
    <p v-if="error" :id="errorId" role="alert" class="text-[12px] text-danger">{{ error }}</p>
  </div>
</template>
