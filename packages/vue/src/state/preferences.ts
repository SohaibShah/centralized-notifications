import { reactive, ref } from "vue";
import type {
  MuteRule,
  MuteTargetKind,
  PreferencesResponse,
  UserPreferences,
} from "@notifications/shared";
import type { Transport } from "../transport/types";

const DEFAULTS: UserPreferences = {
  groupingEnabled: true,
  summaryOptOut: false,
  toastMinPriority: "critical",
};

/**
 * Per-user preferences + snooze/mute rules for the settings page. Loaded once from
 * GET /notifications/preferences; every mutation is optimistic (the UI updates immediately) and rolls
 * back to the prior value if the server rejects, re-throwing so the caller can surface the error.
 *
 * `onRulesChanged` fires AFTER a mute/snooze write is persisted server-side (not on the optimistic
 * update) — the provider wires it to refetch the feed so the change takes effect with no page reload.
 */
export function createPreferencesState(deps: {
  transport: Transport;
  onRulesChanged?: () => void;
}) {
  const prefs = reactive<UserPreferences>({ ...DEFAULTS });
  const rules = ref<MuteRule[]>([]);
  const loaded = ref(false);

  function applyPrefs(next: UserPreferences): void {
    prefs.groupingEnabled = next.groupingEnabled;
    prefs.summaryOptOut = next.summaryOptOut;
    prefs.toastMinPriority = next.toastMinPriority;
  }

  async function load(): Promise<void> {
    const data = await deps.transport.get<PreferencesResponse>("/notifications/preferences");
    applyPrefs(data);
    rules.value = data.rules;
    loaded.value = true;
  }

  /** Optimistically update scalar preferences; roll back and re-throw on failure. */
  async function updatePref(patch: Partial<UserPreferences>): Promise<void> {
    const snapshot: UserPreferences = { ...prefs };
    applyPrefs({ ...snapshot, ...patch });
    try {
      const merged = await deps.transport.patch<UserPreferences>(
        "/notifications/preferences",
        patch,
      );
      applyPrefs(merged);
    } catch (err) {
      applyPrefs(snapshot);
      throw err;
    }
  }

  const rulePath = (kind: MuteTargetKind, target: string): string =>
    `/notifications/mutes/${kind}/${encodeURIComponent(target)}`;

  function upsertLocal(rule: MuteRule): void {
    const rest = rules.value.filter(
      (r) => !(r.targetKind === rule.targetKind && r.target === rule.target),
    );
    rules.value = [...rest, rule].sort(
      (a, b) => a.targetKind.localeCompare(b.targetKind) || a.target.localeCompare(b.target),
    );
  }

  /** Snooze (`until` = ISO) or mute (`until` = null) a module/category. Optimistic + rollback. */
  async function setMute(
    kind: MuteTargetKind,
    target: string,
    until: string | null,
  ): Promise<void> {
    const snapshot = rules.value;
    upsertLocal({ targetKind: kind, target, mutedUntil: until });
    try {
      await deps.transport.post(rulePath(kind, target), { until });
    } catch (err) {
      rules.value = snapshot;
      throw err;
    }
    deps.onRulesChanged?.(); // rule is now persisted — safe to refetch the feed against it
  }

  /** Remove a snooze/mute rule. Optimistic + rollback. */
  async function clearMute(kind: MuteTargetKind, target: string): Promise<void> {
    const snapshot = rules.value;
    rules.value = rules.value.filter((r) => !(r.targetKind === kind && r.target === target));
    try {
      await deps.transport.del(rulePath(kind, target));
    } catch (err) {
      rules.value = snapshot;
      throw err;
    }
    deps.onRulesChanged?.();
  }

  return reactive({ prefs, rules, loaded, load, updatePref, setMute, clearMute });
}

export type PreferencesState = ReturnType<typeof createPreferencesState>;
