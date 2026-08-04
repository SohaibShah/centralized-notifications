import { describe, expect, it } from "vitest";
import { stackWashClass } from "./tokens";

describe("stack priority → class maps", () => {
  it("washes the row for critical and high only", () => {
    expect(stackWashClass.critical).toBe("nt-wash-critical");
    expect(stackWashClass.high).toBe("nt-wash-high");
    expect(stackWashClass.normal).toBe("");
    expect(stackWashClass.low).toBe("");
  });
});
