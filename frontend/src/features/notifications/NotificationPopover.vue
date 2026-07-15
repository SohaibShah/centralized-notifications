<script setup lang="ts">
import { nextTick, onMounted, ref } from "vue";
import { Search, Sparkles, X } from "@lucide/vue";
import Icon from "@/components/ui/Icon.vue";
import { useFeedStore } from "@/stores/feed";
import FilterMenu from "./components/FilterMenu.vue";
import InboxTab from "./panel/InboxTab.vue";
import AssistantTab from "./panel/AssistantTab.vue";

defineEmits<{ close: [] }>();

const feed = useFeedStore();
const tab = ref<"inbox" | "assistant">("inbox");
const inboxTabButton = ref<HTMLButtonElement | null>(null);
const searchOpen = ref(false);
const searchInput = ref<HTMLInputElement | null>(null);

async function toggleSearch() {
  searchOpen.value = !searchOpen.value;
  if (searchOpen.value) {
    await nextTick();
    searchInput.value?.focus();
  }
}

onMounted(() => inboxTabButton.value?.focus());
</script>

<template>
  <div
    class="flex max-h-[80vh] w-[380px] flex-col overflow-hidden rounded-lg border border-line-strong bg-surface shadow-xl shadow-black/10"
    role="dialog"
    aria-label="Notifications"
  >
    <!-- One toolbar: tabs (always) + search & filter (Inbox only) + close (always) -->
    <div
      class="flex items-center gap-1 border-b border-line px-3 py-2"
      role="tablist"
      aria-label="Notification views"
    >
      <button
        id="tab-inbox"
        ref="inboxTabButton"
        type="button"
        role="tab"
        :aria-selected="tab === 'inbox'"
        aria-controls="notif-tabpanel"
        class="rounded-md px-3 py-1.5 text-[12px] font-semibold transition-colors duration-100"
        :class="tab === 'inbox' ? 'bg-accent/10 text-accent' : 'text-muted hover:text-text'"
        @click="tab = 'inbox'"
      >
        Inbox
      </button>
      <button
        id="tab-assistant"
        type="button"
        role="tab"
        :aria-selected="tab === 'assistant'"
        aria-controls="notif-tabpanel"
        class="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-[12px] font-semibold transition-colors duration-100"
        :class="tab === 'assistant' ? 'bg-accent/10 text-accent' : 'text-muted hover:text-text'"
        @click="tab = 'assistant'"
      >
        Ask AI <Icon :icon="Sparkles" :size="13" />
      </button>

      <div class="ml-auto flex items-center gap-1">
        <button
          v-if="tab === 'inbox'"
          type="button"
          class="grid size-8 place-items-center rounded-md transition-colors duration-100 hover:bg-sunken"
          :class="searchOpen || feed.query ? 'text-accent' : 'text-faint hover:text-text'"
          aria-label="Search notifications"
          :aria-expanded="searchOpen"
          @click="toggleSearch"
        >
          <Icon :icon="Search" :size="16" />
        </button>
        <FilterMenu v-if="tab === 'inbox'" />
        <button
          type="button"
          class="grid size-8 place-items-center rounded-md text-faint transition-colors duration-100 hover:bg-sunken hover:text-text"
          aria-label="Close notifications"
          @click="$emit('close')"
        >
          <Icon :icon="X" :size="16" />
        </button>
      </div>
    </div>

    <!-- Search field appears only when toggled (Inbox only) -->
    <div v-if="tab === 'inbox' && searchOpen" class="border-b border-line px-3 py-2">
      <input
        ref="searchInput"
        v-model="feed.query"
        type="search"
        placeholder="Search notifications"
        aria-label="Search notifications"
        class="h-8 w-full rounded-md border border-line-strong bg-surface px-3 text-[13px] text-text placeholder:text-faint focus-visible:border-accent"
      />
    </div>

    <div
      id="notif-tabpanel"
      class="flex min-h-0 flex-1 flex-col"
      role="tabpanel"
      :aria-labelledby="tab === 'inbox' ? 'tab-inbox' : 'tab-assistant'"
    >
      <InboxTab v-if="tab === 'inbox'" />
      <AssistantTab v-else />
    </div>
  </div>
</template>
