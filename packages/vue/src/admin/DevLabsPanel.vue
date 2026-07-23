<script setup lang="ts">
import { ref } from "vue";
import GeneratorPanel from "./GeneratorPanel.vue";
import MaintenancePanel from "./MaintenancePanel.vue";

type Tab = "generate" | "maintenance";
const tab = ref<Tab>("generate");
const tabs: { id: Tab; label: string }[] = [
  { id: "generate", label: "Generate" },
  { id: "maintenance", label: "Maintenance" },
];
</script>

<template>
  <div>
    <div class="mb-4 flex gap-1.5">
      <button
        v-for="t in tabs"
        :key="t.id"
        type="button"
        :data-test="`devlabs-${t.id}`"
        :aria-current="tab === t.id ? 'true' : undefined"
        class="rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors duration-100"
        :class="
          tab === t.id ? 'bg-accent/10 text-accent' : 'text-muted hover:bg-sunken hover:text-text'
        "
        @click="tab = t.id"
      >
        {{ t.label }}
      </button>
    </div>
    <GeneratorPanel v-if="tab === 'generate'" />
    <MaintenancePanel v-else />
  </div>
</template>
