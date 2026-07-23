import type { ModuleCatalogEntry } from "@notifications/core";

/**
 * The reference app's module catalog, declared as HOST CONFIG (what a third-party consumer would
 * pass to createNotificationService). Formerly the seeded `modules` rows (migration 007); the labels
 * now live here, not in the DB. The library persists only per-module state (enabled/last_seen).
 */
export const REFERENCE_CATALOG: ModuleCatalogEntry[] = [
  { id: "dsr", label: "DSR" },
  { id: "access-governance", label: "Access Governance" },
  { id: "data-mapping", label: "Data Mapping" },
  { id: "assessments", label: "Assessments" },
];
