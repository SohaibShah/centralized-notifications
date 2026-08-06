<script setup lang="ts">
import { ref } from "vue";
import Icon from "../ui/Icon.vue";
import { useUi } from "../theming/useUi";
import ModulesPanel from "./ModulesPanel.vue";
import FeaturesPanel from "./FeaturesPanel.vue";
import DevLabsPanel from "./DevLabsPanel.vue";

// The full notification admin console: a section nav + the module / feature / dev-labs panels. A host
// mounts <NotificationAdmin> inside its own page chrome (see the reference app's AdminView).
const parts = {
  root: "flex h-full min-h-0",
  nav: "w-44 shrink-0 border-r border-line p-4",
  title: "mb-3 font-display text-[18px] font-medium text-text",
  navItem:
    "mb-0.5 flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13px] font-medium transition-colors duration-100",
  content: "min-w-0 flex-1 overflow-y-auto p-6",
} as const;
const props = defineProps<{ ui?: Partial<Record<keyof typeof parts, string>> }>();
const ui = useUi("admin", parts, () => props.ui);

type Section = "modules" | "features" | "dev-labs";
const section = ref<Section>("modules");
const items: { id: Section; label: string; icon: string }[] = [
  { id: "modules", label: "Modules", icon: "boxes" },
  { id: "features", label: "Features", icon: "toggle-right" },
  // Dev/QA only: the generator + maintenance routes are absent in production.
  ...(import.meta.env.DEV
    ? [{ id: "dev-labs" as const, label: "Dev Labs", icon: "flask-conical" }]
    : []),
];
</script>

<template>
  <div :class="ui('root')">
    <nav :class="ui('nav')" aria-label="Admin sections">
      <h1 :class="ui('title')">Admin</h1>
      <button
        v-for="it in items"
        :key="it.id"
        type="button"
        :class="
          ui(
            'navItem',
            section === it.id
              ? 'bg-accent/10 text-accent'
              : 'text-muted hover:bg-sunken hover:text-text',
          )
        "
        :aria-current="section === it.id ? 'page' : undefined"
        @click="section = it.id"
      >
        <Icon :name="it.icon" :size="15" /> {{ it.label }}
      </button>
      <div class="mt-2 border-t border-line pt-2">
        <div
          class="flex items-center gap-2 px-2.5 py-2 text-[13px] text-faint"
          title="Coming in a later week"
        >
          <Icon name="sparkles" :size="15" /> AI config
        </div>
        <div
          class="flex items-center gap-2 px-2.5 py-2 text-[13px] text-faint"
          title="Coming in a later week"
        >
          <Icon name="scroll-text" :size="15" /> Audit
        </div>
      </div>
    </nav>
    <div :class="ui('content')">
      <!-- Constrain content to the same width as the per-user settings page for a consistent feel. -->
      <div class="mx-auto max-w-3xl">
        <ModulesPanel v-if="section === 'modules'" />
        <DevLabsPanel v-else-if="section === 'dev-labs'" />
        <FeaturesPanel v-else />
      </div>
    </div>
  </div>
</template>
