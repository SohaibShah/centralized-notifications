import type { Notification } from "@notifications/shared";

/**
 * A connected consumer of the delivery stream. `userId` is what audience-targeted
 * delivery matches against (Week 4); `deliver` hands off one notification. `deliver`
 * MUST NOT throw — the hub guards it anyway, but a subscriber that buffers/writes
 * should swallow its own transport errors so one bad connection can't affect others.
 */
export interface Subscriber {
  userId: string;
  deliver(notification: Notification): void;
}

/**
 * In-process fan-out bus: the transport-agnostic seam between the pipeline and the
 * SSE endpoint. Routing/targeting only — no transport, no batching (coalescing lives
 * in the SSE layer). Week 5 puts Redis Streams behind this same surface; the pipeline
 * and SSE code don't change.
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

  /** Week-1 shortcut: deliver to every connected subscriber regardless of audience. */
  broadcast(notification: Notification): void {
    for (const subscriber of this.subscribers) {
      this.safeDeliver(subscriber, notification);
    }
  }

  /**
   * Week-4 seam: deliver only to subscribers whose user is in `userIds`. `ingest`
   * will call this with the resolved recipients once audience resolution exists.
   */
  publishToRecipients(userIds: string[], notification: Notification): void {
    const recipients = new Set(userIds);
    for (const subscriber of this.subscribers) {
      if (recipients.has(subscriber.userId)) {
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
      // Delivery is best-effort; the durable record already exists in the DB. Log so a
      // genuine bug in a subscriber (not just a dead socket) isn't silently swallowed.
      console.warn(`[delivery] subscriber threw during deliver: ${(err as Error).message}`);
    }
  }
}

/** Process-local singleton shared by the pipeline (publisher) and SSE routes (subscribers). */
export const deliveryHub = new DeliveryHub();
