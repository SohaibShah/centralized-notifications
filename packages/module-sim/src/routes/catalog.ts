import type { FastifyInstance } from "fastify";
import { presetSummaries, type PresetSummary } from "../generate";
import { ALL_MODULES } from "../modules/registry";

export interface CatalogActionDto {
  name: string;
  label: string;
  method: "GET" | "POST";
}

export interface CatalogModuleDto {
  key: string;
  actions: CatalogActionDto[];
}

export interface CatalogResponse {
  modules: CatalogModuleDto[];
  presets: PresetSummary[];
}

/**
 * Registers `GET /catalog` — the read model the control-center page uses so its "Custom"
 * panel only ever offers actions that really exist on a module, instead of hand-maintaining
 * a second copy of the action list in the page's JS. Deliberately projects each
 * `ActionCatalogEntry` down to `{ name, label, method }`: `makeAction` is a function (not
 * JSON-serializable) and is internal to generate.ts/emit.ts, so it must never leak into this
 * response. Also returns the preset SUMMARIES (id, label, and the fields the page uses to
 * prefill the Custom form when a preset is picked) — no server round-trip per preset needed.
 */
export function registerCatalogRoute(app: FastifyInstance): void {
  app.get("/catalog", async (): Promise<CatalogResponse> => {
    const modules: CatalogModuleDto[] = ALL_MODULES.map((mod) => ({
      key: mod.key,
      actions: mod.catalog.map((entry) => ({
        name: entry.name,
        label: entry.label,
        method: entry.method,
      })),
    }));
    return { modules, presets: presetSummaries() };
  });
}
