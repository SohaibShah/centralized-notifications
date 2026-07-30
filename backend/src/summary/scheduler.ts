import { computeDueSummaries } from "@notifications/core";
import type { ScheduleRow } from "./schedule-repo";

export interface SchedulerDeps {
  getSettings: () => Promise<{ aiSummaryEnabled: boolean; summaryTime: string }>;
  listRows: () => Promise<ScheduleRow[]>;
  generate: (row: ScheduleRow) => Promise<void>;
  now?: () => Date;
  onError?: (userKey: string, err: unknown) => void;
}

/** One scheduling pass: skip entirely when disabled; else generate for each due user, isolating
 *  per-user failures so one bad provider call can't abort the batch. */
export async function runSummaryTick(deps: SchedulerDeps): Promise<void> {
  const settings = await deps.getSettings();
  if (!settings.aiSummaryEnabled) return;
  const now = (deps.now ?? (() => new Date()))();
  const rows = await deps.listRows();
  const due = computeDueSummaries({ users: rows, now, summaryTime: settings.summaryTime });
  for (const row of due) {
    try {
      await deps.generate(row);
    } catch (err) {
      (deps.onError ?? ((k, e) => console.error(`[summary-scheduler] ${k} failed`, e)))(
        row.userKey,
        err,
      );
    }
  }
}

const FIFTEEN_MIN = 15 * 60 * 1000;

/**
 * Wrap `runSummaryTick` with a re-entrancy guard + a catch-all. The guard drops any beat that fires
 * while the previous pass is still in flight — otherwise a batch that runs longer than the interval
 * would let the next tick re-select users the running pass hasn't persisted yet and generate them
 * concurrently (a duplicate model call within the same local day). The catch stops a rejecting
 * setup query (`getSettings`/`listRows` both hit Postgres) from escaping as an unhandled rejection
 * that could terminate the process.
 */
export function createGuardedTick(deps: SchedulerDeps): () => Promise<void> {
  let running = false;
  return async () => {
    if (running) return;
    running = true;
    try {
      await runSummaryTick(deps);
    } catch (err) {
      console.error("[summary-scheduler] tick failed", err);
    } finally {
      running = false;
    }
  };
}

/** Start the periodic scheduler (default every 15 min, to honor half-hour tz offsets). Returns a
 *  stop function. The caller wires `generate` to principal reconstruction + service.refreshSummary. */
export function startSummaryScheduler(deps: SchedulerDeps & { intervalMs?: number }): () => void {
  const tick = createGuardedTick(deps);
  const handle = setInterval(() => void tick(), deps.intervalMs ?? FIFTEEN_MIN);
  void tick(); // run once at startup (same-day catch-up)
  return () => clearInterval(handle);
}
