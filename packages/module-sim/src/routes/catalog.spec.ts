import { describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { PRESET_IDS } from "../generate";
import { lookupModule } from "../modules/registry";

const cfg = {
  hubUrl: "http://localhost:3000",
  intakeToken: "intake-token-abcdefgh",
  dispatchToken: "d",
  port: 4000,
};

interface CatalogActionShape {
  name: string;
  label: string;
  method: string;
}
interface CatalogModuleShape {
  key: string;
  actions: CatalogActionShape[];
}
interface PresetSummaryShape {
  id: string;
  label: string;
  module: string;
  title: string;
  description: string;
  priority: string;
  category?: string;
  actionNames: string[];
  audienceScope: string;
}

describe("GET /catalog", () => {
  it("lists every registered module's actions (no makeAction fns)", async () => {
    const app = buildApp(cfg);
    const res = await app.inject({ method: "GET", url: "/catalog" });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/json");

    const body = res.json() as { modules: CatalogModuleShape[]; presets: PresetSummaryShape[] };

    const keys = body.modules.map((m) => m.key);
    expect(keys).toEqual(
      expect.arrayContaining(["dsr", "access-governance", "data-mapping", "assessments"]),
    );

    const dsr = body.modules.find((m) => m.key === "dsr");
    expect(dsr).toBeDefined();
    expect(dsr?.actions).toEqual(
      expect.arrayContaining([{ name: "approve", label: "Approve", method: "POST" }]),
    );

    // The catalog's makeAction functions are internal-only and must never leak into the
    // JSON response (they aren't serializable and aren't needed by the UI).
    for (const mod of body.modules) {
      for (const action of mod.actions) {
        expect(action).not.toHaveProperty("makeAction");
        expect(Object.keys(action).sort()).toEqual(["label", "method", "name"]);
      }
    }
  });

  it("returns preset summaries (in PRESET_IDS order) the page can prefill the Custom form from", async () => {
    const app = buildApp(cfg);
    const res = await app.inject({ method: "GET", url: "/catalog" });
    const body = res.json() as { modules: CatalogModuleShape[]; presets: PresetSummaryShape[] };

    // One summary per preset id, in the declared order.
    expect(body.presets.map((p) => p.id)).toEqual([...PRESET_IDS]);

    for (const preset of body.presets) {
      // A prefill-able summary carries everything the Custom form needs.
      expect(preset.label.length).toBeGreaterThan(0);
      expect(preset.title.length).toBeGreaterThan(0);
      expect(["low", "normal", "high", "critical"]).toContain(preset.priority);
      expect(preset.audienceScope).toBe("global");

      // Every action a preset names must exist in its module's real catalog — so prefilling
      // the Custom form always checks boxes that resolve to real dispatch actions.
      const mod = lookupModule(preset.module);
      expect(mod).toBeDefined();
      const catalogNames = (mod?.catalog ?? []).map((c) => c.name);
      expect(preset.actionNames.length).toBeGreaterThan(0);
      for (const name of preset.actionNames) expect(catalogNames).toContain(name);
    }
  });
});
