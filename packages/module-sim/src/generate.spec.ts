import { describe, expect, it } from "vitest";
import { notificationSchema } from "@notifications/shared";
import {
  buildCustom,
  generateBurst,
  generatePreset,
  generateSubjectBurst,
  pickActions,
  PRESET_IDS,
} from "./generate";
import { lookupModule } from "./modules/registry";

const MODULE_KEYS = ["dsr", "access-governance", "data-mapping", "assessments"];

describe("generateSubjectBurst", () => {
  it("emits notifications that all share one #<id> subject token", () => {
    const burst = generateSubjectBurst(4, 123);
    expect(burst).toHaveLength(4);
    const subjects = burst.map((n) => n.title.match(/#\d+/)?.[0]);
    expect(new Set(subjects).size).toBe(1); // one shared subject
    expect(subjects[0]).toBeTruthy();
    for (const n of burst) {
      expect(notificationSchema.safeParse(n).success).toBe(true);
      expect(n.module).toBe("dsr");
    }
  });
});

function expectActionable(notification: ReturnType<typeof buildCustom>): void {
  const parsed = notificationSchema.safeParse(notification);
  expect(parsed.success).toBe(true);
  expect(notification.actions?.length ?? 0).toBeGreaterThan(0);
  const mod = lookupModule(notification.module);
  expect(mod).toBeDefined();
  for (const action of notification.actions ?? []) {
    expect(action.kind).toBe("dispatch");
    if (action.kind === "dispatch") {
      const entry = mod?.catalog.find((c) => {
        const made = c.makeAction();
        return made.kind === "dispatch" && made.path === action.path;
      });
      expect(entry).toBeDefined();
      expect(entry?.method).toBe(action.method);
    }
  }
}

describe("generateBurst", () => {
  it("produces `count` valid, actionable notifications across the four modules", () => {
    const batch = generateBurst(12, 42);
    expect(batch).toHaveLength(12);
    for (const n of batch) {
      expect(MODULE_KEYS).toContain(n.module);
      expectActionable(n);
    }
  });

  it("reproduces the same CONTENT (not id) for the same seed", () => {
    // The seed controls content variety, NOT identity. Two things are excluded from the
    // comparison: `id` (real per-call entropy via randomUUID, so the hub never dedupes two
    // un-seeded bursts against each other — see the "un-seeded bursts never collide" test)
    // and action *metadata* (minted by the module's own makeAction() via Math.random(),
    // independent of generate.ts's rng, matching how a real module mints its own state).
    const a = generateBurst(5, 7);
    const b = generateBurst(5, 7);
    const contentOf = (batch: ReturnType<typeof generateBurst>) =>
      batch.map(({ id, actions, ...rest }) => rest);
    expect(contentOf(a)).toEqual(contentOf(b));
    // ...while the ids differ even for the same seed.
    expect(a.map((n) => n.id)).not.toEqual(b.map((n) => n.id));
  });

  it("never collides on id across un-seeded bursts, even back-to-back", () => {
    // Regression: identity must not derive from the seed/rng. Two un-seeded bursts fired
    // in the same tick previously seeded the rng from the same Date.now() millisecond and
    // produced IDENTICAL ids, which the hub (ON CONFLICT (id) DO NOTHING) would silently
    // drop — while /emit still reported them published.
    const a = generateBurst(20);
    const b = generateBurst(20);
    const idsA = new Set(a.map((n) => n.id));
    const idsB = new Set(b.map((n) => n.id));
    const overlap = [...idsA].filter((id) => idsB.has(id));
    expect(overlap).toEqual([]);
    // And the combined set is fully unique (no intra- or inter-burst dupes).
    expect(new Set([...idsA, ...idsB]).size).toBe(a.length + b.length);
  });

  it("produces unique ids within a burst", () => {
    const batch = generateBurst(30, 99);
    const ids = new Set(batch.map((n) => n.id));
    expect(ids.size).toBe(batch.length);
  });
});

describe("generatePreset", () => {
  it.each(PRESET_IDS)("produces a valid, actionable batch for preset %s", (id) => {
    const batch = generatePreset(id);
    expect(batch.length).toBeGreaterThan(0);
    for (const n of batch) expectActionable(n);
  });
});

describe("buildCustom", () => {
  it("builds one valid, actionable notification from provided fields + catalog action names", () => {
    const n = buildCustom({
      module: "dsr",
      title: "Custom DSR alert",
      description: "A hand-authored scenario for QA.",
      priority: "high",
      actions: ["approve"],
      audience: { scope: "global" },
    });
    expectActionable(n);
    expect(n.title).toBe("Custom DSR alert");
    expect(n.priority).toBe("high");
    expect(n.audience).toEqual({ scope: "global" });
  });

  it("carries the caller-provided audience through onto the notification", () => {
    const n = buildCustom({
      module: "access-governance",
      title: "Team-scoped access alert",
      description: "Only the security team should see this.",
      priority: "high",
      actions: ["revoke"],
      audience: { scope: "team", id: "security" },
    });
    expectActionable(n);
    expect(n.audience).toEqual({ scope: "team", id: "security" });
  });

  it("throws for an action name not in the module's catalog", () => {
    expect(() =>
      buildCustom({
        module: "dsr",
        title: "Bad",
        description: "Bad",
        priority: "low",
        actions: ["not-a-real-action"],
        audience: { scope: "global" },
      }),
    ).toThrow();
  });

  it("throws for an unknown module", () => {
    expect(() =>
      buildCustom({
        module: "not-a-module",
        title: "Bad",
        description: "Bad",
        priority: "low",
        actions: ["approve"],
        audience: { scope: "global" },
      }),
    ).toThrow();
  });

  // Regression: a plain `modules[key]` property lookup would resolve inherited
  // Object.prototype keys ("__proto__", "constructor", "toString") as truthy hits instead of
  // 404ing/erroring as unknown modules. `module` here is untrusted `/emit` request input.
  it.each(["__proto__", "constructor", "toString"])(
    "throws for the prototype-chain key %s instead of treating it as a known module",
    (moduleKey) => {
      expect(() =>
        buildCustom({
          module: moduleKey,
          title: "Bad",
          description: "Bad",
          priority: "low",
          actions: ["approve"],
          audience: { scope: "global" },
        }),
      ).toThrow(`unknown module: "${moduleKey}"`);
    },
  );
});

describe("pickActions", () => {
  const dsr = lookupModule("dsr")!;

  it("resolves known catalog action names to real dispatch actions", () => {
    const actions = pickActions(dsr, ["approve", "reject"]);
    expect(actions).toHaveLength(2);
    for (const a of actions) expect(a.kind).toBe("dispatch");
  });

  // Regression for the defense-in-depth fix: a template naming an action NOT in the module's
  // catalog (i.e. a typo when editing MODULE_TEMPLATES/PRESETS) must throw loudly rather than
  // silently drop the action and ship a schema-valid but non-actionable notification.
  it("throws on a name not in the module's catalog instead of silently dropping it", () => {
    expect(() => pickActions(dsr, ["approve", "definitely-not-an-action"])).toThrow(
      /has no catalog action named "definitely-not-an-action"/,
    );
  });
});
