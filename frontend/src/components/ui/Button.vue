<script setup lang="ts">
import { computed } from "vue";
import { cva } from "class-variance-authority";

// Affordance comes from color/weight/spacing (not shadows), per the design system.
// A caller's `class` and listeners fall through to the <button> automatically.
const button = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-semibold transition-[background-color,color,border-color,opacity] duration-100 ease-out disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary: "bg-accent text-accent-ink hover:opacity-90",
        secondary: "border border-line-strong bg-surface text-text hover:bg-sunken",
        ghost: "bg-transparent text-muted hover:bg-sunken hover:text-text",
        danger: "bg-danger text-danger-ink hover:opacity-90",
      },
      size: {
        sm: "h-8 px-3 text-[12px]",
        md: "h-9 px-4 text-[13px]",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

// Props are declared as literal unions (not CVA's VariantProps) because the Vue SFC
// macro compiler can't resolve CVA's conditional types inside defineProps.
const props = defineProps<{
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  type?: "button" | "submit";
  disabled?: boolean;
}>();

const classes = computed(() => button({ variant: props.variant, size: props.size }));
</script>

<template>
  <button :type="type ?? 'button'" :disabled="disabled" :class="classes">
    <slot />
  </button>
</template>
