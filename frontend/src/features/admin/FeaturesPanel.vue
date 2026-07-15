<script setup lang="ts">
import { onMounted, ref } from "vue";
import { ToggleRight } from "@lucide/vue";
import { api } from "@/api/client";
import Button from "@/components/ui/Button.vue";
import Spinner from "@/components/ui/Spinner.vue";
import StatePanel from "@/components/ui/StatePanel.vue";
import FormRenderer from "@/forms/FormRenderer.vue";
import { featuresForm } from "@/forms/features.form";
import type { FormValues } from "@/forms/types";
import { useSettingsStore, type FeatureFlags } from "@/stores/settings";

const settings = useSettingsStore();

const initial = ref<FormValues>({});
const status = ref<"loading" | "ready" | "error">("loading");
const saving = ref(false);
const error = ref<string | null>(null);

async function load(): Promise<void> {
  status.value = "loading";
  try {
    const flags = await api.get<FeatureFlags>("/admin/settings");
    initial.value = { ...flags };
    status.value = "ready";
  } catch {
    status.value = "error";
  }
}
onMounted(load);

async function onSubmit(values: FormValues): Promise<void> {
  saving.value = true;
  error.value = null;
  try {
    await api.patch<void>("/admin/settings", values);
    // Refresh the app-wide flags so open surfaces (e.g. the bell's AI-summary band)
    // reflect the change immediately, without a page reload.
    await settings.load();
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

    <div v-if="status === 'loading'" class="flex justify-center py-10"><Spinner :size="18" /></div>

    <StatePanel
      v-else-if="status === 'error'"
      :icon="ToggleRight"
      title="Couldn't load settings"
      description="Something went wrong fetching the feature settings."
    >
      <Button variant="secondary" size="sm" @click="load">Try again</Button>
    </StatePanel>

    <FormRenderer
      v-else
      :schema="featuresForm"
      :initial-values="initial"
      :submitting="saving"
      :error="error"
      @submit="onSubmit"
    />
  </section>
</template>
