<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { Search } from "@lucide/vue";
import Chip from "@/components/ui/Chip.vue";
import Icon from "@/components/ui/Icon.vue";
import { useFeedStore } from "@/stores/feed";
import FilterMenu from "./FilterMenu.vue";

const feed = useFeedStore();
const searchInput = ref<HTMLInputElement | null>(null);

// Only module filters get their own removable pill; priority/unread are represented by
// the quick chips below, so we don't show the same filter twice.
const modulePills = computed(() => feed.appliedPills.filter((p) => p.type === "module"));

// ⌘K / Ctrl-K focuses search (making the visible hint truthful). A full command palette
// is a later task; for now this is the real behavior the shortcut maps to.
function onKeydown(event: KeyboardEvent): void {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    searchInput.value?.focus();
  }
}
onMounted(() => window.addEventListener("keydown", onKeydown));
onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown));

const connection = computed(() => {
  switch (feed.connection) {
    case "open":
      return { label: "Live", dot: "bg-success", pulse: false };
    case "connecting":
      return { label: "Connecting…", dot: "bg-warning", pulse: true };
    default:
      return { label: "Offline", dot: "bg-faint", pulse: false };
  }
});
</script>

<template>
  <header class="relative z-20 border-b border-line bg-bg/95 backdrop-blur">
    <div class="flex items-center gap-4 px-6 pt-5">
      <div class="flex items-baseline gap-2.5">
        <h1 class="text-[22px] leading-none">Inbox</h1>
        <span
          v-if="feed.unreadCount > 0"
          class="rounded-full bg-accent/10 px-2 py-0.5 font-mono text-[11px] font-semibold tabular-nums text-accent"
          :aria-label="`${feed.unreadCount} unread`"
        >
          {{ feed.unreadCount }}
        </span>
      </div>

      <div class="ml-auto flex items-center gap-3">
        <div class="relative">
          <Icon
            :icon="Search"
            :size="15"
            class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint"
          />
          <input
            ref="searchInput"
            v-model="feed.query"
            type="search"
            placeholder="Search notifications"
            aria-label="Search notifications"
            class="h-8 w-56 rounded-md border border-line-strong bg-surface pl-8 pr-14 text-[13px] text-text placeholder:text-faint focus-visible:border-accent"
          />
          <kbd
            class="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-line bg-sunken px-1 py-0.5 font-mono text-[11px] text-faint"
            aria-hidden="true"
          >
            ⌘K
          </kbd>
        </div>

        <span class="flex items-center gap-1.5 text-[12px] text-muted" aria-live="polite">
          <span
            class="size-2 rounded-full"
            :class="[connection.dot, connection.pulse && 'animate-pulse']"
            aria-hidden="true"
          />
          {{ connection.label }}
        </span>
      </div>
    </div>

    <div class="flex items-center gap-2 px-6 py-3">
      <Chip :active="!feed.isFiltered" @click="feed.clearFilters()">All</Chip>
      <Chip :active="feed.unreadOnly" @click="feed.toggleUnreadOnly()">Unread</Chip>
      <Chip :active="feed.priorities.has('critical')" @click="feed.togglePriority('critical')">
        Critical
      </Chip>
      <Chip :active="feed.priorities.has('high')" @click="feed.togglePriority('high')">High</Chip>

      <button
        v-for="pill in modulePills"
        :key="pill.label"
        type="button"
        class="inline-flex items-center gap-1 rounded-full bg-accent/10 py-1 pl-3 pr-2 text-[12px] font-medium text-accent transition-colors duration-100 hover:bg-accent/15"
        @click="feed.removePill(pill)"
      >
        <span class="font-mono">{{ pill.label }}</span>
        <span class="text-[14px] leading-none" aria-hidden="true">×</span>
        <span class="sr-only">Remove {{ pill.label }} filter</span>
      </button>

      <div class="ml-auto">
        <FilterMenu />
      </div>
    </div>
  </header>
</template>
