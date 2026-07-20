<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { ApiError } from "@/api/client";
import Button from "@/components/ui/Button.vue";
import {
  deleteAllNotifications,
  deleteNotificationsOlderThan,
  deleteReadNotifications,
  getAdminSettings,
  patchAdminSettings,
  resetModules,
  resetSettings,
} from "./adminApi";

const busy = ref(false);
const message = ref<string | null>(null);
const error = ref<string | null>(null);

// Which op currently has its inline confirm open (null = none).
const confirming = ref<string | null>(null);
const deleteAllText = ref("");
const olderThanDays = ref(30);
const retentionDays = ref(30);

// v-model.number yields NaN/0 for a cleared field; guard the destructive/save buttons so an
// invalid value can't be submitted (the backend also rejects it with a 400).
const olderThanValid = computed(
  () => Number.isFinite(olderThanDays.value) && olderThanDays.value >= 1,
);
const retentionValid = computed(
  () => Number.isFinite(retentionDays.value) && retentionDays.value >= 1,
);

onMounted(async () => {
  try {
    const s = await getAdminSettings();
    retentionDays.value = s.retentionDays;
    olderThanDays.value = s.retentionDays; // "delete older than N" defaults to the retention window
  } catch {
    // leave defaults
  }
});

async function run(
  label: string,
  fn: () => Promise<{ deleted?: number } | { updated?: number } | { ok: true }>,
): Promise<void> {
  busy.value = true;
  error.value = null;
  message.value = null;
  try {
    const res = await fn();
    if ("deleted" in res && res.deleted !== undefined) message.value = `Deleted ${res.deleted}`;
    else if ("updated" in res && res.updated !== undefined)
      message.value = `Re-enabled ${res.updated}`;
    else message.value = label;
    confirming.value = null;
    deleteAllText.value = "";
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Operation failed.";
  } finally {
    busy.value = false;
  }
}

async function saveRetention(): Promise<void> {
  await run("Saved", async () => {
    await patchAdminSettings({ retentionDays: Number(retentionDays.value) });
    return { ok: true } as const;
  });
}
</script>

<template>
  <section class="flex flex-col gap-5">
    <div>
      <h2 class="font-display text-[16px] font-medium text-text">Maintenance</h2>
      <p class="mt-0.5 text-[12px] text-muted">
        Destructive, dev/QA only. These run immediately against the real database.
      </p>
    </div>

    <!-- Delete read -->
    <div class="flex items-center gap-3 border-b border-line pb-4">
      <div class="min-w-0 flex-1">
        <div class="text-[13px] font-semibold text-text">Delete read ("Earlier")</div>
        <div class="text-[11px] text-faint">Removes every notification anyone has read.</div>
      </div>
      <template v-if="confirming === 'delete-read'">
        <Button variant="secondary" size="sm" @click="confirming = null">Cancel</Button>
        <Button
          variant="danger"
          size="sm"
          data-test="op-delete-read-confirm"
          :disabled="busy"
          @click="run('Deleted', deleteReadNotifications)"
          >Confirm</Button
        >
      </template>
      <Button
        v-else
        variant="secondary"
        size="sm"
        data-test="op-delete-read"
        @click="confirming = 'delete-read'"
        >Delete read</Button
      >
    </div>

    <!-- Delete older than N -->
    <div class="flex items-center gap-3 border-b border-line pb-4">
      <div class="min-w-0 flex-1">
        <div class="text-[13px] font-semibold text-text">Delete older than</div>
        <div class="text-[11px] text-faint">Defaults to the retention window.</div>
      </div>
      <input
        v-model.number="olderThanDays"
        type="number"
        min="1"
        aria-label="Delete notifications older than, in days"
        data-test="older-than-input"
        class="h-8 w-16 rounded-md border border-line-strong bg-surface px-2 text-[13px] tabular-nums text-text"
      />
      <span class="text-[12px] text-muted">days</span>
      <Button
        variant="danger"
        size="sm"
        data-test="op-older-than"
        :disabled="busy || !olderThanValid"
        @click="run('Deleted', () => deleteNotificationsOlderThan(Number(olderThanDays)))"
        >Delete</Button
      >
    </div>

    <!-- Reset modules / settings -->
    <div class="flex items-center gap-3 border-b border-line pb-4">
      <div class="min-w-0 flex-1">
        <div class="text-[13px] font-semibold text-text">Reset</div>
        <div class="text-[11px] text-faint">
          Clear discovered modules or restore feature defaults.
        </div>
      </div>
      <Button
        variant="secondary"
        size="sm"
        data-test="op-reset-modules"
        :disabled="busy"
        @click="run('Reset', resetModules)"
        >Reset modules</Button
      >
      <Button
        variant="secondary"
        size="sm"
        data-test="op-reset-settings"
        :disabled="busy"
        @click="run('Reset', resetSettings)"
        >Reset settings</Button
      >
    </div>

    <!-- Delete all (typed confirm) -->
    <div class="rounded-lg border border-danger/30 bg-danger/5 p-3">
      <div class="text-[13px] font-semibold text-danger">Delete ALL notifications</div>
      <div class="mb-2 text-[11px] text-muted">Irreversible. Type DELETE to confirm.</div>
      <template v-if="confirming === 'delete-all'">
        <div class="flex items-center gap-2">
          <input
            v-model="deleteAllText"
            aria-label="Type DELETE to confirm"
            data-test="op-delete-all-input"
            placeholder="DELETE"
            class="h-8 w-28 rounded-md border border-line-strong bg-surface px-2 text-[13px] text-text"
          />
          <Button
            variant="secondary"
            size="sm"
            @click="
              confirming = null;
              deleteAllText = '';
            "
            >Cancel</Button
          >
          <Button
            variant="danger"
            size="sm"
            data-test="op-delete-all-confirm"
            :disabled="busy || deleteAllText !== 'DELETE'"
            @click="run('Deleted', deleteAllNotifications)"
            >Confirm delete</Button
          >
        </div>
      </template>
      <Button
        v-else
        variant="secondary"
        size="sm"
        data-test="op-delete-all"
        @click="confirming = 'delete-all'"
        >Delete all…</Button
      >
    </div>

    <!-- Retention window -->
    <div class="flex items-center gap-3">
      <div class="min-w-0 flex-1">
        <div class="text-[13px] font-semibold text-text">Retention window</div>
        <div class="text-[11px] text-faint">
          Config only for now — automatic deletion arrives with Week-5 partitioning.
        </div>
      </div>
      <input
        v-model.number="retentionDays"
        type="number"
        min="1"
        aria-label="Retention window, in days"
        data-test="retention-input"
        class="h-8 w-16 rounded-md border border-line-strong bg-surface px-2 text-[13px] tabular-nums text-text"
      />
      <span class="text-[12px] text-muted">days</span>
      <Button
        size="sm"
        data-test="retention-save"
        :disabled="busy || !retentionValid"
        @click="saveRetention"
        >Save</Button
      >
    </div>

    <p
      v-if="message"
      role="status"
      aria-live="polite"
      class="font-mono text-[12px] tabular-nums text-muted"
    >
      {{ message }}
    </p>
    <p v-if="error" role="alert" class="text-[13px] text-danger">{{ error }}</p>
  </section>
</template>
