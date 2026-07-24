import { moduleActionResponseSchema, type NotificationAction } from "@notifications/shared";
import type { QueryFn } from "../db";
import type { PolicyStore } from "../policy/store";
import type { ActionDispatcher, ActionDispatchResult, Principal } from "../types";
import { audienceWhere } from "../audience/match";
import { parseActions } from "../read/feed";
import { markRead } from "../read/read-state";
import { NotFoundError } from "../service";
import { createActionStore } from "./store";

/** Actions are globally disabled (the `actions_enabled` kill-switch is off). */
export class ActionsDisabledError extends Error {
  constructor() {
    super("actions disabled");
    this.name = "ActionsDisabledError";
  }
}

/** The owning module can't receive a dispatch: unknown, disabled, or no registered `base_url`. */
export class ModuleUnavailableError extends Error {
  constructor() {
    super("module unavailable");
    this.name = "ModuleUnavailableError";
  }
}

interface DispatchDeps {
  query: QueryFn;
  policy: PolicyStore;
  /** Host-injected outbound transport. Absent = no way to reach the module → ModuleUnavailableError. */
  dispatcher?: ActionDispatcher;
}

interface VisibleNotification {
  module: string;
  actions: NotificationAction[];
}

/**
 * Load a notification IFF it is visible to this principal — reuses the SAME `audienceWhere` predicate
 * `read-state.markRead` relies on, so "dispatchable" == "visible". A notification the caller can't
 * see is indistinguishable from a missing one (NotFoundError, no existence oracle). Returns the
 * module key + the parsed action set (bad/legacy entries dropped by `parseActions`).
 */
async function loadVisibleNotification(
  query: QueryFn,
  principal: Principal,
  id: string,
): Promise<VisibleNotification> {
  const params: unknown[] = [id];
  const audience = audienceWhere(principal, params);
  const res = await query<{ module: string; actions: unknown[] | null }>(
    `SELECT n.module, n.actions FROM notifications n
      WHERE n.id = $1 AND n.suppressed = false AND ${audience}`,
    params,
  );
  if (res.rowCount === 0) throw new NotFoundError();
  const row = res.rows[0]!;
  return { module: row.module, actions: parseActions(row.actions ?? []) };
}

const FAILED: ActionDispatchResult = { ok: false, message: "Action failed" };

/** One leading slash on `path` is guaranteed by the dispatch schema; strip a trailing slash on
 *  `base` so the join never produces `//`. */
function joinUrl(base: string, path: string): string {
  return base.replace(/\/$/, "") + path;
}

/**
 * UNIFORM action dispatch. On a user's dispatch-action click, forward
 * `{notification, action, metadata, actor}` to the OWNING module and relay its response — the hub
 * never interprets the action. Security-critical ordering: (1) transport present, (2) feature on,
 * (3) notification visible to the caller, (4) it's a real dispatch action, (5) module reachable,
 * (6) idempotent begin (a replay returns the recorded result WITHOUT re-dispatching), (7) dispatch,
 * (8) validate + record + relay. PII-safe: never logs the metadata or the response body.
 */
export async function dispatchAction(
  deps: DispatchDeps,
  args: { principal: Principal; notificationId: string; actionRef: string; idempotencyKey: string },
): Promise<ActionDispatchResult> {
  const { query, policy, dispatcher } = deps;

  // (1) No host transport injected — the module is unreachable by definition.
  if (!dispatcher) throw new ModuleUnavailableError();

  // (2) Global kill-switch.
  const settings = await policy.getSettings();
  if (!settings.actionsEnabled) throw new ActionsDisabledError();

  // (3) Visibility == authorization. NotFoundError if the caller can't see it.
  const notification = await loadVisibleNotification(query, args.principal, args.notificationId);

  // (4) The referenced action must exist and be a dispatch action (not a link / out-of-range ref).
  const action = notification.actions[Number(args.actionRef)];
  if (!action || action.kind !== "dispatch") throw new NotFoundError();

  // (5) The owning module must be known, enabled, and have a registered base URL.
  const mod = await policy.resolveModule(notification.module);
  const baseUrl = await policy.getModuleBaseUrl(notification.module);
  if (!mod.known || !mod.enabled || !baseUrl) throw new ModuleUnavailableError();

  // (6) Idempotent record. A replay (same idempotency tuple) short-circuits to the recorded result
  //     WITHOUT calling the dispatcher again — the guard against at-least-once retries duplicating.
  const store = createActionStore(query);
  const begun = await store.begin({
    userKey: args.principal.userKey,
    notificationId: args.notificationId,
    actionRef: args.actionRef,
    idempotencyKey: args.idempotencyKey,
  });
  if (!begun.created) {
    const ok = begun.row.status === "ok";
    return { ok, ...(begun.row.resultMessage ? { message: begun.row.resultMessage } : {}) };
  }

  const url = joinUrl(baseUrl, action.path);
  try {
    // (7) Forward to the module. `base_url` is validated registry data; `path` is a validated
    //     relative path (no scheme, no `..`) — the egress-safety guarantee lives in the schema.
    const res = await dispatcher.dispatch({
      url,
      method: action.method,
      body: {
        notificationId: args.notificationId,
        actionRef: args.actionRef,
        metadata: action.metadata ?? null,
        actor: { userKey: args.principal.userKey },
      },
    });

    // (8) Validate the module's response at the boundary. A non-2xx status OR a shape that fails
    //     validation is a failed dispatch — recorded as such, relayed as a generic failure.
    const parsed = moduleActionResponseSchema.safeParse(res.body);
    if (res.status < 200 || res.status >= 300 || !parsed.success) {
      await store.complete(begun.row.id, "failed", null);
      return FAILED;
    }

    const body = parsed.data;
    await store.complete(begun.row.id, body.ok ? "ok" : "failed", body.message ?? null);
    // Resolve is only honored on success — a failed dispatch never marks the notification read.
    if (body.ok && body.resolve) {
      await markRead(query, { principal: args.principal, id: args.notificationId });
    }
    return {
      ok: body.ok,
      ...(body.message ? { message: body.message } : {}),
      ...(body.resolve ? { resolve: true } : {}),
      ...(body.actions ? { actions: body.actions } : {}),
    };
  } catch {
    // (9) A thrown/timed-out dispatcher is a failed dispatch, recorded durably. Swallow the cause —
    //     it may carry the module URL / payload; we relay only the outcome, never the detail.
    await store.complete(begun.row.id, "failed", null);
    return FAILED;
  }
}
