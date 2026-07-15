<script setup lang="ts">
import { ref } from "vue";
import { Boxes, ScrollText, Sparkles, ToggleRight } from "@lucide/vue";
import Icon from "@/components/ui/Icon.vue";
import ModulesPanel from "./ModulesPanel.vue";
import FeaturesPanel from "./FeaturesPanel.vue";

type Section = "modules" | "features";
const section = ref<Section>("modules");
const items: { id: Section; label: string; icon: typeof Boxes }[] = [
  { id: "modules", label: "Modules", icon: Boxes },
  { id: "features", label: "Features", icon: ToggleRight },
];
</script>

<template>
  <div class="flex h-full min-h-0">
    <nav class="w-44 shrink-0 border-r border-line p-4" aria-label="Admin sections">
      <h1 class="mb-3 font-display text-[18px] font-medium text-text">Admin</h1>
      <button
        v-for="it in items"
        :key="it.id"
        type="button"
        class="mb-0.5 flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13px] font-medium transition-colors duration-100"
        :class="
          section === it.id
            ? 'bg-accent/10 text-accent'
            : 'text-muted hover:bg-sunken hover:text-text'
        "
        :aria-current="section === it.id ? 'page' : undefined"
        @click="section = it.id"
      >
        <Icon :icon="it.icon" :size="15" /> {{ it.label }}
      </button>
      <div class="mt-2 border-t border-line pt-2">
        <div
          class="flex items-center gap-2 px-2.5 py-2 text-[13px] text-faint"
          title="Coming in a later week"
        >
          <Icon :icon="Sparkles" :size="15" /> AI config
        </div>
        <div
          class="flex items-center gap-2 px-2.5 py-2 text-[13px] text-faint"
          title="Coming in a later week"
        >
          <Icon :icon="ScrollText" :size="15" /> Audit
        </div>
      </div>
    </nav>
    <div class="min-w-0 flex-1 overflow-y-auto p-6">
      <ModulesPanel v-if="section === 'modules'" />
      <FeaturesPanel v-else />
    </div>
  </div>
</template>
