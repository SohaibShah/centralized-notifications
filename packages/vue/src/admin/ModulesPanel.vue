<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { Boxes } from "@lucide/vue";
import type { NotificationPriority } from "@notifications/shared";
import { NOTIFICATION_PRIORITIES } from "@notifications/shared";
import Button from "../ui/Button.vue";
import Chip from "../ui/Chip.vue";
import Spinner from "../ui/Spinner.vue";
import StatePanel from "../ui/StatePanel.vue";
import { priorityLabel } from "../design/tokens";
import { relativeTime } from "../lib/time";
import { useTransport } from "../provider/context";
import { createAdminApi, type AdminModule } from "./adminApi";

type Sort = "critical" | "total" | "recent" | "name";

const admin = createAdminApi(useTransport());
const modules = ref<AdminModule[]>([]);
const status = ref<"loading" | "ready" | "error">("loading");
const priorityFilter = ref<NotificationPriority | null>(null);
const sort = ref<Sort>("critical");

async function load(): Promise<void> {
  status.value = "loading";
  try {
    modules.value = await admin.fetchModules();
    status.value = "ready";
  } catch {
    status.value = "error";
  }
}
onMounted(load);

const visible = computed(() => {
  let list = modules.value;
  const p = priorityFilter.value;
  if (p) list = list.filter((m) => m.byPriority[p] > 0);
  const by = sort.value;
  return [...list].sort((a, b) => {
    if (by === "critical")
      return b.byPriority.critical - a.byPriority.critical || b.total - a.total;
    if (by === "total") return b.total - a.total;
    if (by === "recent") return b.lastSeenAt.localeCompare(a.lastSeenAt);
    return a.label.localeCompare(b.label);
  });
});

function priorityCount(p: NotificationPriority): number {
  return modules.value.filter((m) => m.byPriority[p] > 0).length;
}

async function toggle(m: AdminModule): Promise<void> {
  const next = !m.enabled;
  m.enabled = next; // optimistic
  try {
    await admin.patchModule(m.key, { enabled: next });
  } catch {
    m.enabled = !next; // revert
  }
}
</script>

<template>
  <section>
    <h2 class="font-display text-[16px] font-medium text-text">Modules</h2>
    <p class="mt-0.5 text-[12px] text-muted">
      The modules that can send notifications. Disable one to stop it reaching anyone — existing
      items stay; new ones are recorded but suppressed.
    </p>

    <div v-if="status === 'loading'" class="flex justify-center py-10"><Spinner :size="18" /></div>

    <StatePanel
      v-else-if="status === 'error'"
      :icon="Boxes"
      title="Couldn't load modules"
      description="Something went wrong fetching the module list."
    >
      <Button variant="secondary" size="sm" @click="load">Try again</Button>
    </StatePanel>

    <StatePanel
      v-else-if="modules.length === 0"
      :icon="Boxes"
      title="No modules configured"
      description="Modules are seeded in the database; none were returned."
    />

    <template v-else>
      <div class="mt-4 flex flex-wrap items-center gap-1.5">
        <Chip :active="priorityFilter === null" @click="priorityFilter = null">All</Chip>
        <Chip
          v-for="p in NOTIFICATION_PRIORITIES"
          :key="p"
          :active="priorityFilter === p"
          :data-test="`filter-${p}`"
          @click="priorityFilter = priorityFilter === p ? null : p"
        >
          {{ priorityLabel[p] }}
          <span class="font-mono text-[11px] tabular-nums opacity-70">{{ priorityCount(p) }}</span>
        </Chip>
        <label class="ml-auto flex items-center gap-1.5 text-[12px] text-muted">
          Sort
          <select
            v-model="sort"
            class="rounded-md border border-line-strong bg-surface px-2 py-1 text-[12px] text-text"
          >
            <option value="critical">Critical first</option>
            <option value="total">Total volume</option>
            <option value="recent">Recently active</option>
            <option value="name">Name A–Z</option>
          </select>
        </label>
      </div>

      <div
        class="mt-3 flex items-center gap-3 border-b border-line pb-1.5 font-mono text-[9px] uppercase tracking-wide text-faint"
      >
        <span class="flex-1">Module</span>
        <span class="w-44">Priority mix</span>
        <span class="w-12 text-right">Total</span>
        <span class="w-10 text-right">On</span>
      </div>

      <div
        v-for="m in visible"
        :key="m.key"
        class="flex items-center gap-3 border-b border-line py-2.5"
      >
        <div class="min-w-0 flex-1">
          <span class="truncate text-[13px] font-semibold text-text">{{ m.label }}</span>
          <div class="mt-0.5 font-mono text-[10px] text-faint">
            {{ m.key }} · {{ relativeTime(m.lastSeenAt) }}
          </div>
        </div>
        <div class="w-44 font-mono text-[10px] tabular-nums text-muted">
          <span v-if="m.byPriority.critical" class="mr-2 text-danger"
            >{{ m.byPriority.critical }} crit</span
          >
          <span v-if="m.byPriority.high" class="mr-2 text-warning"
            >{{ m.byPriority.high }} high</span
          >
          <span>{{ m.byPriority.normal + m.byPriority.low }} other</span>
          <span v-if="m.suppressed > 0" class="ml-2 text-warning"
            >· {{ m.suppressed }} suppressed</span
          >
        </div>
        <div class="w-12 text-right font-mono text-[12px] font-semibold tabular-nums text-text">
          {{ m.total }}
        </div>
        <div class="w-10 text-right">
          <button
            type="button"
            role="switch"
            :aria-checked="m.enabled"
            :aria-label="`${m.enabled ? 'Disable' : 'Enable'} ${m.label}`"
            :data-test="`toggle-${m.key}`"
            class="relative inline-block h-[18px] w-[32px] rounded-full transition-colors duration-100"
            :class="m.enabled ? 'bg-accent' : 'bg-line-strong'"
            @click="toggle(m)"
          >
            <span
              class="absolute top-0.5 size-[14px] rounded-full bg-surface transition-all duration-100"
              :class="m.enabled ? 'right-0.5' : 'left-0.5'"
            />
          </button>
        </div>
      </div>
    </template>
  </section>
</template>
