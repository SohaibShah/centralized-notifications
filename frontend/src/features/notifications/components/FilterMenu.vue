<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { SlidersHorizontal } from "@lucide/vue";
import { NOTIFICATION_PRIORITIES, type NotificationPriority } from "@notifications/shared";
import Icon from "@/components/ui/Icon.vue";
import { priorityDotClass, priorityLabel, priorityRank } from "@/design/tokens";
import { useFeedStore } from "@/stores/feed";

// The searchable filter dropdown (design-system: "quick chip presets + a searchable
// FilterMenu"). Facets are priority and the modules present in the loaded feed; the
// search box narrows the option list. State lives in the feed store, so applied
// filters also surface as removable pills in the filter bar.
const feed = useFeedStore();

const open = ref(false);
const search = ref("");
const root = ref<HTMLElement | null>(null);
const searchInput = ref<HTMLInputElement | null>(null);

const priorityOptions = computed<NotificationPriority[]>(() =>
  [...NOTIFICATION_PRIORITIES].sort((a, b) => priorityRank[a] - priorityRank[b]),
);

function matches(text: string): boolean {
  const q = search.value.trim().toLowerCase();
  return q === "" || text.toLowerCase().includes(q);
}

const visiblePriorities = computed(() =>
  priorityOptions.value.filter((p) => matches(priorityLabel[p])),
);
const visibleModules = computed(() => feed.availableModules.filter((m) => matches(m)));
const noMatches = computed(
  () => visiblePriorities.value.length === 0 && visibleModules.value.length === 0,
);

function toggleOpen() {
  open.value = !open.value;
}

function close() {
  open.value = false;
}

function onDocumentPointer(event: MouseEvent) {
  if (root.value && !root.value.contains(event.target as Node)) close();
}

watch(open, async (isOpen) => {
  if (isOpen) {
    document.addEventListener("mousedown", onDocumentPointer);
    await nextTick();
    searchInput.value?.focus();
  } else {
    document.removeEventListener("mousedown", onDocumentPointer);
    search.value = "";
  }
});

onBeforeUnmount(() => document.removeEventListener("mousedown", onDocumentPointer));
</script>

<template>
  <div ref="root" class="relative">
    <button
      type="button"
      class="inline-flex items-center gap-1.5 rounded-md border border-line-strong bg-surface px-3 py-1.5 text-[12px] font-medium text-text transition-colors duration-100 hover:bg-sunken"
      :aria-expanded="open"
      aria-haspopup="true"
      @click="toggleOpen"
      @keydown.esc="close"
    >
      <Icon :icon="SlidersHorizontal" :size="14" />
      Filter
      <span
        v-if="feed.activeFilterCount > 0"
        class="ml-0.5 grid size-4 place-items-center rounded-full bg-accent font-mono text-[11px] font-semibold tabular-nums text-accent-ink"
      >
        {{ feed.activeFilterCount }}
      </span>
    </button>

    <div
      v-if="open"
      class="absolute right-0 z-30 mt-1.5 w-64 rounded-lg border border-line-strong bg-surface shadow-lg shadow-black/5"
      role="group"
      aria-label="Filter notifications"
      @keydown.esc="close"
    >
      <div class="border-b border-line p-2">
        <input
          ref="searchInput"
          v-model="search"
          type="text"
          placeholder="Search filters…"
          class="w-full rounded-md bg-sunken px-2.5 py-1.5 text-[13px] text-text placeholder:text-faint"
          aria-label="Search filters"
        />
      </div>

      <div class="max-h-72 overflow-y-auto p-1.5">
        <template v-if="visiblePriorities.length">
          <p class="px-2 py-1 font-mono text-[11px] uppercase tracking-wide text-faint">Priority</p>
          <label
            v-for="p in visiblePriorities"
            :key="p"
            class="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] text-text hover:bg-sunken"
          >
            <input
              type="checkbox"
              class="accent-accent"
              :checked="feed.priorities.has(p)"
              @change="feed.togglePriority(p)"
            />
            <span class="size-2 rounded-full" :class="priorityDotClass[p]" aria-hidden="true" />
            {{ priorityLabel[p] }}
          </label>
        </template>

        <template v-if="visibleModules.length">
          <p class="mt-1 px-2 py-1 font-mono text-[11px] uppercase tracking-wide text-faint">
            Module
          </p>
          <label
            v-for="m in visibleModules"
            :key="m"
            class="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] text-text hover:bg-sunken"
          >
            <input
              type="checkbox"
              class="accent-accent"
              :checked="feed.modules.has(m)"
              @change="feed.toggleModule(m)"
            />
            <span class="truncate font-mono text-[12px]">{{ m }}</span>
          </label>
        </template>

        <p v-if="noMatches" class="px-2 py-4 text-center text-[12px] text-faint">
          No filters match “{{ search }}”.
        </p>
      </div>

      <div v-if="feed.activeFilterCount > 0" class="border-t border-line p-1.5">
        <button
          type="button"
          class="w-full rounded-md px-2 py-1.5 text-left text-[12px] font-medium text-muted transition-colors duration-100 hover:bg-sunken hover:text-text"
          @click="feed.clearFilters()"
        >
          Clear all filters
        </button>
      </div>
    </div>
  </div>
</template>
