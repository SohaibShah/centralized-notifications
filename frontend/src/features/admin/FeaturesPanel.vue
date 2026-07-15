<script setup lang="ts">
import { onMounted, ref } from "vue";
import { api } from "@/api/client";
import FormRenderer from "@/forms/FormRenderer.vue";
import { featuresForm } from "@/forms/features.form";
import type { FormValues } from "@/forms/types";
import type { FeatureFlags } from "@/stores/settings";

const initial = ref<FormValues>({});
const ready = ref(false);
const saving = ref(false);
const error = ref<string | null>(null);

onMounted(async () => {
  const flags = await api.get<FeatureFlags>("/admin/settings");
  initial.value = { ...flags };
  ready.value = true;
});

async function onSubmit(values: FormValues): Promise<void> {
  saving.value = true;
  error.value = null;
  try {
    await api.patch<void>("/admin/settings", values);
  } catch {
    error.value = "Couldn't save. Try again.";
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <section>
    <h2 class="font-display text-[16px] font-medium text-text">Features</h2>
    <p class="mb-3 mt-0.5 text-[12px] text-muted">Turn platform features on or off for everyone.</p>
    <FormRenderer
      v-if="ready"
      :schema="featuresForm"
      :initial-values="initial"
      :submitting="saving"
      :error="error"
      @submit="onSubmit"
    />
  </section>
</template>
