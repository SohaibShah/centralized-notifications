import { createNotificationService, type NotificationService } from "@notifications/core";
import { getPool } from "../db/pool";
import { REFERENCE_CATALOG } from "./catalog";

/**
 * Build the notification service the way any host would: inject our pg pool + our module catalog.
 * The caller must `await service.ready()` once before serving (reconciles module state rows).
 */
export function createReferenceService(): NotificationService {
  return createNotificationService({
    pool: getPool(),
    config: { modules: REFERENCE_CATALOG, adminRole: "admin" },
  });
}
