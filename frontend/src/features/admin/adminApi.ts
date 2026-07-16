import { api } from "@/api/client";
import type { Notification, NotificationPriority } from "@notifications/shared";

export interface AdminModule {
  key: string;
  label: string;
  enabled: boolean;
  lastSeenAt: string;
  total: number;
  suppressed: number;
  byPriority: Record<NotificationPriority, number>;
}

export function fetchModules(): Promise<AdminModule[]> {
  return api.get<AdminModule[]>("/admin/modules");
}

export function patchModule(
  key: string,
  body: { enabled?: boolean; label?: string },
): Promise<void> {
  return api.patch<void>(`/admin/modules/${encodeURIComponent(key)}`, body);
}

export interface CustomSpec {
  mode: "custom";
  notification: Omit<Notification, "id">;
  sampleActions?: number;
}
export interface PresetSpec {
  mode: "preset";
  preset: string;
}
export interface BurstSpec {
  mode: "burst";
  count: number;
  seed?: number;
}
export type SimulateSpec = CustomSpec | PresetSpec | BurstSpec;

export interface SimulateResult {
  published: number;
  suppressed: number;
}

/** POST /admin/simulate — the non-prod dev/QA generator endpoint. */
export function simulate(spec: SimulateSpec): Promise<SimulateResult> {
  return api.post<SimulateResult>("/admin/simulate", spec);
}

/** Discovered module keys, for the custom form's module datalist. */
export async function fetchModuleKeys(): Promise<string[]> {
  return (await fetchModules()).map((m) => m.key);
}
