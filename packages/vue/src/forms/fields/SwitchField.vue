<script setup lang="ts">
import { computed } from "vue";
import type { FieldValue, FormField } from "../types";

// `field` (and the shared `error` prop) are used directly in the template.
defineProps<{ field: FormField; error?: string }>();
const model = defineModel<FieldValue>();

// The shared model allows string/number/boolean; a switch is always a boolean.
const on = computed(() => model.value === true);
</script>

<template>
  <div class="flex items-start gap-3 border-b border-line py-3">
    <div class="min-w-0 flex-1">
      <div class="text-[12.5px] font-semibold text-text">{{ field.label }}</div>
      <div v-if="field.hint" class="mt-0.5 text-[11px] leading-relaxed text-faint">
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
      class="relative mt-0.5 inline-block h-[18px] w-[32px] shrink-0 rounded-full transition-colors duration-100"
      :class="on ? 'bg-accent' : 'bg-line-strong'"
      @click="model = !on"
    >
      <span
        class="absolute top-0.5 size-[14px] rounded-full bg-surface transition-all duration-100"
        :class="on ? 'right-0.5' : 'left-0.5'"
      />
    </button>
  </div>
</template>
