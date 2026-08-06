<script setup lang="ts">
import { computed } from "vue";
import type { FieldValue, FormField } from "../types";
import { useUi } from "../../theming/useUi";

const parts = {
  root: "flex items-start gap-3 border-b border-line py-3",
  label: "text-[12.5px] font-semibold text-text",
  hint: "mt-0.5 text-[11px] leading-relaxed text-faint",
  track:
    "relative mt-0.5 inline-block h-[18px] w-[32px] shrink-0 rounded-full transition-colors duration-100",
  thumb: "absolute top-0.5 size-[14px] rounded-full bg-surface transition-all duration-100",
} as const;
const props = defineProps<{
  field: FormField;
  error?: string;
  ui?: Partial<Record<keyof typeof parts, string>>;
}>();
const model = defineModel<FieldValue>();
const ui = useUi("switch-field", parts, () => props.ui);

// The shared model allows string/number/boolean; a switch is always a boolean.
const on = computed(() => model.value === true);
</script>

<template>
  <div :class="ui('root')">
    <div class="min-w-0 flex-1">
      <div :class="ui('label')">{{ field.label }}</div>
      <div v-if="field.hint" :class="ui('hint')">
        {{ field.hint }}
      </div>
    </div>
    <button
      type="button"
      role="switch"
      :name="field.name"
      :aria-checked="on"
      :aria-label="field.label"
      :data-test="`switch-${field.name}`"
      :class="[ui('track'), on ? 'bg-accent' : 'bg-line-strong']"
      @click="model = !on"
    >
      <span :class="[ui('thumb'), on ? 'right-0.5' : 'left-0.5']" />
    </button>
  </div>
</template>
