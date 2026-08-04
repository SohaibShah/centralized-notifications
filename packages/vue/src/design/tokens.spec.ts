import { describe, expect, it } from "vitest";
import { stackLineClass, stackWashClass } from "./tokens";

describe("stack priority → class maps", () => {
  it("colors the inner priority line for critical and high only", () => {
    expect(stackLineClass.critical).toBe("nt-line-critical");
    expect(stackLineClass.high).toBe("nt-line-high");
    // normal/low fall back to the base .nt-prio-line color — no modifier.
    expect(stackLineClass.normal).toBe("");
    expect(stackLineClass.low).toBe("");
  });

  it("washes the row for critical and high only", () => {
    expect(stackWashClass.critical).toBe("nt-wash-critical");
    expect(stackWashClass.high).toBe("nt-wash-high");
    expect(stackWashClass.normal).toBe("");
    expect(stackWashClass.low).toBe("");
  });
});
