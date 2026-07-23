import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import type { ChatSource } from "@notifications/shared";
import MarkdownMessage from "./MarkdownMessage";

// CitationChip (rendered for known refs) reads useActions; stub the provider accessor.
vi.mock("../../provider/context", () => ({ useActions: () => ({ runAction: vi.fn() }) }));

function source(ref: string, title: string): ChatSource {
  return { ref, id: ref, title, priority: "high", ageMinutes: 5, actions: [] };
}

describe("MarkdownMessage", () => {
  it("renders markdown formatting: bold, a bulleted list, and inline code", () => {
    const w = mount(MarkdownMessage, {
      props: { text: "Here is **urgent** work:\n\n- item one\n- run `scan`" },
    });
    expect(w.find("strong").text()).toBe("urgent");
    expect(w.findAll("ul li")).toHaveLength(2);
    expect(w.find("code").text()).toBe("scan");
  });

  it("renders a known [n#] citation inside prose as a chip; unknown refs stay literal text", () => {
    const w = mount(MarkdownMessage, {
      props: {
        text: "The **Acme DSAR** [n1] is overdue; [n9] is unknown.",
        sources: { n1: source("n1", "Acme DSAR") },
      },
    });
    const chips = w.findAll('[data-test="chip-toggle"]');
    expect(chips).toHaveLength(1);
    expect(chips[0]!.text()).toContain("Acme DSAR");
    expect(w.text()).toContain("[n9]");
    // The citation lives inside the rendered paragraph, not as a detached node.
    expect(w.find("p").findAll('[data-test="chip-toggle"]')).toHaveLength(1);
  });

  it("splits a grouped [n1, n2] citation into one chip per known ref", () => {
    const w = mount(MarkdownMessage, {
      props: {
        text: "Both [n1, n2] need attention.",
        sources: { n1: source("n1", "Acme DSAR"), n2: source("n2", "Beta scan") },
      },
    });
    expect(w.findAll('[data-test="chip-toggle"]')).toHaveLength(2);
    expect(w.text()).not.toContain("[n1, n2]");
  });

  it("never injects raw HTML from model output (no v-html)", () => {
    const w = mount(MarkdownMessage, {
      props: { text: "hi <img src=x onerror=alert(1)> <b>not bold</b>" },
    });
    // The angle-bracket content is rendered as text, not as elements.
    expect(w.find("img").exists()).toBe(false);
    expect(w.find("b").exists()).toBe(false);
    expect(w.text()).toContain("<img");
  });

  it("drops an unsafe link href but keeps its text", () => {
    const w = mount(MarkdownMessage, {
      props: { text: "[click](javascript:alert(1)) and [ok](https://example.com)" },
    });
    const links = w.findAll("a");
    expect(links).toHaveLength(1); // only the https link becomes an anchor
    expect(links[0]!.attributes("href")).toBe("https://example.com");
    expect(w.text()).toContain("click"); // unsafe link's text survives as plain text
  });
});
