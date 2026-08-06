import { describe, expect, it } from "vitest";
import { cn } from "./cn";

describe("cn", () => {
  it("later class wins on a standard conflict", () => {
    expect(cn("rounded-md", "rounded-none")).toBe("rounded-none");
    expect(cn("border", "border-0")).toBe("border-0");
  });

  it("dedupes our CUSTOM color tokens as one group (bg-accent vs bg-black)", () => {
    // Our theme registers custom color names (accent, surface, danger, sunken, …). Default
    // tailwind-merge doesn't know them and would keep BOTH. The configured instance must treat
    // them as the same 'background-color' group so the override wins.
    expect(cn("bg-accent", "bg-black")).toBe("bg-black");
    expect(cn("text-muted", "text-white")).toBe("text-white");
  });

  it("drops falsy inputs and keeps non-conflicting classes", () => {
    expect(cn("px-2", undefined, false && "hidden", "py-1")).toBe("px-2 py-1");
  });
});
