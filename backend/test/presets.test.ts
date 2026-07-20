import { describe, expect, it } from "vitest";
import { notificationSchema } from "@notifications/shared";
import {
  PRESET_IDS,
  PRESETS,
  buildPreset,
  SAMPLE_ACTIONS,
  sampleActions,
} from "../src/sim/presets";

describe("presets", () => {
  it("every preset builds a body that is contract-valid once an id is attached", () => {
    for (const id of PRESET_IDS) {
      const body = buildPreset(id);
      const parsed = notificationSchema.safeParse({ ...body, id: `t-${id}` });
      expect(
        parsed.success,
        `${id}: ${parsed.success ? "" : JSON.stringify(parsed.error.issues)}`,
      ).toBe(true);
    }
  });

  it("exposes a label + blurb for each preset id", () => {
    for (const id of PRESET_IDS) {
      expect(PRESETS[id].label.length).toBeGreaterThan(0);
      expect(PRESETS[id].blurb.length).toBeGreaterThan(0);
    }
  });

  it("high-access preset carries sample actions; long-body preset has a long description", () => {
    expect(buildPreset("high-access").actions?.length).toBeGreaterThan(0);
    expect(buildPreset("long-body").description.length).toBeGreaterThan(500);
  });

  it("sampleActions slices the canned list to n (0..3)", () => {
    expect(SAMPLE_ACTIONS).toHaveLength(3);
    expect(sampleActions(0)).toHaveLength(0);
    expect(sampleActions(2)).toHaveLength(2);
    expect(sampleActions(3)).toHaveLength(3);
  });

  it("tags sample actions with an explicit kind (dispatch for POST-style actions)", () => {
    const byLabel = Object.fromEntries(SAMPLE_ACTIONS.map((a) => [a.label, a.kind]));
    expect(byLabel["Review"]).toBe("link");
    expect(byLabel["Approve"]).toBe("dispatch");
    expect(byLabel["Dismiss"]).toBe("dispatch");
  });
});
