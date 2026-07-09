<script setup lang="ts">
import { computed } from "vue";
import { Inbox, LogOut, Settings, ShieldCheck } from "@lucide/vue";
import { useRouter } from "vue-router";
import Icon from "@/components/ui/Icon.vue";
import { useSessionStore } from "@/stores/session";

// Role-aware navigation (design-system): everyone gets the inbox + a settings cog;
// the Admin entry is rendered only for the `admin` role. Destinations that don't
// exist yet (Admin panel → Week 2, Settings → Week 4) are shown as present-but-not-
// -yet-active rather than as dead links that pretend to navigate.
const session = useSessionStore();
const router = useRouter();

const initials = computed(() => {
  const name = session.user?.displayName ?? session.user?.username ?? "";
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
});

const primaryRole = computed(() => session.user?.roles[0] ?? "member");

async function signOut() {
  await session.logout();
  await router.replace({ name: "login" });
}
</script>

<template>
  <aside class="flex w-60 shrink-0 flex-col border-r border-line bg-surface">
    <div class="flex items-center gap-2 px-5 py-5">
      <span
        class="grid size-7 place-items-center rounded-md bg-accent font-display text-[16px] font-semibold text-accent-ink"
      >
        S
      </span>
      <span class="font-display text-[18px] font-medium tracking-tight text-text">Signals</span>
    </div>

    <nav class="flex flex-1 flex-col gap-0.5 px-3" aria-label="Primary">
      <RouterLink
        :to="{ name: 'feed' }"
        class="flex items-center gap-2.5 rounded-md px-3 py-2 text-[13px] font-medium text-muted transition-colors duration-100 hover:bg-sunken hover:text-text"
        active-class="!bg-accent/10 !text-accent"
      >
        <Icon :icon="Inbox" :size="16" />
        Inbox
      </RouterLink>

      <div
        v-if="session.isAdmin"
        class="flex items-center gap-2.5 rounded-md px-3 py-2 text-[13px] font-medium text-faint"
        title="Admin console — coming in a later milestone"
      >
        <Icon :icon="ShieldCheck" :size="16" />
        Admin
        <span
          class="ml-auto rounded-full bg-sunken px-1.5 py-0.5 font-mono text-[11px] uppercase tracking-wide text-faint"
        >
          Soon
        </span>
      </div>
    </nav>

    <div class="border-t border-line px-3 py-3">
      <div class="flex items-center gap-2.5 rounded-md px-2 py-1.5">
        <span
          class="grid size-7 shrink-0 place-items-center rounded-full bg-sunken font-mono text-[11px] font-medium text-muted"
        >
          {{ initials }}
        </span>
        <div class="min-w-0 flex-1">
          <p class="truncate text-[12px] font-medium text-text">
            {{ session.user?.displayName ?? session.user?.username }}
          </p>
          <p class="truncate text-[11px] capitalize text-faint">{{ primaryRole }}</p>
        </div>
        <button
          type="button"
          class="grid size-7 place-items-center rounded-md text-faint transition-colors duration-100 hover:bg-sunken hover:text-text"
          title="Settings — coming in a later milestone"
          aria-label="Settings"
        >
          <Icon :icon="Settings" :size="16" />
        </button>
        <button
          type="button"
          class="grid size-7 place-items-center rounded-md text-faint transition-colors duration-100 hover:bg-sunken hover:text-text"
          aria-label="Sign out"
          @click="signOut"
        >
          <Icon :icon="LogOut" :size="15" />
        </button>
      </div>
    </div>
  </aside>
</template>
