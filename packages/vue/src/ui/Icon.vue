<script setup lang="ts">
import { computed, inject } from "vue";
import type { Component } from "vue";
import { defaultIcons, NOTIFICATION_ICONS_KEY } from "../theming/icons";

// `name` resolves against the injected registry (host-overridable). `icon` is the legacy direct-
// component prop, kept until every caller is migrated (Task 10). Icons are decorative by default
// (aria-hidden); the interactive element that contains them carries the accessible label.
const props = withDefaults(defineProps<{ name?: string; icon?: Component; size?: number }>(), {
  size: 16,
});
const registry = inject(NOTIFICATION_ICONS_KEY, undefined);

const resolved = computed<Component | false | undefined>(() => {
  if (props.icon) return props.icon; // legacy direct-component path
  if (!props.name) return undefined;
  const fromRegistry = registry?.value?.[props.name];
  // A host may set a name to `false` to hide it; only fall back to the default when the host
  // hasn't set that key at all (so `false` is respected, `undefined` isn't).
  if (fromRegistry !== undefined) return fromRegistry;
  return (defaultIcons as Record<string, Component>)[props.name];
});
</script>

<template>
  <component :is="resolved" v-if="resolved" :size="size" :stroke-width="1.75" aria-hidden="true" />
</template>
