<script setup lang="ts">
// Placeholder dashboard content — the "stage" that frames the notifications bell. Not a
// real feature this pass (design spec: lightweight fake shell); intentionally inert.
const stats = [
  { label: "Open DSARs", value: "12", hint: "3 due this week" },
  { label: "Consent scans", value: "48", hint: "2 flagged" },
  { label: "Policies live", value: "27", hint: "v4 published" },
  { label: "Reports ready", value: "6", hint: "weekly digest" },
];
</script>

<template>
  <div class="mx-auto max-w-5xl px-8 py-8">
    <p class="text-[13px] text-muted">
      A placeholder workspace. Notifications live in the bell, top-right.
    </p>

    <div class="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <div v-for="s in stats" :key="s.label" class="rounded-lg border border-line bg-surface p-5">
        <p class="text-[12px] font-medium uppercase tracking-wide text-faint">{{ s.label }}</p>
        <p class="mt-2 font-mono text-[28px] tabular-nums text-text">{{ s.value }}</p>
        <p class="mt-1 text-[12px] text-muted">{{ s.hint }}</p>
      </div>
    </div>

    <div class="mt-6 rounded-lg border border-line bg-surface p-6">
      <h2 class="font-display text-[16px] text-text">Activity</h2>
      <div class="mt-4 space-y-3" aria-hidden="true">
        <div class="h-3 w-3/4 rounded bg-sunken" />
        <div class="h-3 w-2/3 rounded bg-sunken" />
        <div class="h-3 w-5/6 rounded bg-sunken" />
      </div>
    </div>
  </div>
</template>
