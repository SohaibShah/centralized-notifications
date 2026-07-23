import { describe, expect, it } from "vitest";
import { createPanelState } from "./panel";

describe("panel state", () => {
  it("opens, closes, and toggles", () => {
    const p = createPanelState();
    expect(p.isOpen).toBe(false);
    p.open();
    expect(p.isOpen).toBe(true);
    p.close();
    expect(p.isOpen).toBe(false);
    p.toggle();
    expect(p.isOpen).toBe(true);
  });
});
