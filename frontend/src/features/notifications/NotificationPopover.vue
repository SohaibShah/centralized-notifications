<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { X } from "@lucide/vue";
import Icon from "@/components/ui/Icon.vue";
import { useFeedStore } from "@/stores/feed";
import InboxTab from "./panel/InboxTab.vue";
import AssistantTab from "./panel/AssistantTab.vue";

defineEmits<{ close: [] }>();

const feed = useFeedStore();
const tab = ref<"inbox" | "assistant">("inbox");
const inboxTabButton = ref<HTMLButtonElement | null>(null);

// Reflect SSE connection health (reused from the retired TopBar).
const connection = computed(() => {
  switch (feed.connection) {
    case "open":
      return { label: "Live", dot: "bg-success" };
    case "connecting":
      return { label: "Connecting…", dot: "bg-warning" };
    default:
      return { label: "Offline", dot: "bg-faint" };
  }
});

// Move focus into the panel when it opens (the bell restores focus to itself on close).
onMounted(() => inboxTabButton.value?.focus());
</script>

<template>
  <div
    class="flex max-h-[70vh] w-[380px] flex-col overflow-hidden rounded-xl border border-line-strong bg-surface shadow-xl shadow-black/10"
    role="dialog"
    aria-label="Notifications"
  >
    <div class="flex items-center gap-2 border-b border-line px-4 py-3">
      <h2 class="font-display text-[15px] font-medium text-text">Notifications</h2>
      <span class="flex items-center gap-1.5 text-[11px] text-muted" aria-live="polite">
        <span class="size-2 rounded-full" :class="connection.dot" aria-hidden="true" />
        {{ connection.label }}
      </span>
      <button
        type="button"
        class="ml-auto grid size-7 place-items-center rounded-md text-faint transition-colors duration-100 hover:bg-sunken hover:text-text"
        aria-label="Close notifications"
        @click="$emit('close')"
      >
        <Icon :icon="X" :size="16" />
      </button>
    </div>

    <div
      class="flex gap-1 border-b border-line px-3 pt-2"
      role="tablist"
      aria-label="Notification views"
    >
      <button
        ref="inboxTabButton"
        type="button"
        role="tab"
        :aria-selected="tab === 'inbox'"
        class="rounded-t-md px-3 py-2 text-[12px] font-semibold transition-colors duration-100"
        :class="tab === 'inbox' ? 'bg-accent/10 text-accent' : 'text-muted hover:text-text'"
        @click="tab = 'inbox'"
      >
        Inbox
      </button>
      <button
        type="button"
        role="tab"
        :aria-selected="tab === 'assistant'"
        class="rounded-t-md px-3 py-2 text-[12px] font-semibold transition-colors duration-100"
        :class="tab === 'assistant' ? 'bg-accent/10 text-accent' : 'text-muted hover:text-text'"
        @click="tab = 'assistant'"
      >
        Ask AI ✦
      </button>
    </div>

    <div class="min-h-0 flex-1" role="tabpanel">
      <InboxTab v-if="tab === 'inbox'" />
      <AssistantTab v-else />
    </div>
  </div>
</template>
