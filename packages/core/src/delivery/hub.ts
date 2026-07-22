import type { Notification } from "@notifications/shared";
import type { Principal } from "../types";
import { matchAudience } from "../audience/match";

/**
 * A connected consumer of the delivery stream. `principal` is what audience-targeted delivery
 * matches against (captured at subscribe time); `deliver` hands off one notification and MUST NOT
 * throw — the hub guards it, but a subscriber that writes to a socket should swallow its own
 * transport errors so one bad connection can't affect others.
 */
export interface Subscriber {
  principal: Principal;
  deliver(notification: Notification): void;
}

/**
 * In-process fan-out bus: the transport-agnostic seam between the pipeline and the SSE endpoint.
 * Routing/targeting only — no transport, no batching (coalescing lives in the SSE layer). A
 * distributed pub/sub transport for multi-instance delivery is a documented future seam.
 */
export class DeliveryHub {
  private readonly subscribers = new Set<Subscriber>();

  /** Register a subscriber; returns an idempotent unsubscribe function. */
  subscribe(subscriber: Subscriber): () => void {
    this.subscribers.add(subscriber);
    return () => {
      this.subscribers.delete(subscriber);
    };
  }

  /** Deliver to every connected subscriber whose principal matches the notification's audience.
   *  Global fans out to all; team/role/user reach only matching subscribers. */
  publish(notification: Notification): void {
    for (const subscriber of this.subscribers) {
      if (matchAudience(subscriber.principal, notification.audience)) {
        this.safeDeliver(subscriber, notification);
      }
    }
  }

  get subscriberCount(): number {
    return this.subscribers.size;
  }

  // A throwing subscriber must not abort the publish loop or bubble into the pipeline.
  private safeDeliver(subscriber: Subscriber, notification: Notification): void {
    try {
      subscriber.deliver(notification);
    } catch (err) {
      // Delivery is best-effort; the durable record already exists in the DB. Log so a genuine
      // bug in a subscriber (not just a dead socket) isn't silently swallowed.
      console.warn(`[delivery] subscriber threw during deliver: ${(err as Error).message}`);
    }
  }
}
