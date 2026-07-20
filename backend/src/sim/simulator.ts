import {
  AUDIENCE_SCOPES,
  type Audience,
  type AudienceScope,
  type Notification,
  type NotificationAction,
  type NotificationPriority,
} from "@notifications/shared";

/**
 * Module simulator (FR-2). Produces contract-valid notifications across varied
 * modules, priorities, and audience scopes so the pipeline can be exercised
 * before real modules exist. Pure and (with a `seed`) deterministic — no DB, no
 * network. In Task 5 the intake path drives this to persist + fan out; production
 * replaces it with real modules publishing against the same contract.
 */
export interface SimulateOptions {
  /** How many notifications to generate (default 10). */
  count?: number;
  /** Restrict to these module names (default: the built-in demo modules). */
  modules?: string[];
  /** Seed the PRNG for reproducible output (default: time-based, i.e. random). */
  seed?: number;
}

// Slugs that match the seeded identity (backend/src/auth/seed.ts) so role/team
// audiences can actually resolve to members once audience resolution lands.
const TEAMS = ["privacy-ops", "security"];
const ROLES = ["privacy-analyst", "security-reviewer", "access-approver", "admin"];

interface Template {
  priority: NotificationPriority;
  snoozable: boolean;
  title: string;
  category?: string;
  describe: (rng: () => number) => string;
  actions?: (rng: () => number) => NotificationAction[];
  metadata?: (rng: () => number) => Record<string, unknown>;
}

const MODULE_TEMPLATES: Record<string, Template[]> = {
  "access-governance": [
    {
      priority: "high",
      snoozable: false,
      category: "approvals",
      title: "Access request awaiting your approval",
      describe: () => "A user requested elevated access to a data catalog.",
      actions: (rng) => {
        const id = shortId(rng);
        return [
          {
            label: "Approve",
            kind: "dispatch",
            method: "POST",
            url: `https://app/api/access/${id}/approve`,
            icon: "check",
          },
          {
            label: "Deny",
            kind: "dispatch",
            method: "POST",
            url: `https://app/api/access/${id}/deny`,
            icon: "x",
          },
          {
            label: "Review",
            kind: "link",
            method: "GET",
            url: `https://app/access/${id}`,
            icon: "external-link",
          },
        ];
      },
      metadata: (rng) => ({ requestId: shortId(rng), riskScore: 40 + Math.floor(rng() * 60) }),
    },
  ],
  dsr: [
    {
      priority: "critical",
      snoozable: true,
      category: "sla",
      title: "DSR approaching SLA breach",
      describe: () => "A data-subject request is close to its deadline.",
      actions: (rng) => [
        {
          label: "Open DSR",
          kind: "link",
          method: "GET",
          url: `https://app/dsr/${shortId(rng)}`,
          icon: "folder-open",
        },
      ],
      metadata: (rng) => ({
        dsrId: shortId(rng),
        type: pick(rng, ["erasure", "access", "rectification"]),
      }),
    },
  ],
  "data-mapping": [
    {
      priority: "normal",
      snoozable: true,
      title: "Sensitive data found in new data stores",
      describe: (rng) =>
        `The latest scan classified sensitive data in ${1 + Math.floor(rng() * 5)} stores.`,
      metadata: (rng) => ({
        scanId: shortId(rng),
        classifications: pick(rng, [["ssn"], ["credit-card"], ["ssn", "credit-card"]]),
      }),
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
      actions: () => [
        {
          label: "View assessments",
          kind: "link",
          method: "GET",
          url: "https://app/assessments?state=draft",
          icon: "clipboard-list",
        },
      ],
      metadata: (rng) => ({ draftCount: 1 + Math.floor(rng() * 6) }),
    },
  ],
};

// Fallback for a caller-supplied module with no built-in template.
const GENERIC_TEMPLATES: Template[] = [
  {
    priority: "normal",
    snoozable: true,
    title: "Notification",
    describe: () => "A module published a notification.",
    metadata: (rng) => ({ ref: shortId(rng) }),
  },
];

export function simulate(opts: SimulateOptions = {}): Notification[] {
  const count = opts.count ?? 10;
  // Coalesce an empty array too, not just null/undefined — an empty module list
  // would otherwise make pick() yield undefined and emit invalid notifications.
  const modules = opts.modules?.length ? opts.modules : Object.keys(MODULE_TEMPLATES);
  const rng = mulberry32((opts.seed ?? Date.now()) >>> 0);

  const batch: Notification[] = [];
  for (let i = 0; i < count; i++) {
    const moduleName = pick(rng, modules);
    const template = pick(rng, MODULE_TEMPLATES[moduleName] ?? GENERIC_TEMPLATES);
    // Round-robin the scope so every scope is represented once count >= 4.
    const scope = AUDIENCE_SCOPES[i % AUDIENCE_SCOPES.length]!;

    batch.push({
      // `i` guarantees uniqueness within the burst (it doubles as the dedupe key).
      id: `${moduleName}-${i}-${shortId(rng)}`,
      module: moduleName,
      title: template.title,
      description: template.describe(rng),
      priority: template.priority,
      snoozable: template.snoozable,
      audience: buildAudience(scope, rng),
      ...(template.category ? { category: template.category } : {}),
      ...(template.actions ? { actions: template.actions(rng) } : {}),
      ...(template.metadata ? { metadata: template.metadata(rng) } : {}),
    });
  }
  return batch;
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

/** Small, fast, seedable PRNG (mulberry32) — deterministic given a seed. */
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
