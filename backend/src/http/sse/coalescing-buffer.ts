/**
 * Buffers items and flushes them as one batch after a short window, so a burst of
 * notifications becomes a single SSE write instead of many (NFR-2). The first `push`
 * after a flush starts the timer; everything pushed within `windowMs` rides the same
 * flush. Timer-only and side-effect-isolated to `onFlush`, so it's deterministically
 * unit-testable with fake timers.
 */
export class CoalescingBuffer<T> {
  private items: T[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private closed = false;

  constructor(
    private readonly windowMs: number,
    private readonly onFlush: (batch: T[]) => void,
  ) {}

  push(item: T): void {
    if (this.closed) return;
    this.items.push(item);
    this.timer ??= setTimeout(() => this.flush(), this.windowMs);
  }

  private flush(): void {
    this.timer = undefined;
    if (this.items.length === 0) return;
    const batch = this.items;
    this.items = [];
    this.onFlush(batch);
  }

  /** Cancel any pending flush and drop buffered items — no final flush. Idempotent. */
  close(): void {
    this.closed = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.items = [];
  }
}
