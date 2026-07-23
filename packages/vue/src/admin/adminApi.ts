import type { Notification, NotificationPriority } from "@notifications/shared";
import type { Transport } from "../transport/types";

export interface AdminModule {
  key: string;
  label: string;
  enabled: boolean;
  lastSeenAt: string;
  total: number;
  suppressed: number;
  byPriority: Record<NotificationPriority, number>;
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

export interface AdminSettings {
  aiSummaryEnabled: boolean;
  chatbotEnabled: boolean;
  groupingEnabled: boolean;
  actionsEnabled: boolean;
  retentionDays: number;
}
export interface DeleteResult {
  deleted: number;
}

/** The admin/operator API bound to the injected transport (panels build it from `useTransport()`). */
export function createAdminApi(transport: Transport) {
  const fetchModules = () => transport.get<AdminModule[]>("/admin/modules");
  return {
    fetchModules,
    patchModule: (key: string, body: { enabled: boolean }) =>
      transport.patch<void>(`/admin/modules/${encodeURIComponent(key)}`, body),
    /** POST /admin/simulate — the non-prod dev/QA generator endpoint. */
    simulate: (spec: SimulateSpec) => transport.post<SimulateResult>("/admin/simulate", spec),
    /** Discovered module keys, for the custom form's module datalist. */
    fetchModuleKeys: async (): Promise<string[]> => (await fetchModules()).map((m) => m.key),
    getAdminSettings: () => transport.get<AdminSettings>("/admin/settings"),
    patchAdminSettings: (body: Partial<AdminSettings>) =>
      transport.patch<void>("/admin/settings", body),
    deleteAllNotifications: () =>
      transport.post<DeleteResult>("/admin/maintenance/notifications/delete-all"),
    deleteReadNotifications: () =>
      transport.post<DeleteResult>("/admin/maintenance/notifications/delete-read"),
    deleteNotificationsOlderThan: (days: number) =>
      transport.post<DeleteResult>("/admin/maintenance/notifications/delete-older-than", { days }),
    resetModules: () => transport.post<{ updated: number }>("/admin/maintenance/modules/reset"),
    resetSettings: () => transport.post<{ ok: true }>("/admin/maintenance/settings/reset"),
  };
}

export type AdminApi = ReturnType<typeof createAdminApi>;
