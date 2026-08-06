<script setup lang="ts">
import MaintenancePanel from "./MaintenancePanel.vue";
import { useUi } from "../theming/useUi";

/**
 * The dev/QA generator tab was removed (superseded by the module-sim control center) — this
 * panel is now a single-purpose wrapper around Maintenance. Kept as its own component (rather
 * than inlining MaintenancePanel at the call site) so a future dev/QA tool has a home without
 * touching NotificationAdmin.vue's section routing.
 */
const parts = { root: "" } as const;
const props = defineProps<{ ui?: Partial<Record<keyof typeof parts, string>> }>();
const ui = useUi("admin-devlabs", parts, () => props.ui);
</script>

<template>
  <div :class="ui('root')">
    <MaintenancePanel />
  </div>
</template>
