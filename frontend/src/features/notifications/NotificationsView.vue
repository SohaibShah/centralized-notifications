<script setup lang="ts">
import { useRouter } from "vue-router";
import Button from "@/components/ui/Button.vue";
import { useSessionStore } from "@/stores/session";

// Placeholder shell for increment 7a — proves the authenticated route + logout loop.
// Increment 7b replaces this with the real sidebar + top bar + virtualized live feed.
const session = useSessionStore();
const router = useRouter();

async function signOut() {
  await session.logout();
  await router.replace({ name: "login" });
}
</script>

<template>
  <main class="mx-auto max-w-xl px-6 py-16">
    <h1 class="mb-1 text-[22px]">Notifications</h1>
    <p class="text-[13px] text-muted">
      Signed in as
      <span class="font-medium text-text">{{ session.user?.displayName ?? session.user?.username }}</span>
      <template v-if="session.isAdmin"> · admin</template>. The live feed arrives in the next
      increment.
    </p>
    <div class="mt-6">
      <Button variant="secondary" size="sm" @click="signOut">Sign out</Button>
    </div>
  </main>
</template>
