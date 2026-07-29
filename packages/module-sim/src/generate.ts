import { randomUUID } from "node:crypto";
import {
  AUDIENCE_SCOPES,
  notificationSchema,
  type Audience,
  type AudienceScope,
  type Notification,
  type NotificationAction,
  type NotificationPriority,
} from "@notifications/shared";
import { ALL_MODULES, lookupModule } from "./modules/registry";
import type { ActionCatalogEntry, SimModule } from "./modules/types";

/**
 * Notification generation for module-sim's own `/emit` API (Task 12) — ported from
 * `backend/src/sim/simulator.ts` + `backend/src/sim/presets.ts`, but ADAPTED so every
 * generated notification carries real dispatch actions built from its module's action
 * `catalog` (Task 11), never the old pre-union `SAMPLE_ACTIONS` (which used a flat `url`
 * shape now invalid against `actionSchema`'s `link`/`dispatch` discriminated union).
 *
 * Every notification built here is self-validated against `notificationSchema` before
 * being returned (see `validate()`) — this module never hands the route a shape it
 * hasn't already confirmed is publish-contract-valid.
 */

// Slugs that match the seeded identity (backend/src/auth/seed.ts) so role/team audiences
// can actually resolve to members once audience resolution is wired up here too.
const TEAMS = ["privacy-ops", "security"];
const ROLES = ["privacy-analyst", "security-reviewer", "access-approver", "admin"];

interface BurstTemplate {
  priority: NotificationPriority;
  snoozable: boolean;
  title: string;
  category?: string;
  describe: (rng: () => number) => string;
  /** Action names (from the module's catalog) to attach — 1-2 per notification. */
  actionNames: string[];
}

// One burst scenario per known module. Every entry names catalog actions that module
// actually exposes (see packages/module-sim/src/modules/*.ts) — buildActions() below
// resolves them via `makeAction()`, so the emitted action shape is always the real one.
const MODULE_TEMPLATES: Record<string, BurstTemplate[]> = {
  dsr: [
    {
      priority: "critical",
      snoozable: true,
      category: "sla",
      title: "DSR approaching SLA breach",
      describe: () => "A data-subject request is close to its deadline.",
      actionNames: ["approve", "reject"],
    },
  ],
  "access-governance": [
    {
      priority: "high",
      snoozable: false,
      category: "approvals",
      title: "Access request awaiting your approval",
      describe: () => "A user requested elevated access to a data catalog.",
      actionNames: ["revoke"],
    },
  ],
  "data-mapping": [
    {
      priority: "normal",
      snoozable: true,
      title: "Sensitive data found in new data stores",
      describe: (rng) =>
        `The latest scan classified sensitive data in ${1 + Math.floor(rng() * 5)} stores.`,
      actionNames: ["rescan"],
    },
  ],
  assessments: [
    {
      priority: "low",
      snoozable: true,
      category: "reminders",
      title: "Assessments due this week",
      describe: (rng) =>
        `${1 + Math.floor(rng() * 6)} assessments assigned to you are still in draft.`,
      actionNames: ["snooze"],
    },
  ],
};

function catalogByName(mod: SimModule): Map<string, ActionCatalogEntry> {
  return new Map(mod.catalog.map((entry) => [entry.name, entry] as const));
}

/** Resolves catalog action names to real `NotificationAction`s via `makeAction()`. Throws if any
 * name isn't in the module's catalog — burst/preset templates are internal and should only ever
 * name real actions (see `MODULE_TEMPLATES`/`PRESETS` below), so an unresolvable name here means
 * a template was edited with a typo, not a shape to silently degrade: without this guard a typo'd
 * template would ship a schema-valid but non-actionable notification instead of failing loudly.
 * Exported only so the throw-on-typo behavior can be exercised directly in tests — the built-in
 * templates are all valid, so no `generateBurst`/`generatePreset` call ever reaches the throw. */
export function pickActions(mod: SimModule, names: string[]): NotificationAction[] {
  const byName = catalogByName(mod);
  return names.map((name) => {
    const entry = byName.get(name);
    if (!entry) {
      throw new Error(
        `module "${mod.key}" has no catalog action named "${name}" (internal template bug)`,
      );
    }
    return entry.makeAction();
  });
}

function buildAudience(scope: AudienceScope, rng: () => number): Audience {
  switch (scope) {
    case "team":
      return { scope: "team", id: pick(rng, TEAMS) };
    case "role":
      return { scope: "role", id: pick(rng, ROLES) };
    case "user":
      return { scope: "user", id: `user-${shortId(rng)}` };
    case "global":
    default:
      return { scope: "global" };
  }
}

/** Small, fast, seedable PRNG (mulberry32) — deterministic given a seed, ported unchanged
 * from backend/src/sim/simulator.ts. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, items: readonly T[]): T {
  if (items.length === 0) throw new Error("pick() called with an empty list");
  return items[Math.floor(rng() * items.length)]!;
}

function shortId(rng: () => number): string {
  return Math.floor(rng() * 1e9).toString(36);
}

/** Self-validates a built notification against the publish contract; throws rather than
 * ever handing the route (and, downstream, the hub) a shape that wouldn't parse anyway. */
function validate(candidate: Notification): Notification {
  const result = notificationSchema.safeParse(candidate);
  if (!result.success) {
    throw new Error(
      `generated notification failed notificationSchema validation: ${JSON.stringify(result.error.issues)}`,
    );
  }
  return result.data;
}

/**
 * Generates `count` actionable notifications spread across the four registered modules.
 * `seed` controls CONTENT variety only (which module/template/audience each item gets) —
 * deterministic given a seed (mulberry32, the same PRNG as the old backend simulator),
 * varied otherwise. It deliberately does NOT control the notification `id`: the hub dedupes
 * purely on `id` (`ON CONFLICT (id) DO NOTHING`), so if identity were seed-derived, two
 * un-seeded bursts fired within the same millisecond — this is a rapid-fire load-gen tool —
 * would mint colliding ids and the hub would silently drop the second batch while `/emit`
 * still reported it as published. So every id folds in real per-call entropy
 * (`crypto.randomUUID()`), guaranteeing uniqueness regardless of seed, timing, or concurrency.
 * Every item carries at least one `kind: "dispatch"` action drawn from its module's real catalog.
 */
export function generateBurst(count: number, seed?: number): Notification[] {
  const rng = mulberry32((seed ?? Date.now()) >>> 0);
  const batch: Notification[] = [];

  for (let i = 0; i < count; i++) {
    const mod = pick(rng, ALL_MODULES);
    const templates = MODULE_TEMPLATES[mod.key] ?? [];
    if (templates.length === 0) {
      // Every registered module has a template above; this only trips if a fifth module is
      // added to the registry without a matching entry here.
      throw new Error(`no burst template registered for module "${mod.key}"`);
    }
    const template = pick(rng, templates);
    // Round-robin the scope so every scope is represented once count >= 4.
    const scope = AUDIENCE_SCOPES[i % AUDIENCE_SCOPES.length]!;

    const notification: Notification = {
      // `randomUUID()` is real per-call entropy, NOT the seeded rng — see the function-level
      // note above on why identity must be decoupled from the seed (the hub dedupes on id).
      id: `${mod.key}-${i}-${randomUUID()}`,
      module: mod.key,
      title: template.title,
      description: template.describe(rng),
      priority: template.priority,
      snoozable: template.snoozable,
      audience: buildAudience(scope, rng),
      ...(template.category ? { category: template.category } : {}),
      actions: pickActions(mod, template.actionNames),
    };
    batch.push(validate(notification));
  }
  return batch;
}

interface PresetDef {
  module: string;
  title: string;
  description: string;
  priority: NotificationPriority;
  snoozable: boolean;
  category?: string;
  actionNames: string[];
}

export const PRESET_IDS = [
  "critical-dsr",
  "high-access-approval",
  "normal-data-mapping-scan",
  "low-assessment-reminder",
] as const;

export type PresetId = (typeof PRESET_IDS)[number];

/** Named, deterministic per-module scenarios for the dev/QA "one-click" generator — no RNG,
 * so a preset always produces the same body (module-sim's replacement for the old admin
 * generator's `backend/src/sim/presets.ts`). */
const PRESETS: Record<PresetId, PresetDef> = {
  "critical-dsr": {
    module: "dsr",
    title: "DSR approaching SLA breach",
    description: "A data-subject request is within 24 hours of its statutory deadline.",
    priority: "critical",
    snoozable: true,
    category: "sla",
    actionNames: ["approve", "reject"],
  },
  "high-access-approval": {
    module: "access-governance",
    title: "Access request awaiting your approval",
    description: "A user requested elevated access to a data catalog.",
    priority: "high",
    snoozable: false,
    category: "approvals",
    actionNames: ["revoke"],
  },
  "normal-data-mapping-scan": {
    module: "data-mapping",
    title: "Sensitive data found in new data stores",
    description: "The latest scan classified sensitive data in 3 stores.",
    priority: "normal",
    snoozable: true,
    actionNames: ["rescan"],
  },
  "low-assessment-reminder": {
    module: "assessments",
    title: "Assessments due this week",
    description: "4 assessments assigned to you are still in draft.",
    priority: "low",
    snoozable: true,
    category: "reminders",
    actionNames: ["snooze"],
  },
};

/** Builds the named preset's scenario as a one-item, actionable, contract-valid batch. */
export function generatePreset(id: PresetId): Notification[] {
  const def = PRESETS[id];
  const mod = lookupModule(def.module);
  if (!mod) throw new Error(`preset "${id}" references unknown module "${def.module}"`);

  const notification: Notification = {
    // Real per-call entropy (see generateBurst's note): a preset is deterministic in CONTENT
    // but must get a fresh id each emit so repeated one-clicks aren't deduped away by the hub.
    id: `preset-${id}-${randomUUID()}`,
    module: def.module,
    title: def.title,
    description: def.description,
    priority: def.priority,
    snoozable: def.snoozable,
    audience: { scope: "global" },
    ...(def.category ? { category: def.category } : {}),
    actions: pickActions(mod, def.actionNames),
  };
  return [validate(notification)];
}

export interface CustomInput {
  module: string;
  title: string;
  description: string;
  priority: NotificationPriority;
  /** Action names, resolved against `module`'s catalog. At least one is required — every
   * emitted notification must be actionable (see the emit route's zod body, which enforces
   * `.min(1)`). */
  actions: string[];
  /** Who the notification targets. Restores the audience picker the old admin generator's
   * custom form had (`global` / `team` / `role` / `user`) so dev/QA can emit to a specific
   * audience, not just everyone. Already validated against `audienceSchema` at the emit boundary. */
  audience: Audience;
}

/** Builds one notification from caller-supplied fields + dispatch actions chosen from that
 * module's catalog by name. The module/action-name lookups (shared with `pickActions` via
 * `catalogByName`) already throw on an unresolvable name; here that's expected and desired,
 * since this input comes straight from the `/emit` request body — a typo must surface as a
 * 400, not silently emit a notification with fewer actions than the caller asked for. */
export function buildCustom(input: CustomInput): Notification {
  const mod = lookupModule(input.module);
  if (!mod) throw new Error(`unknown module: "${input.module}"`);

  const byName = catalogByName(mod);
  const actions: NotificationAction[] = input.actions.map((name) => {
    const entry = byName.get(name);
    if (!entry) throw new Error(`module "${input.module}" has no catalog action named "${name}"`);
    return entry.makeAction();
  });

  const notification: Notification = {
    id: `custom-${randomUUID()}`,
    module: input.module,
    title: input.title,
    description: input.description,
    priority: input.priority,
    snoozable: true,
    audience: input.audience,
    actions,
  };
  return validate(notification);
}
