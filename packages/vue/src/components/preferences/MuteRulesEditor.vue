<script setup lang="ts">
import { computed } from "vue";
import { BellOff, ChevronDown, Clock, RotateCcw } from "@lucide/vue";
import type { MuteRule, MuteTargetKind } from "@notifications/shared";
import { usePreferences } from "../../provider/context";
import { muteStatusLabel, resolveSnoozeUntil, SNOOZE_OPTIONS } from "../../preferences/snooze";
import Icon from "../../ui/Icon.vue";

/**
 * Per-user snooze/mute editor. Lists the host's module catalog and the categories currently in play;
 * each row lets the user snooze (for a preset duration, in their own timezone) or mute a
 * module/category. Reads/writes through the preferences store; non-snoozable (e.g. critical)
 * notifications are unaffected by these rules and always get through.
 */
const props = defineProps<{
  modules: { id: string; label: string }[];
  categories: string[];
  /** The user's IANA timezone — used to resolve "tomorrow morning". Defaults to the browser's. */
  timezone?: string;
}>();

const preferences = usePreferences();
const tz = computed(
  () => props.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
);

interface Row {
  kind: MuteTargetKind;
  target: string;
  label: string;
}
const moduleRows = computed<Row[]>(() =>
  props.modules.map((m) => ({ kind: "module", target: m.id, label: m.label })),
);
const categoryRows = computed<Row[]>(() =>
  props.categories.map((c) => ({ kind: "category", target: c, label: c })),
);

function ruleFor(kind: MuteTargetKind, target: string): MuteRule | undefined {
  return preferences.rules.find((r) => r.targetKind === kind && r.target === target);
}
function status(row: Row): string {
  return muteStatusLabel(ruleFor(row.kind, row.target), new Date());
}
function isActive(row: Row): boolean {
  return status(row) !== "Active";
}

async function snooze(row: Row, option: (typeof SNOOZE_OPTIONS)[number]["value"]): Promise<void> {
  try {
    await preferences.setMute(
      row.kind,
      row.target,
      resolveSnoozeUntil(option, new Date(), tz.value),
    );
  } catch {
    /* the store rolls back optimistic state on failure */
  }
}
async function mute(row: Row): Promise<void> {
  try {
    await preferences.setMute(row.kind, row.target, null);
  } catch {
    /* rolled back by the store */
  }
}
async function resume(row: Row): Promise<void> {
  try {
    await preferences.clearMute(row.kind, row.target);
  } catch {
    /* rolled back by the store */
  }
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <section
      v-for="group in [
        { title: 'Modules', rows: moduleRows },
        { title: 'Categories', rows: categoryRows },
      ]"
      v-show="group.rows.length > 0"
      :key="group.title"
      class="flex flex-col gap-1"
    >
      <p class="font-mono text-[11px] font-semibold uppercase tracking-wide text-faint">
        {{ group.title }}
      </p>
      <ul class="flex flex-col divide-y divide-line">
        <li
          v-for="row in group.rows"
          :key="`${row.kind}:${row.target}`"
          data-test="mute-row"
          :data-target="`${row.kind}:${row.target}`"
          class="flex items-center justify-between gap-3 py-2.5"
        >
          <div class="min-w-0">
            <p class="truncate text-[13px] font-medium text-text">{{ row.label }}</p>
            <p
              data-test="mute-status"
              class="text-[11px]"
              :class="isActive(row) ? 'font-medium text-accent' : 'text-faint'"
            >
              {{ status(row) }}
            </p>
          </div>

          <div class="flex shrink-0 items-center gap-1">
            <button
              v-if="isActive(row)"
              type="button"
              data-test="mute-clear"
              class="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-medium text-muted transition-colors hover:bg-sunken hover:text-text"
              @click="resume(row)"
            >
              <Icon :icon="RotateCcw" :size="13" /> Resume
            </button>

            <details class="group relative">
              <summary
                class="inline-flex cursor-pointer list-none items-center gap-1 rounded-md border border-line-strong bg-surface px-2 py-1 text-[12px] font-medium text-text transition-colors hover:bg-sunken [&::-webkit-details-marker]:hidden"
              >
                <Icon :icon="Clock" :size="13" /> Snooze
                <Icon :icon="ChevronDown" :size="12" class="text-faint" />
              </summary>
              <div
                class="absolute right-0 z-10 mt-1 flex w-52 flex-col overflow-hidden rounded-lg border border-line-strong bg-surface py-1 shadow-lg shadow-black/5"
              >
                <button
                  v-for="opt in SNOOZE_OPTIONS"
                  :key="opt.value"
                  type="button"
                  data-test="snooze-option"
                  :data-value="opt.value"
                  class="px-3 py-1.5 text-left text-[12.5px] text-text transition-colors hover:bg-sunken"
                  @click="snooze(row, opt.value)"
                >
                  {{ opt.label }}
                </button>
              </div>
            </details>

            <button
              type="button"
              data-test="mute-toggle"
              class="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[12px] font-medium transition-colors"
              :class="
                ruleFor(row.kind, row.target)?.mutedUntil === null
                  ? 'border-accent/30 bg-accent/10 text-accent'
                  : 'border-line-strong bg-surface text-text hover:bg-sunken'
              "
              :aria-pressed="ruleFor(row.kind, row.target)?.mutedUntil === null"
              @click="ruleFor(row.kind, row.target)?.mutedUntil === null ? resume(row) : mute(row)"
            >
              <Icon :icon="BellOff" :size="13" />
              {{ ruleFor(row.kind, row.target)?.mutedUntil === null ? "Muted" : "Mute" }}
            </button>
          </div>
        </li>
      </ul>
    </section>
  </div>
</template>
