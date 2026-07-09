<script setup lang="ts">
import { ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import FormRenderer from "@/forms/FormRenderer.vue";
import { loginForm } from "@/forms/login.form";
import type { FormValues } from "@/forms/types";
import { ApiError } from "@/api/client";
import { useSessionStore } from "@/stores/session";

const session = useSessionStore();
const router = useRouter();
const route = useRoute();

const submitting = ref(false);
const error = ref<string | null>(null);

async function onSubmit(values: FormValues) {
  submitting.value = true;
  error.value = null;
  try {
    await session.login(String(values.username), String(values.password));
    const redirect = typeof route.query.redirect === "string" ? route.query.redirect : "/";
    await router.replace(redirect);
  } catch (e) {
    error.value =
      e instanceof ApiError && e.status === 401
        ? "That username or password isn't right."
        : "Couldn't sign in. Check your connection and try again.";
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <main class="grid min-h-screen place-items-center bg-bg px-4">
    <div class="w-full max-w-sm">
      <div class="mb-9 flex items-center gap-2.5">
        <span
          class="grid size-7 place-items-center rounded-md bg-accent font-display text-[15px] leading-none text-accent-ink"
          >S</span
        >
        <span class="font-display text-[16px] font-medium tracking-tight">Signals</span>
      </div>

      <h1 class="mb-1 text-[22px]">Sign in</h1>
      <p class="mb-7 text-[13px] text-muted">Access your notification feed.</p>

      <FormRenderer :schema="loginForm" :submitting="submitting" :error="error" @submit="onSubmit" />

      <p class="mt-7 text-[12px] text-faint">Prototype build — sign in with a seeded account.</p>
    </div>
  </main>
</template>
