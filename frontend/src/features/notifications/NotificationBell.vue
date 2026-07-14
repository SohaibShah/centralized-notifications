<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { Bell } from "@lucide/vue";
import Icon from "@/components/ui/Icon.vue";
import { useFeedStore } from "@/stores/feed";
import NotificationPopover from "./NotificationPopover.vue";

const feed = useFeedStore();
const open = ref(false);
const root = ref<HTMLElement | null>(null);
const bellButton = ref<HTMLButtonElement | null>(null);

const badge = computed(() => (feed.unreadCount > 9 ? "9+" : String(feed.unreadCount)));

function toggle() {
  open.value = !open.value;
}
function close() {
  open.value = false;
}

// Dismissal: a pointer press outside the whole bell+popover, or Escape, closes it.
function onDocumentPointer(event: MouseEvent) {
  if (root.value && !root.value.contains(event.target as Node)) close();
}
function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") close();
}

watch(open, (isOpen) => {
  if (isOpen) {
    document.addEventListener("mousedown", onDocumentPointer);
    document.addEventListener("keydown", onKeydown);
  } else {
    document.removeEventListener("mousedown", onDocumentPointer);
    document.removeEventListener("keydown", onKeydown);
    // Return focus to the trigger when the panel closes (accessibility).
    bellButton.value?.focus();
  }
});

onBeforeUnmount(() => {
  document.removeEventListener("mousedown", onDocumentPointer);
  document.removeEventListener("keydown", onKeydown);
});
</script>

<template>
  <div ref="root" class="relative">
    <button
      ref="bellButton"
      type="button"
      class="relative grid size-9 place-items-center rounded-md text-muted transition-colors duration-100 hover:bg-sunken hover:text-text"
      :aria-label="
        feed.unreadCount > 0 ? `Notifications, ${feed.unreadCount} unread` : 'Notifications'
      "
      aria-haspopup="dialog"
      :aria-expanded="open"
      @click="toggle"
    >
      <Icon :icon="Bell" :size="18" />
      <span
        v-if="feed.unreadCount > 0"
        class="absolute -right-0.5 -top-0.5 grid min-w-4 place-items-center rounded-full bg-danger px-1 font-mono text-[10px] font-semibold tabular-nums text-white"
        aria-hidden="true"
      >
        {{ badge }}
      </span>
    </button>

    <div v-if="open" class="absolute right-0 top-full z-40 mt-2">
      <NotificationPopover @close="close" />
    </div>
  </div>
</template>
