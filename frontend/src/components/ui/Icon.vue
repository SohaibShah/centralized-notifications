<script setup lang="ts">
import type { Component } from "vue";

// Thin wrapper over a lucide (@lucide/vue) icon so stroke + decorative a11y are
// consistent. Icons are decorative by default (aria-hidden); the interactive element
// that contains them carries the accessible label.
withDefaults(defineProps<{ icon: Component; size?: number }>(), { size: 16 });
</script>

<template>
  <component :is="icon" :size="size" :stroke-width="1.75" aria-hidden="true" />
</template>
