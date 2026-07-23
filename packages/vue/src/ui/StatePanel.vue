<script setup lang="ts">
import type { Component } from "vue";
import Icon from "./Icon.vue";

// Shared empty/error state (loading uses skeletons instead). Copy is specific and in
// the interface's voice — never "No data" / "Something went wrong" (design-system).
defineProps<{ icon?: Component; title: string; description?: string }>();
</script>

<template>
  <div class="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
    <Icon v-if="icon" :icon="icon" :size="22" class="text-faint" />
    <p class="font-display text-[16px] text-text">{{ title }}</p>
    <p v-if="description" class="max-w-[44ch] text-[13px] leading-relaxed text-muted">
      {{ description }}
    </p>
    <div class="mt-2"><slot /></div>
  </div>
</template>
