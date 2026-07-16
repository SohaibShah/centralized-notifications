<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { FlaskConical } from "@lucide/vue";
import type { NotificationPriority } from "@notifications/shared";
import { ApiError } from "@/api/client";
import Button from "@/components/ui/Button.vue";
import Icon from "@/components/ui/Icon.vue";
import { priorityDotClass } from "@/design/tokens";
import FormRenderer from "@/forms/FormRenderer.vue";
import { burstForm } from "@/forms/burst.form";
import { dripForm } from "@/forms/drip.form";
import { generatorForm, toCustomSpec } from "@/forms/generator.form";
import type { FormSchema, FormValues } from "@/forms/types";
import { fetchModuleKeys, simulate, type SimulateResult, type SimulateSpec } from "./adminApi";

type Mode = "custom" | "preset" | "burst" | "drip";
const modes: { id: Mode; label: string }[] = [
  { id: "custom", label: "Custom" },
  { id: "preset", label: "Presets" },
  { id: "burst", label: "Burst" },
  { id: "drip", label: "Drip" },
];

// Preset ids mirror backend/src/sim/presets.ts PRESET_IDS; priority drives the dot (the
// design system encodes priority as a dot + weight, not words — see priorityDotClass).
const presets: { id: string; label: string; blurb: string; priority: NotificationPriority }[] = [
  {
    id: "critical-dsr",
    label: "DSR SLA breach",
    blurb: "Data-subject request nearing deadline.",
    priority: "critical",
  },
  {
    id: "high-access",
    label: "Access request",
    blurb: "Approval with action buttons.",
    priority: "high",
  },
  {
    id: "normal-finding",
    label: "Data finding",
    blurb: "Routine scan classification.",
    priority: "normal",
  },
  {
    id: "low-assessment",
    label: "Assessment reminder",
    blurb: "Low-priority reminder.",
    priority: "low",
  },
  { id: "long-body", label: "Long body", blurb: "Very long description.", priority: "normal" },
];

const mode = ref<Mode>("custom");
const submitting = ref(false);
const error = ref<string | null>(null);
const result = ref<SimulateResult | null>(null);

const customSchema = ref<FormSchema>(generatorForm([]));
onMounted(async () => {
  try {
    customSchema.value = generatorForm(await fetchModuleKeys());
  } catch {
    // Datalist is a convenience; a fetch failure just means no suggestions.
  }
});

async function run(spec: SimulateSpec): Promise<void> {
  submitting.value = true;
  error.value = null;
  try {
    result.value = await simulate(spec);
  } catch (err) {
    // Surface the real reason instead of always blaming auth: only 401/403 is an auth
    // problem; a 400 carries the server's validation message (e.g. "invalid request body").
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
      error.value = "You must be signed in as an admin to generate notifications.";
    } else if (err instanceof ApiError) {
      error.value = err.message;
    } else {
      error.value = "Couldn't publish. Try again.";
    }
    throw err instanceof Error ? err : new Error("simulate failed"); // let drip stop on error
  } finally {
    submitting.value = false;
  }
}

function onCustom(values: FormValues): void {
  void run(toCustomSpec(values)).catch(() => {});
}
function onPreset(id: string): void {
  void run({ mode: "preset", preset: id }).catch(() => {});
}
function onBurst(values: FormValues): void {
  const seed = values.seed === "" || values.seed === undefined ? undefined : Number(values.seed);
  void run({
    mode: "burst",
    count: Number(values.count),
    ...(seed !== undefined ? { seed } : {}),
  }).catch(() => {});
}

// Drip: repeat a burst every interval, up to totalTicks (0 = until Stop). Client-side only.
// A self-rescheduling setTimeout chain (not setInterval) so the next burst is scheduled only
// after the current one settles — no overlap when a burst outlasts the interval, and the tick
// count can't overshoot totalTicks.
const dripping = ref(false);
const dripTick = ref(0);
const dripTotal = ref(0);
let dripTimer: ReturnType<typeof setTimeout> | undefined;
let dripStopped = false;

function stopDrip(): void {
  dripStopped = true;
  if (dripTimer) clearTimeout(dripTimer);
  dripTimer = undefined;
  dripping.value = false;
}

function onDrip(values: FormValues): void {
  stopDrip();
  const count = Number(values.count);
  const intervalMs = Math.max(1, Number(values.intervalSeconds)) * 1000;
  const total = Number(values.totalTicks ?? 0);
  dripStopped = false;
  dripTick.value = 0;
  dripTotal.value = total;
  dripping.value = true;

  const tick = async (): Promise<void> => {
    if (dripStopped) return;
    try {
      await run({ mode: "burst", count });
    } catch {
      stopDrip();
      return;
    }
    if (dripStopped) return;
    dripTick.value++;
    if (total > 0 && dripTick.value >= total) {
      stopDrip();
      return;
    }
    dripTimer = setTimeout(() => void tick(), intervalMs);
  };
  // Fire the first tick immediately, then self-reschedule after each one settles.
  void tick();
}

onBeforeUnmount(stopDrip);
</script>

<template>
  <section>
    <div class="flex items-center gap-2">
      <Icon :icon="FlaskConical" :size="16" class="text-accent" />
      <h2 class="font-display text-[16px] font-medium text-text">Generator</h2>
    </div>
    <p class="mb-3 mt-0.5 text-[12px] text-muted">
      Dev/QA only — publishes through the real pipeline. Not available in production.
    </p>

    <!-- Same button + aria-current switcher pattern as AdminView's section nav (reuse, not a
         second pattern); a full ARIA tablist would need aria-controls + roving tabindex. -->
    <div class="mb-4 flex gap-1.5">
      <button
        v-for="m in modes"
        :key="m.id"
        type="button"
        :data-test="`mode-${m.id}`"
        :aria-current="mode === m.id ? 'true' : undefined"
        class="rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors duration-100"
        :class="
          mode === m.id ? 'bg-accent/10 text-accent' : 'text-muted hover:bg-sunken hover:text-text'
        "
        @click="mode = m.id"
      >
        {{ m.label }}
      </button>
    </div>

    <FormRenderer
      v-if="mode === 'custom'"
      :schema="customSchema"
      :submitting="submitting"
      @submit="onCustom"
    />

    <div v-else-if="mode === 'preset'" class="grid gap-2 sm:grid-cols-2">
      <button
        v-for="p in presets"
        :key="p.id"
        type="button"
        :data-test="`preset-${p.id}`"
        :disabled="submitting"
        class="rounded-lg border border-line bg-surface p-3 text-left transition-colors duration-100 hover:border-line-strong hover:bg-sunken disabled:opacity-60"
        @click="onPreset(p.id)"
      >
        <div class="flex items-center gap-2">
          <span class="size-1.5 shrink-0 rounded-full" :class="priorityDotClass[p.priority]" />
          <div class="text-[13px] font-semibold text-text">{{ p.label }}</div>
        </div>
        <div class="mt-0.5 text-[11px] text-faint">{{ p.blurb }}</div>
      </button>
    </div>

    <FormRenderer
      v-else-if="mode === 'burst'"
      :schema="burstForm"
      :submitting="submitting"
      @submit="onBurst"
    />

    <div v-else>
      <FormRenderer :schema="dripForm" :submitting="submitting && !dripping" @submit="onDrip" />
      <div v-if="dripping" class="mt-3 flex items-center gap-3">
        <Button variant="secondary" size="sm" data-test="drip-stop" @click="stopDrip">
          Stop drip
        </Button>
        <span class="font-mono text-[11px] uppercase tracking-wide text-muted tabular-nums">
          Dripping — tick {{ dripTick }}<span v-if="dripTotal"> of {{ dripTotal }}</span>
        </span>
      </div>
    </div>

    <p v-if="result" role="status" aria-live="polite" class="mt-4 text-[12px] text-muted">
      Published
      <span class="font-mono tabular-nums text-text">{{ result.published }}</span
      ><span v-if="result.suppressed">
        ·
        <span class="font-mono tabular-nums text-text">{{ result.suppressed }}</span>
        suppressed</span
      >
    </p>
    <p v-if="error" role="alert" class="mt-4 text-[13px] text-danger">{{ error }}</p>
  </section>
</template>
