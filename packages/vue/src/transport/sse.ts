import { type Notification, notificationSchema } from "@notifications/shared";
import type { SseClient, SseStatus } from "./types";

/**
 * Opens the real-time delivery stream (`GET {baseUrl}/sse`). The backend emits `event: notifications`
 * frames whose `data` is a JSON array (a coalesced burst); each frame is handed to `onBatch`.
 * `withCredentials` sends the session cookie for same-origin/cookie hosts.
 *
 * Reconnection is the browser's job — EventSource honours the server's `retry:` hint and reopens on
 * drop; we only reflect the lifecycle through `onStatus`. A malformed frame is validated away, never
 * thrown, so one bad payload can't tear the stream down.
 */
export function connectSse(
  baseUrl: string,
  opts: {
    onBatch: (batch: Notification[]) => void;
    onStatus?: (status: SseStatus) => void;
  },
): SseClient {
  const source = new EventSource(baseUrl + "/sse", { withCredentials: true });
  opts.onStatus?.("connecting");

  source.onopen = () => opts.onStatus?.("open");

  source.addEventListener("notifications", (event) => {
    try {
      const parsed: unknown = JSON.parse((event as MessageEvent<string>).data);
      if (!Array.isArray(parsed)) return;
      // Validate every element against the shared contract at this trust boundary — a
      // well-formed-JSON but wrong-shape frame must not flow into the store/renderer.
      const valid = parsed.flatMap((item) => {
        const result = notificationSchema.safeParse(item);
        return result.success ? [result.data] : [];
      });
      if (valid.length > 0) opts.onBatch(valid);
    } catch {
      // Ignore a malformed frame rather than letting it break the stream.
    }
  });

  source.onerror = () =>
    opts.onStatus?.(source.readyState === source.CLOSED ? "closed" : "connecting");

  return {
    close() {
      source.close();
      opts.onStatus?.("closed");
    },
  };
}
