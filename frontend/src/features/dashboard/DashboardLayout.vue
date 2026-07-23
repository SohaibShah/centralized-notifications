<script setup lang="ts">
import { computed } from "vue";
import {
  NotificationProvider,
  CriticalToastViewport,
  type NotificationConfig,
} from "@notifications/vue";
import { useSessionStore } from "@/stores/session";
import DashboardSidebar from "./components/DashboardSidebar.vue";
import DashboardTopBar from "./components/DashboardTopBar.vue";
import DashboardNotificationsLifecycle from "./DashboardNotificationsLifecycle.vue";

// The dashboard shell mounts the notification library: <NotificationProvider> injects the host's
// identity (from the session) + same-origin transport, and the lifecycle child drives connect/load.
const session = useSessionStore();
const config = computed<NotificationConfig>(() => ({
  baseUrl: "",
  user: session.user ? { roles: session.user.roles, teamKeys: session.user.teamIds } : null,
}));
</script>

<template>
  <NotificationProvider :config="config">
    <DashboardNotificationsLifecycle>
      <div class="flex h-screen overflow-hidden">
        <DashboardSidebar />
        <div class="flex min-w-0 flex-1 flex-col">
          <DashboardTopBar />
          <main class="min-h-0 flex-1 overflow-y-auto bg-bg">
            <RouterView />
          </main>
        </div>
        <CriticalToastViewport />
      </div>
    </DashboardNotificationsLifecycle>
  </NotificationProvider>
</template>
