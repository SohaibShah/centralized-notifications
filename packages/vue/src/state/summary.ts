import { reactive, ref } from "vue";
import { ApiError } from "../transport/cookie-transport";
import type { Transport } from "../transport/types";

interface StoredSummaryResponse {
  optedOut?: boolean;
  summary: string | null;
  basedOn: number;
  generatedAt: string | null;
}

/**
 * The current user's persisted AI summary. Read on panel open via `fetchStored`; regenerated on
 * demand via `refresh` (the reload button), which updates the shared stored summary + timestamp
 * server-side. States: idle → loading → ready | empty | opted-out | error; `refreshing` drives the
 * reload button.
 */
export function createSummaryState(deps: { transport: Transport }) {
  const status = ref<"idle" | "loading" | "ready" | "empty" | "opted-out" | "error">("idle");
  const summary = ref("");
  const basedOn = ref(0);
  const generatedAt = ref<string | null>(null);
  const refreshing = ref(false);
  const error = ref<string | null>(null);

  function apply(res: StoredSummaryResponse): void {
    if (res.optedOut) {
      status.value = "opted-out";
      summary.value = "";
      basedOn.value = 0;
      generatedAt.value = null;
      return;
    }
    if (!res.generatedAt) {
      status.value = "empty";
      summary.value = "";
      basedOn.value = 0;
      generatedAt.value = null;
      return;
    }
    summary.value = res.summary ?? "";
    basedOn.value = res.basedOn;
    generatedAt.value = res.generatedAt;
    status.value = "ready";
  }

  async function fetchStored(): Promise<void> {
    if (status.value === "loading") return;
    status.value = "loading";
    error.value = null;
    try {
      apply(await deps.transport.get<StoredSummaryResponse>("/notifications/summary"));
    } catch (err) {
      error.value = err instanceof ApiError ? err.message : "Couldn't load the summary";
      status.value = "error";
    }
  }

  async function refresh(): Promise<void> {
    if (refreshing.value) return;
    refreshing.value = true;
    error.value = null;
    try {
      apply(await deps.transport.post<StoredSummaryResponse>("/notifications/summary/refresh", {}));
    } catch (err) {
      error.value = err instanceof ApiError ? err.message : "Couldn't refresh the summary";
      if (status.value !== "ready") status.value = "error";
    } finally {
      refreshing.value = false;
    }
  }

  return reactive({
    status,
    summary,
    basedOn,
    generatedAt,
    refreshing,
    error,
    fetchStored,
    refresh,
  });
}

export type SummaryState = ReturnType<typeof createSummaryState>;
