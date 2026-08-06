<script setup lang="ts">
import { computed, ref, watch } from "vue";
import Icon from "../ui/Icon.vue";
import { AUTO_DISMISS_MS, type ToastItem } from "../state/toast";
import { priorityDotClass, priorityLabel, priorityTextClass } from "../design/tokens";
import { useToast } from "../provider/context";
import { useUi } from "../theming/useUi";

const parts = {
  root: "animate-enter relative w-[290px] overflow-hidden rounded-lg border border-line-strong bg-surface p-3 shadow-md shadow-black/10",
  dot: "size-2 shrink-0 rounded-full",
  priority: "font-mono text-[11px] uppercase tracking-wide",
  close:
    "ml-auto grid size-6 place-items-center rounded-md text-faint transition-colors duration-100 hover:bg-sunken hover:text-text",
  title: "block font-sans text-[13px] font-semibold leading-snug text-text",
  description: "mt-0.5 block truncate font-sans text-[12px] text-muted",
  meta: "mt-1.5 font-mono text-[11px] uppercase tracking-wide text-faint",
  viewButton:
    "rounded-md border border-line-strong bg-surface px-3 py-1 text-[12px] font-semibold text-text transition-colors duration-100 hover:bg-sunken",
  dismissButton:
    "rounded-md px-2 py-1 text-[12px] font-semibold text-muted transition-colors duration-100 hover:text-text",
  countdown: "toast-countdown h-full bg-faint/60",
} as const;
const props = defineProps<{ toast: ToastItem; ui?: Partial<Record<keyof typeof parts, string>> }>();
const emit = defineEmits<{ dismiss: []; view: [] }>();
const toasts = useToast();
const ui = useUi("toast", parts, () => props.ui);

// The auto-dismiss timer pauses while the toast is hovered OR keyboard-focused, and only
// resumes once BOTH are clear — ref-counted via two booleans, not one flag, so moving the
// pointer away while focus is still inside doesn't wrongly restart the timer. The store
// starts a FRESH timer on resume, so we remount the countdown bar (bump `cycle`) to restart
// its animation from full, in sync.
const hovering = ref(false);
const focused = ref(false);
const paused = computed(() => hovering.value || focused.value);
const cycle = ref(0);

watch(paused, (isPaused, wasPaused) => {
  if (isPaused && !wasPaused) {
    toasts.pause(props.toast.id);
  } else if (!isPaused && wasPaused) {
    toasts.resume(props.toast.id);
    cycle.value += 1;
  }
});
</script>

<template>
  <div
    role="alert"
    :class="ui('root')"
    @mouseenter="hovering = true"
    @mouseleave="hovering = false"
    @focusin="focused = true"
    @focusout="focused = false"
  >
    <div class="flex items-center gap-2">
      <span :class="[ui('dot'), priorityDotClass[toast.priority]]" aria-hidden="true" />
      <span :class="[ui('priority'), priorityTextClass[toast.priority]]">{{
        priorityLabel[toast.priority]
      }}</span>
      <button
        type="button"
        :class="ui('close')"
        aria-label="Dismiss notification"
        @click="emit('dismiss')"
      >
        <Icon name="x" :size="14" />
      </button>
    </div>
    <button type="button" class="mt-1.5 block w-full text-left" @click="emit('view')">
      <span data-test="toast-title" :class="ui('title')">{{ toast.title }}</span>
      <span v-if="toast.description" :class="ui('description')">
        {{ toast.description }}
      </span>
    </button>
    <div :class="ui('meta')">{{ toast.module }} · just now</div>
    <div class="mt-2.5 flex items-center gap-2">
      <button type="button" :class="ui('viewButton')" @click="emit('view')">View</button>
      <button type="button" :class="ui('dismissButton')" @click="emit('dismiss')">Dismiss</button>
    </div>
    <!-- Quiet auto-dismiss countdown: a 2px neutral hairline receding as the ~6s timer runs. -->
    <div class="absolute inset-x-0 bottom-0 h-0.5 bg-line" aria-hidden="true">
      <div
        :key="cycle"
        :class="ui('countdown')"
        :style="{
          animationDuration: `${AUTO_DISMISS_MS}ms`,
          animationPlayState: paused ? 'paused' : 'running',
        }"
      />
    </div>
  </div>
</template>
