import { describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { PRESET_IDS } from "../generate";

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

describe("GET /catalog", () => {
  it("lists every registered module's actions (no makeAction fns) plus the preset ids", async () => {
    const app = buildApp(cfg);
    const res = await app.inject({ method: "GET", url: "/catalog" });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/json");

    const body = res.json() as { modules: CatalogModuleShape[]; presets: string[] };

    expect(body.presets).toEqual([...PRESET_IDS]);

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
});
