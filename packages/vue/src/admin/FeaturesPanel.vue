<script setup lang="ts">
import { onMounted, ref } from "vue";
import Button from "../ui/Button.vue";
import Spinner from "../ui/Spinner.vue";
import StatePanel from "../ui/StatePanel.vue";
import FormRenderer from "../forms/FormRenderer.vue";
import { featuresForm } from "../forms/features.form";
import type { FormValues } from "../forms/types";
import { useSettings, useTransport } from "../provider/context";
import { useUi } from "../theming/useUi";
import type { FeatureFlags } from "../state/settings";

const parts = {
  root: "",
  title: "font-display text-[16px] font-medium text-text",
  description: "mb-3 mt-0.5 text-[12px] text-muted",
} as const;
const props = defineProps<{ ui?: Partial<Record<keyof typeof parts, string>> }>();
const ui = useUi("admin-features", parts, () => props.ui);

const settings = useSettings();
const transport = useTransport();

const initial = ref<FormValues>({});
const status = ref<"loading" | "ready" | "error">("loading");
const saving = ref(false);
const error = ref<string | null>(null);

async function load(): Promise<void> {
  status.value = "loading";
  try {
    const flags = await transport.get<FeatureFlags>("/admin/settings");
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
    await transport.patch<void>("/admin/settings", values);
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
  <section :class="ui('root')">
    <h2 :class="ui('title')">Features</h2>
    <p :class="ui('description')">Turn platform features on or off for everyone.</p>

    <div v-if="status === 'loading'" class="flex justify-center py-10"><Spinner :size="18" /></div>

    <StatePanel
      v-else-if="status === 'error'"
      icon="toggle-right"
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
