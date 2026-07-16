import { describe, expect, it } from "vitest";
import type { FormSchema } from "./types";
import { buildSchema } from "./validation";

const numberForm: FormSchema = {
  id: "n",
  fields: [{ name: "count", label: "Count", type: "number", required: true }],
};

describe("buildSchema number validation", () => {
  it("rejects a blank required number instead of coercing it to 0", () => {
    expect(buildSchema(numberForm).safeParse({ count: "" }).success).toBe(false);
  });

  it("accepts a provided required number (coerced from string)", () => {
    const parsed = buildSchema(numberForm).safeParse({ count: "5" });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.count).toBe(5);
  });
});
