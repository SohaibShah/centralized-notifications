<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { FlaskConical } from "@lucide/vue";
import Button from "@/components/ui/Button.vue";
import Icon from "@/components/ui/Icon.vue";
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

// Preset ids/labels mirror backend/src/sim/presets.ts PRESET_IDS.
const presets: { id: string; label: string; blurb: string }[] = [
  { id: "critical-dsr", label: "Critical DSR", blurb: "SLA-breaching data-subject request." },
  { id: "high-access", label: "High · access request", blurb: "Approval with action buttons." },
  { id: "normal-finding", label: "Normal · data finding", blurb: "Routine scan classification." },
  { id: "low-assessment", label: "Low · assessment reminder", blurb: "Low-priority reminder." },
  { id: "long-body", label: "Long body", blurb: "Very long description." },
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
  } catch {
    error.value = "Couldn't publish. Check you're signed in as an admin and try again.";
    throw new Error("simulate failed"); // let drip stop on error
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
const dripping = ref(false);
let dripTimer: ReturnType<typeof setInterval> | undefined;
let ticksDone = 0;

function stopDrip(): void {
  if (dripTimer) clearInterval(dripTimer);
  dripTimer = undefined;
  dripping.value = false;
}
function onDrip(values: FormValues): void {
  stopDrip();
  const count = Number(values.count);
  const intervalMs = Math.max(1, Number(values.intervalSeconds)) * 1000;
  const total = Number(values.totalTicks ?? 0);
  ticksDone = 0;
  dripping.value = true;
  dripTimer = setInterval(() => {
    void run({ mode: "burst", count })
      .then(() => {
        ticksDone++;
        if (total > 0 && ticksDone >= total) stopDrip();
      })
      .catch(() => stopDrip());
  }, intervalMs);
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

    <div class="mb-4 flex gap-1.5" role="tablist" aria-label="Generator mode">
      <button
        v-for="m in modes"
        :key="m.id"
        type="button"
        role="tab"
        :data-test="`mode-${m.id}`"
        :aria-selected="mode === m.id"
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
        <div class="text-[13px] font-semibold text-text">{{ p.label }}</div>
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
      <Button
        v-if="dripping"
        variant="secondary"
        size="sm"
        class="mt-3"
        data-test="drip-stop"
        @click="stopDrip"
      >
        Stop drip
      </Button>
    </div>

    <p v-if="result" role="status" aria-live="polite" class="mt-4 font-mono text-[12px] text-muted">
      Published {{ result.published
      }}<span v-if="result.suppressed"> · {{ result.suppressed }} suppressed</span>
    </p>
    <p v-if="error" role="alert" class="mt-4 text-[13px] text-danger">{{ error }}</p>
  </section>
</template>
