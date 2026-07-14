import { vi } from "vitest";

// jsdom has no IntersectionObserver; FeedList uses it to drive scroll pagination. Stub it
// so mounting the popover (which renders FeedList) doesn't throw. Pagination itself is
// covered at the store level (stores/feed.spec.ts), not here.
class IntersectionObserverStub {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  takeRecords = vi.fn(() => []);
  root = null;
  rootMargin = "";
  thresholds: number[] = [];
}
vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
