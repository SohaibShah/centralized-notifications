import { api } from "@/api/client";
import type { NotificationPriority } from "@notifications/shared";

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
