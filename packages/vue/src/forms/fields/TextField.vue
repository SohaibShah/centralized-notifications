<script setup lang="ts">
import { computed } from "vue";
import type { FieldValue, FormField } from "../types";
import { useUi } from "../../theming/useUi";

const parts = {
  root: "flex flex-col gap-1.5",
  label: "text-[12.5px] font-semibold text-text",
  hint: "mt-0.5 text-[11px] leading-relaxed text-faint",
  input:
    "w-full rounded-md border bg-surface px-3 py-2 text-[16px] text-text placeholder:text-faint transition-colors duration-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
  error: "text-[12px] text-danger",
} as const;
const props = defineProps<{
  field: FormField;
  error?: string;
  ui?: Partial<Record<keyof typeof parts, string>>;
}>();
const model = defineModel<FieldValue>();
const ui = useUi("text-field", parts, () => props.ui);

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
</script>

<template>
  <div :class="ui('root')">
    <div>
      <label :for="fieldId" :class="ui('label')">
        {{ field.label }}
        <span v-if="field.required" class="text-danger" aria-hidden="true">*</span>
      </label>
      <p v-if="field.hint" :class="ui('hint')">
        {{ field.hint }}
      </p>
    </div>

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
      :class="ui('input', error ? 'border-danger' : 'border-line-strong')"
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
      :class="ui('input', error ? 'border-danger' : 'border-line-strong')"
    />
    <datalist v-if="field.options?.length" :id="`${fieldId}-list`">
      <option v-for="opt in field.options" :key="opt.value" :value="opt.value" />
    </datalist>

    <p v-if="error" :id="errorId" role="alert" :class="ui('error')">{{ error }}</p>
  </div>
</template>
