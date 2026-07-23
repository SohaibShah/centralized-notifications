import { ref } from "vue";
import { defineStore } from "pinia";
import { api, ApiError } from "@/api/client";

interface SummaryResponse {
  summary: string;
  basedOn: number;
}

/**
 * The AI triage summary for the current user's unread set. Fetched lazily on the first disclosure
 * expand; the server caches by the unread signature, so re-fetches are cheap. States: idle → loading
 * → ready | error.
 */
export const useSummaryStore = defineStore("summary", () => {
  const status = ref<"idle" | "loading" | "ready" | "error">("idle");
  const text = ref("");
  const error = ref<string | null>(null);

  async function fetchSummary(force = false): Promise<void> {
    if (!force && (status.value === "loading" || status.value === "ready")) return;
    status.value = "loading";
    error.value = null;
    try {
      const res = await api.get<SummaryResponse>("/notifications/summary");
      text.value = res.summary;
      status.value = "ready";
    } catch (err) {
      error.value = err instanceof ApiError ? err.message : "Couldn't generate a summary";
      status.value = "error";
    }
  }

  function reset(): void {
    status.value = "idle";
    text.value = "";
    error.value = null;
  }

  return { status, text, error, fetchSummary, reset };
});
