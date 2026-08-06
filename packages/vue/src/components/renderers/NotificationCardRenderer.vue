<script setup lang="ts">
import { computed, ref } from "vue";
import type { FeedNotification, NotificationAction } from "@notifications/shared";
import Icon from "../../ui/Icon.vue";
import Spinner from "../../ui/Spinner.vue";
import { priorityLabel, priorityTextClass } from "../../design/tokens";
import { exactTime, relativeTime } from "../../lib/time";
import { useActions, useSettings } from "../../provider/context";
import { useUi } from "../../theming/useUi";

const parts = {
  root: "group border-b border-line px-4 py-2.5 transition-colors duration-100",
  readToggle: "mt-0.5 shrink-0 rounded-full transition-colors duration-100",
  title: "block w-full text-left font-sans text-[14px]",
  caret: "shrink-0 self-center text-faint transition-transform duration-150",
  time: "shrink-0 font-mono text-[12px] tabular-nums text-faint",
  description: "mt-0.5 text-[13px] leading-relaxed text-muted",
  meta: "mt-1 flex items-center gap-x-2 text-[12px] text-faint",
  priority: "shrink-0 font-mono text-[11px] uppercase tracking-wide",
  action:
    "inline-flex items-center gap-1.5 rounded-md border border-line-strong bg-surface px-2.5 py-1 text-[12px] font-medium text-text transition-colors duration-100 hover:bg-sunken disabled:pointer-events-none disabled:opacity-50",
} as const;

// Config-driven feed row. Compact by default; clicking anywhere on the card (body or title)
// opens it — expands any extra content (actions or a long body) AND marks it read
// (open-and-seen, emit "open"). A decorative caret next to the timestamp signals that a card
// is expandable and rotates when open; it is not a separate control (it sits inside the
// clickable card, and the title button carries the aria-expanded disclosure state for
// keyboard/SR users). Actions and "Mark as unread" stop propagation and don't mark read here;
// firing an action marks it read too, but that's the consumer's (InboxTab) job.
// `flush`: render without the priority edge-strip + wash. Used when the card is a threaded stack
// member (StackRow), where per-member priority is already carried by the stack's inner priority line
// + the priority-label text — the card's own strip would be a second, colliding vertical. Default
// (flat feed) keeps the full emphasis.
const props = defineProps<{
  notification: FeedNotification;
  flush?: boolean;
  ui?: Partial<Record<keyof typeof parts, string>>;
}>();
const emit = defineEmits<{
  open: [notification: FeedNotification];
  action: [action: NotificationAction, notification: FeedNotification, index: number];
  unread: [notification: FeedNotification];
}>();

const ui = useUi("card", parts, () => props.ui);
const settings = useSettings();
const { isPending, isLocked, resultFor } = useActions();

const item = computed(() => props.notification);
// Link actions always render; `dispatch` actions render only when `actionsEnabled` is on (see the
// same gate on the button below). Counting raw `actions.length` here would make a card whose ONLY
// actions are `dispatch`-kind show an expand caret that reveals an empty row once gated off.
const visibleActionCount = computed(
  () =>
    item.value.actions?.filter((a) => a.kind !== "dispatch" || settings.flags.actionsEnabled)
      .length ?? 0,
);
const hasActions = computed(() => visibleActionCount.value > 0);
// A long body gets an expand affordance even with no actions (single-line truncate hides it).
const isLongBody = computed(
  () => (item.value.description?.length ?? 0) > 140 || (item.value.title?.length ?? 0) > 60,
);
const canExpand = computed(() => hasActions.value || isLongBody.value);
const expanded = ref(false);

// Priority emphasis on the card edge/background. Critical & high own the left edge with a colored
// strip + faint wash (see `.prio-*` in main.css) — always, since priority is intrinsic to the
// notification. Normal & low stay quiet and keep the pine "unread" edge while unread; read state is
// still carried everywhere by the read/unread toggle icon and the title weight.
const cardEmphasis = computed(() => {
  // Threaded stack member: fully transparent — no strip, no wash, and (crucially) no opaque hover fill
  // that would paint over the wrapper's priority wash. The member WRAPPER (StackRow) owns the row
  // background + hover (a wash, or a translucent sunken for normal/low).
  if (props.flush) return "";
  const p = item.value.priority;
  if (p === "critical") return "prio-critical";
  if (p === "high") return "prio-high";
  return item.value.read
    ? "hover:bg-sunken"
    : "hover:bg-sunken shadow-[inset_2px_0_0_var(--color-accent)]";
});

// Only genuinely-live rows (createdAt ≈ now) get the fade+rise entrance.
const isFresh = Date.now() - new Date(props.notification.createdAt).getTime() < 4000;

function activate() {
  // Open-and-seen: clicking a card opens it (expands, if there's more to show) AND marks it read.
  if (canExpand.value) expanded.value = !expanded.value;
  emit("open", item.value); // parent → markRead (no-op if already read)
}
function toggleRead() {
  // Explicit read-state toggle: marks read WITHOUT expanding (open-and-seen still lives on the
  // card body). Reuses the open/unread emits the parent maps to feed.markRead / feed.markUnread.
  if (item.value.read) emit("unread", item.value);
  else emit("open", item.value);
}
</script>

<template>
  <article :class="ui('root', { 'animate-enter': isFresh }, cardEmphasis)">
    <div class="flex cursor-pointer gap-3" @click="activate">
      <button
        type="button"
        data-test="read-toggle"
        :class="ui('readToggle')"
        :aria-label="item.read ? 'Mark as unread' : 'Mark as read'"
        @click.stop="toggleRead"
      >
        <Icon
          :name="item.read ? 'circle-check' : 'circle'"
          :size="16"
          :class="
            item.read
              ? 'text-faint hover:text-muted'
              : 'fill-accent/20 text-accent hover:fill-accent/40'
          "
        />
      </button>

      <div class="min-w-0 flex-1">
        <div class="flex items-baseline justify-between gap-3">
          <h3 class="min-w-0 flex-1">
            <button
              type="button"
              :class="
                ui(
                  'title',
                  item.read ? 'font-normal text-muted' : 'font-semibold text-text',
                  expanded ? 'break-words' : 'truncate',
                )
              "
              :title="item.title"
              :aria-expanded="canExpand ? expanded : undefined"
              @click.stop="activate"
            >
              {{ item.title }}
            </button>
          </h3>
          <Icon
            v-if="canExpand"
            name="chevron-down"
            :size="14"
            data-test="expand-caret"
            :class="ui('caret', { 'rotate-180': expanded })"
          />
          <time :class="ui('time')" :datetime="item.createdAt" :title="exactTime(item.createdAt)">
            {{ relativeTime(item.createdAt) }}
          </time>
        </div>

        <p
          v-if="item.description"
          data-test="card-body"
          :class="ui('description', expanded ? 'whitespace-pre-line break-words' : 'truncate')"
        >
          {{ item.description }}
        </p>

        <!-- Single-line meta row: the module/category text truncates in a flex-1 group so the
             right-hand priority label keeps a stable position on every card. -->
        <div :class="ui('meta')">
          <div class="flex min-w-0 flex-1 items-center gap-x-2">
            <span class="shrink-0 font-mono uppercase tracking-wide">{{ item.module }}</span>
            <template v-if="item.category">
              <span aria-hidden="true" class="shrink-0">·</span>
              <span class="truncate">{{ item.category }}</span>
            </template>
          </div>
          <span
            data-test="priority-label"
            :class="ui('priority', priorityTextClass[item.priority])"
          >
            {{ priorityLabel[item.priority] }}
          </span>
        </div>
      </div>
    </div>

    <div v-if="expanded && hasActions" class="mt-2.5 flex flex-wrap items-start gap-2 pl-5">
      <span
        v-for="(action, i) in item.actions"
        :key="action.label + '-' + i"
        class="inline-flex flex-col items-start gap-1"
      >
        <button
          v-if="action.kind !== 'dispatch' || settings.flags.actionsEnabled"
          type="button"
          data-test="action"
          :class="ui('action')"
          :disabled="action.kind === 'dispatch' && isLocked(item.id)"
          :aria-busy="action.kind === 'dispatch' && isPending(item.id, i) ? 'true' : undefined"
          @click.stop="emit('action', action, item, i)"
        >
          <Spinner v-if="action.kind === 'dispatch' && isPending(item.id, i)" :size="13" />
          <Icon v-else-if="action.icon" :name="action.icon" :size="13" />
          {{ action.label }}
        </button>
        <span
          v-if="action.kind === 'dispatch' && resultFor(item.id, i)"
          data-test="action-result"
          class="text-[12px]"
          :class="resultFor(item.id, i)?.ok ? 'text-success-strong' : 'text-danger'"
        >
          {{ resultFor(item.id, i)?.message }}
        </span>
      </span>
    </div>
  </article>
</template>
