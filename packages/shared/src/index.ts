/**
 * @notifications/shared
 *
 * The ONE package that both the frontend and the backend depend on. Keeping this
 * as the sole cross-boundary coupling is what lets the two apps be split into
 * separate repos/services later (publish this package to a registry and pin it).
 */

export * from "./notification";

/** Scaffolding marker retained so the placeholder app entrypoints can prove the
 *  workspace link resolves.
 *  TODO(scaffold): remove together with the placeholder backend/frontend
 *  entrypoints (backend/src/server.ts, frontend/src/main.ts) — don't let it leak
 *  into the published package surface. */
export const SHARED_PACKAGE = "@notifications/shared" as const;
