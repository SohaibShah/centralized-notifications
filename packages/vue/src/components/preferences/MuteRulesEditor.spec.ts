import { beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { mount } from "@vue/test-utils";
import MuteRulesEditor from "./MuteRulesEditor.vue";
import { NOTIFICATIONS_KEY, type NotificationsContext } from "../../provider/context";
import { buildTestContext } from "../../test/provider-harness";

describe("MuteRulesEditor", () => {
  let ctx: NotificationsContext;

  beforeEach(() => {
    ctx = buildTestContext();
    vi.spyOn(ctx.preferences, "setMute").mockResolvedValue();
    vi.spyOn(ctx.preferences, "clearMute").mockResolvedValue();
  });

  const zero = { critical: 0, high: 0, normal: 0, low: 0 };
  const mountEditor = () =>
    mount(MuteRulesEditor, {
      props: {
        modules: [{ id: "dsr", label: "DSR", byPriority: { ...zero, high: 2 }, total: 2 }],
        categories: [{ name: "marketing", byPriority: { ...zero }, total: 0 }],
        timezone: "UTC",
      },
      global: { provide: { [NOTIFICATIONS_KEY]: ctx } },
    });

  it("renders a row per module and category", () => {
    const w = mountEditor();
    const rows = w.findAll('[data-test="mute-row"]');
    expect(rows.map((r) => r.attributes("data-target"))).toEqual([
      "module:dsr",
      "category:marketing",
    ]);
  });

  it("shows the per-target priority mix", () => {
    const w = mountEditor();
    const mix = w.get('[data-target="module:dsr"] [data-test="mute-mix"]');
    expect(mix.text()).toContain("2 high");
  });

  it("shows Active by default, then Muted once a rule exists", async () => {
    const w = mountEditor();
    const row = () => w.get('[data-target="module:dsr"]');
    expect(row().get('[data-test="mute-status"]').text()).toBe("Active");

    ctx.preferences.rules.push({ targetKind: "module", target: "dsr", mutedUntil: null });
    await nextTick();
    expect(row().get('[data-test="mute-status"]').text()).toBe("Muted");
    expect(row().get('[data-test="mute-toggle"]').text()).toContain("Muted");
  });

  it("Mute calls setMute with a null until (indefinite)", async () => {
    const w = mountEditor();
    await w.get('[data-target="module:dsr"] [data-test="mute-toggle"]').trigger("click");
    expect(ctx.preferences.setMute).toHaveBeenCalledWith("module", "dsr", null);
  });

  it("a snooze option calls setMute with a future ISO instant", async () => {
    const w = mountEditor();
    const opt = w
      .get('[data-target="category:marketing"]')
      .findAll('[data-test="snooze-option"]')
      .find((b) => b.attributes("data-value") === "1h");
    await opt!.trigger("click");
    expect(ctx.preferences.setMute).toHaveBeenCalledTimes(1);
    const [kind, target, until] = (ctx.preferences.setMute as ReturnType<typeof vi.fn>).mock
      .calls[0]!;
    expect([kind, target]).toEqual(["category", "marketing"]);
    expect(new Date(until as string).getTime()).toBeGreaterThan(Date.now());
  });

  it("Resume clears an active rule", async () => {
    ctx.preferences.rules.push({ targetKind: "module", target: "dsr", mutedUntil: null });
    const w = mountEditor();
    await w.get('[data-target="module:dsr"] [data-test="mute-clear"]').trigger("click");
    expect(ctx.preferences.clearMute).toHaveBeenCalledWith("module", "dsr");
  });
});
