<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { SlidersHorizontal } from "@lucide/vue";
import {
  NOTIFICATION_PRIORITIES,
  type FeedSort,
  type NotificationPriority,
} from "@notifications/shared";
import Icon from "../../ui/Icon.vue";
import { priorityDotClass, priorityLabel, priorityRank } from "../../design/tokens";
import { useFeed } from "../../provider/context";

const sortOptions: { value: FeedSort; label: string }[] = [
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
  { value: "priority-high", label: "Priority: high → low" },
  { value: "priority-low", label: "Priority: low → high" },
];

// The searchable filter dropdown (design-system: "quick chip presets + a searchable
// FilterMenu"). Facets are priority and the modules present in the loaded feed; the
// search box narrows the option list. State lives in the feed store, so applied
// filters also surface as removable pills in the filter bar.
const feed = useFeed();

const open = ref(false);
const search = ref("");
const root = ref<HTMLElement | null>(null);
const triggerBtn = ref<HTMLButtonElement | null>(null);
const menu = ref<HTMLElement | null>(null);
const menuStyle = ref<Record<string, string>>({});
const searchInput = ref<HTMLInputElement | null>(null);

// The dropdown is teleported OUT of the panel so its `overflow-hidden` can't clip it — but to the
// nearest `.notifications-root`, NOT <body>. Teleporting to <body> drops it outside the library's
// token scope, leaving every `--nt-*` design token undefined (borders/colors fall back to the wrong
// values). `.notifications-root` is an ancestor of the panel, so this still escapes the clip while
// keeping the tokens in scope. Falls back to <body> only if no root is found (never, in practice).
const teleportTarget = ref<HTMLElement | string>("body");
onMounted(() => {
  teleportTarget.value = root.value?.closest<HTMLElement>(".notifications-root") ?? document.body;
});

// Because it leaves the normal flow, we position it `fixed`, anchored to the
// trigger button, and recompute on open + on resize.
function positionMenu() {
  const el = triggerBtn.value;
  if (!el) return;
  const r = el.getBoundingClientRect();
  menuStyle.value = {
    position: "fixed",
    top: `${r.bottom + 6}px`,
    right: `${window.innerWidth - r.right}px`,
  };
}

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
  const t = event.target as Node;
  // The panel is teleported out of `root`, so a click inside either counts as "inside".
  if (root.value?.contains(t) || menu.value?.contains(t)) return;
  close();
}

watch(open, async (isOpen) => {
  if (isOpen) {
    positionMenu();
    document.addEventListener("mousedown", onDocumentPointer);
    window.addEventListener("resize", positionMenu);
    await nextTick();
    searchInput.value?.focus();
  } else {
    document.removeEventListener("mousedown", onDocumentPointer);
    window.removeEventListener("resize", positionMenu);
    search.value = "";
  }
});

onBeforeUnmount(() => {
  document.removeEventListener("mousedown", onDocumentPointer);
  window.removeEventListener("resize", positionMenu);
});
</script>

<template>
  <div ref="root" class="relative">
    <button
      ref="triggerBtn"
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

    <Teleport :to="teleportTarget">
      <div
        v-if="open"
        ref="menu"
        :style="menuStyle"
        data-notification-overlay
        class="z-50 w-64 rounded-lg border border-line-strong bg-surface shadow-lg shadow-black/5"
        role="group"
        aria-label="Filter notifications"
        @keydown.esc.stop="close"
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
          <div role="radiogroup" aria-label="Sort by">
            <p class="px-2 py-1 font-mono text-[11px] uppercase tracking-wide text-faint">
              Sort by
            </p>
            <label
              v-for="o in sortOptions"
              :key="o.value"
              class="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] text-text hover:bg-sunken"
            >
              <input
                type="radio"
                name="feed-sort"
                class="accent-accent"
                :data-test="`feed-sort-${o.value}`"
                :value="o.value"
                :checked="feed.sort === o.value"
                @change="feed.setSort(o.value)"
              />
              {{ o.label }}
            </label>
          </div>
          <div class="my-1 border-t border-line" aria-hidden="true" />

          <template v-if="visiblePriorities.length">
            <p class="px-2 py-1 font-mono text-[11px] uppercase tracking-wide text-faint">
              Priority
            </p>
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
              <span
                v-if="feed.counts.unreadByPriority[p] > 0"
                class="ml-auto font-mono text-[11px] tabular-nums text-faint"
                >{{ feed.counts.unreadByPriority[p] }}</span
              >
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
    </Teleport>
  </div>
</template>
