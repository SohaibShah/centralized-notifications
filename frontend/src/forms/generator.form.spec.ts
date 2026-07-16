import { describe, expect, it } from "vitest";
import { generatorForm, toCustomSpec } from "./generator.form";

describe("generatorForm", () => {
  it("offers discovered modules as datalist options on the module field", () => {
    const module = generatorForm(["dsr", "assessments"]).fields.find((f) => f.name === "module");
    expect(module?.options?.map((o) => o.value)).toEqual(["dsr", "assessments"]);
  });
});

describe("toCustomSpec", () => {
  it("maps flat form values into the nested custom spec, global audience without id", () => {
    const spec = toCustomSpec({
      module: "dsr",
      title: "Hi",
      description: "",
      priority: "high",
      snoozable: true,
      category: "",
      audienceScope: "global",
      audienceId: "",
      sampleActions: 0,
    });
    expect(spec).toEqual({
      mode: "custom",
      notification: {
        module: "dsr",
        title: "Hi",
        description: "",
        priority: "high",
        snoozable: true,
        audience: { scope: "global" },
      },
    });
  });

  it("includes audience.id for non-global scope, category when set, and sampleActions when > 0", () => {
    const spec = toCustomSpec({
      module: "dsr",
      title: "Hi",
      description: "body",
      priority: "low",
      snoozable: false,
      category: "sla",
      audienceScope: "team",
      audienceId: "privacy-ops",
      sampleActions: 2,
    });
    expect(spec.notification.audience).toEqual({ scope: "team", id: "privacy-ops" });
    expect(spec.notification.category).toBe("sla");
    expect(spec.sampleActions).toBe(2);
  });
});
