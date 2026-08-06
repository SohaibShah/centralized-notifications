<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from "vue";
import Icon from "../ui/Icon.vue";
import { useFeed, useSettings } from "../provider/context";
import { useUi } from "../theming/useUi";
import FilterMenu from "./components/FilterMenu.vue";
import InboxTab from "./panel/InboxTab.vue";
import AssistantTab from "./panel/AssistantTab.vue";

defineEmits<{ close: [] }>();

const parts = {
  root: "flex max-h-[80vh] w-[380px] flex-col overflow-hidden rounded-lg border border-line-strong bg-surface shadow-xl shadow-black/10",
  toolbar: "flex items-center gap-1 border-b border-line px-3 py-2",
  tab: "rounded-md px-3 py-1.5 text-[12px] font-semibold transition-colors duration-100",
  iconButton:
    "grid size-8 place-items-center rounded-md transition-colors duration-100 hover:bg-sunken",
  searchField:
    "h-8 w-full rounded-md border border-line-strong bg-surface px-3 text-[13px] text-text placeholder:text-faint focus-visible:border-accent",
  body: "flex min-h-0 flex-1 flex-col",
} as const;
const props = defineProps<{ ui?: Partial<Record<keyof typeof parts, string>> }>();
const ui = useUi("panel", parts, () => props.ui);

const feed = useFeed();
const settings = useSettings();
const tab = ref<"inbox" | "assistant">("inbox");
// When the chatbot is disabled admin-side, the Ask AI tab is hidden entirely; force the Inbox view so
// a stale `tab === 'assistant'` can never render the assistant panel.
const showAssistant = computed(() => settings.flags.chatbotEnabled && tab.value === "assistant");
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

onMounted(() => {
  feed.flushSessionReads(); // reopening the panel settles this-session reads into "Earlier"
  feed.fetchCounts(); // reconcile counts with the server on open (catches cross-session drift)
  inboxTabButton.value?.focus();
});
</script>

<template>
  <div :class="ui('root')" role="dialog" aria-label="Notifications">
    <!-- One toolbar: tabs (always) + search & filter (Inbox only) + close (always) -->
    <div :class="ui('toolbar')" role="tablist" aria-label="Notification views">
      <button
        id="tab-inbox"
        ref="inboxTabButton"
        type="button"
        role="tab"
        :aria-selected="tab === 'inbox'"
        aria-controls="notif-tabpanel"
        :class="ui('tab', tab === 'inbox' ? 'bg-accent/10 text-accent' : 'text-muted hover:text-text')"
        @click="tab = 'inbox'"
      >
        Inbox
      </button>
      <button
        v-if="settings.flags.chatbotEnabled"
        id="tab-assistant"
        type="button"
        role="tab"
        :aria-selected="tab === 'assistant'"
        aria-controls="notif-tabpanel"
        :class="
          ui(
            'tab',
            'inline-flex items-center gap-1',
            tab === 'assistant' ? 'bg-accent/10 text-accent' : 'text-muted hover:text-text',
          )
        "
        @click="tab = 'assistant'"
      >
        <span data-test="ask-ai-label" class="text-ai">Ask AI</span>
        <Icon name="sparkles" :size="13" class="text-ai-2" />
      </button>

      <div class="ml-auto flex items-center gap-1">
        <button
          v-if="tab === 'inbox'"
          type="button"
          :class="
            ui('iconButton', searchOpen || feed.query ? 'text-accent' : 'text-faint hover:text-text')
          "
          aria-label="Search notifications"
          :aria-expanded="searchOpen"
          @click="toggleSearch"
        >
          <Icon name="search" :size="16" />
        </button>
        <FilterMenu v-if="tab === 'inbox'" />
        <button
          type="button"
          :class="ui('iconButton', 'text-faint hover:text-text')"
          aria-label="Close notifications"
          @click="$emit('close')"
        >
          <Icon name="x" :size="16" />
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
        :class="ui('searchField')"
      />
    </div>

    <div
      id="notif-tabpanel"
      :class="ui('body')"
      role="tabpanel"
      :aria-labelledby="showAssistant ? 'tab-assistant' : 'tab-inbox'"
    >
      <AssistantTab v-if="showAssistant" />
      <InboxTab v-else />
    </div>
  </div>
</template>
