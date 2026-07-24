import { reactive } from "vue";
import type { ModuleActionResponse, NotificationAction } from "@notifications/shared";
import type { FeedState } from "./feed";
import type { FeatureFlags } from "./settings";
import type { Transport } from "../transport/types";

/** The inline, per-action result surfaced by the card after a dispatch round-trip (rendering it is
 *  Task 17's job — this just holds the data). */
export interface ActionResult {
  ok: boolean;
  message?: string;
}

function keyOf(id: string, ref: number): string {
  return `${id}:${ref}`;
}

/**
 * The single action path shared by the notification card and the AI chat. A module action's `kind`
 * (not its HTTP method) decides behavior:
 *  - "link" opens `action.url` in a new tab and marks the notification read (unchanged, synchronous).
 *  - "dispatch" round-trips through the server (`POST /notifications/:id/actions/:ref/dispatch`)
 *    with a fresh idempotency key. On success it may mark the notification read (`resolve`) and/or
 *    replace its action set (`actions`, e.g. swapping "Approve" for "Undo"); the result (`ok`/
 *    `message`) is stashed for the card to render via `resultFor`. `isPending` guards against a
 *    second fire while one is in flight for the same `${id}:${ref}`.
 */
export function createNotificationActions(deps: {
  feed: Pick<FeedState, "markRead" | "setActions">;
  transport: Transport;
  settings: { flags: Pick<FeatureFlags, "actionsEnabled"> };
}): {
  runAction: (action: NotificationAction, target: { id: string; ref: number }) => Promise<void>;
  isPending: (id: string, ref: number) => boolean;
  resultFor: (id: string, ref: number) => ActionResult | undefined;
} {
  const feed = deps.feed;
  const pending = reactive(new Set<string>());
  const results = reactive(new Map<string, ActionResult>());

  function isPending(id: string, ref: number): boolean {
    return pending.has(keyOf(id, ref));
  }

  function resultFor(id: string, ref: number): ActionResult | undefined {
    return results.get(keyOf(id, ref));
  }

  async function runDispatch(
    // The dispatch action's own `path`/`method` are the module's server-side registration, not
    // something the client calls directly — the client always hits the fixed proxy endpoint below
    // keyed by `target.ref`. Kept as a parameter (unused) so `runAction`'s branch stays typed on
    // the narrowed "dispatch" member, matching the "link" branch's shape.
    _action: Extract<NotificationAction, { kind: "dispatch" }>,
    target: { id: string; ref: number },
  ): Promise<void> {
    if (!deps.settings.flags.actionsEnabled) return; // server enforces too; this just skips the round-trip
    const key = keyOf(target.id, target.ref);
    if (pending.has(key)) return; // double-fire guard — a second click while one is in flight is a no-op
    pending.add(key);
    try {
      const res = await deps.transport.post<ModuleActionResponse>(
        `/notifications/${encodeURIComponent(target.id)}/actions/${target.ref}/dispatch`,
        { idempotencyKey: crypto.randomUUID() },
      );
      if (res.ok && res.resolve) feed.markRead(target.id);
      if (res.ok && res.actions) feed.setActions(target.id, res.actions);
      results.set(key, { ok: res.ok, message: res.message });
    } catch {
      results.set(key, { ok: false, message: "Action failed" });
    } finally {
      pending.delete(key);
    }
  }

  async function runAction(
    action: NotificationAction,
    target: { id: string; ref: number },
  ): Promise<void> {
    if (action.kind === "dispatch") {
      await runDispatch(action, target);
      return;
    }
    // "link" — or a legacy action persisted before `kind` existed (treated as link).
    feed.markRead(target.id);
    window.open(action.url, "_blank", "noopener,noreferrer");
  }

  return reactive({ runAction, isPending, resultFor });
}

export type NotificationActionsState = ReturnType<typeof createNotificationActions>;
