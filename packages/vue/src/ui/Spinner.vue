<script setup lang="ts">
import { useUi } from "../theming/useUi";

const parts = { root: "animate-spin" } as const;
const props = withDefaults(
  defineProps<{
    size?: number;
    label?: string;
    ui?: Partial<Record<keyof typeof parts, string>>;
  }>(),
  { size: 16 },
);
const ui = useUi("spinner", parts, () => props.ui);
</script>

<template>
  <svg
    :class="ui('root')"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    :role="label ? 'status' : undefined"
    :aria-label="label"
    :aria-hidden="label ? undefined : true"
  >
    <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2.5" stroke-opacity="0.2" />
    <path
      d="M21 12a9 9 0 0 0-9-9"
      stroke="currentColor"
      stroke-width="2.5"
      stroke-linecap="round"
    />
  </svg>
</template>
