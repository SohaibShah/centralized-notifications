<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import {
  FormRenderer,
  MuteRulesEditor,
  preferencesForm,
  usePreferences,
  useTransport,
  useFeed,
  type FormSchema,
  type FormValues,
} from "@notifications/vue";
import type { ToastMinPriority } from "@notifications/shared";
import { useSessionStore } from "@/stores/session";

// Host-owned settings page. It composes library pieces: the notification preference form + the
// snooze/mute editor come from @notifications/vue; the timezone (Profile) section is host-owned
// because identity/timezone lives in the host, and it saves to the host's own /me/timezone endpoint.
const transport = useTransport();
const preferences = usePreferences();
const feed = useFeed();
const session = useSessionStore();

const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const currentTz = ref(session.user?.timezone ?? browserTz);

/** The runtime's IANA zone list (falls back to the browser zone + UTC on older runtimes). */
function supportedTimeZones(): string[] {
  const fn = (Intl as { supportedValuesOf?: (key: "timeZone") => string[] }).supportedValuesOf;
  const zones = fn ? fn("timeZone") : [];
  return zones.length ? zones : Array.from(new Set([browserTz, "UTC"]));
}

const timezoneForm = computed<FormSchema>(() => ({
  id: "profile",
  fields: [
    {
      name: "timezone",
      label: "Timezone",
      type: "text",
      group: "Profile",
      placeholder: "e.g. America/New_York",
      hint: "Sets when your daily summary generates and what 'tomorrow morning' means for snoozes.",
      // Datalist suggestions; the server validates the final value against the IANA zone list.
      options: supportedTimeZones().map((z) => ({ value: z, label: z })),
    },
  ],
  submitLabel: "Save timezone",
  submittingLabel: "Saving…",
}));

const modules = ref<{ id: string; label: string }[]>([]);
const categories = computed(() =>
  Array.from(
    new Set(feed.visibleItems.map((n) => n.category).filter((c): c is string => Boolean(c))),
  ).sort(),
);

const savingTz = ref(false);
const savingPrefs = ref(false);
const tzError = ref<string | null>(null);
const prefsError = ref<string | null>(null);

onMounted(async () => {
  await preferences.load();
  currentTz.value = session.user?.timezone ?? browserTz;
  try {
    modules.value = await transport.get<{ id: string; label: string }[]>("/notifications/modules");
  } catch {
    modules.value = [];
  }
});

async function saveTimezone(values: FormValues): Promise<void> {
  savingTz.value = true;
  tzError.value = null;
  try {
    const timezone = String(values.timezone);
    await transport.patch("/me/timezone", { timezone });
    currentTz.value = timezone;
    if (session.user) session.user.timezone = timezone;
  } catch (err) {
    tzError.value = err instanceof Error ? err.message : "Could not save timezone.";
  } finally {
    savingTz.value = false;
  }
}

async function savePreferences(values: FormValues): Promise<void> {
  savingPrefs.value = true;
  prefsError.value = null;
  try {
    await preferences.updatePref({
      toastMinPriority: values.toastMinPriority as ToastMinPriority,
      summaryOptOut: Boolean(values.summaryOptOut),
      groupingEnabled: Boolean(values.groupingEnabled),
    });
  } catch (err) {
    prefsError.value = err instanceof Error ? err.message : "Could not save preferences.";
  } finally {
    savingPrefs.value = false;
  }
}

const timezoneInitial = computed<FormValues>(() => ({ timezone: currentTz.value }));
const preferencesInitial = computed<FormValues>(() => ({
  toastMinPriority: preferences.prefs.toastMinPriority,
  summaryOptOut: preferences.prefs.summaryOptOut,
  groupingEnabled: preferences.prefs.groupingEnabled,
}));
</script>

<template>
  <div class="mx-auto max-w-2xl px-8 py-10">
    <header class="mb-8">
      <h1 class="font-display text-[24px] font-semibold text-text">Settings</h1>
      <p class="mt-1 text-[13px] text-muted">
        Control how notifications reach you — snooze noisy modules, tune your toast, and set your
        timezone.
      </p>
    </header>

    <div class="flex flex-col gap-10">
      <!-- Profile (host-owned): timezone -->
      <section>
        <FormRenderer
          :schema="timezoneForm"
          :initial-values="timezoneInitial"
          :submitting="savingTz"
          :error="tzError"
          @submit="saveTimezone"
        />
      </section>

      <!-- Notification preferences (library) -->
      <section v-if="preferences.loaded">
        <FormRenderer
          :schema="preferencesForm"
          :initial-values="preferencesInitial"
          :submitting="savingPrefs"
          :error="prefsError"
          @submit="savePreferences"
        />
      </section>

      <!-- Snooze & mute (library) -->
      <section>
        <p class="mb-3 font-mono text-[11px] font-semibold uppercase tracking-wide text-faint">
          Snooze &amp; mute
        </p>
        <p class="mb-4 text-[12px] leading-relaxed text-muted">
          Snoozed or muted modules and categories are hidden from your feed. Critical notifications
          always come through.
        </p>
        <MuteRulesEditor :modules="modules" :categories="categories" :timezone="currentTz" />
      </section>
    </div>
  </div>
</template>
