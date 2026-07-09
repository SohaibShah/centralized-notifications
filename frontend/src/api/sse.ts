import { type Notification, notificationSchema } from "@notifications/shared";

export type SseStatus = "connecting" | "open" | "closed";

export interface SseClient {
  close(): void;
}

/**
 * Opens the real-time delivery stream (`GET /sse`, FR-5). The backend emits
 * `event: notifications` frames whose `data` is a JSON array (a coalesced burst);
 * each frame is handed to `onBatch`. Same-origin via the Vite dev proxy, so the
 * session cookie rides along automatically.
 *
 * Reconnection is the browser's job — EventSource honours the server's `retry:`
 * hint and reopens on drop; we only reflect the lifecycle through `onStatus` so the
 * UI can show a connection indicator. A malformed frame is ignored, never thrown,
 * so one bad payload can't tear the stream down.
 */
export function connectSse(opts: {
  onBatch: (batch: Notification[]) => void;
  onStatus?: (status: SseStatus) => void;
}): SseClient {
  const source = new EventSource("/sse", { withCredentials: true });
  opts.onStatus?.("connecting");

  source.onopen = () => opts.onStatus?.("open");

  source.addEventListener("notifications", (event) => {
    try {
      const parsed: unknown = JSON.parse((event as MessageEvent<string>).data);
      if (!Array.isArray(parsed)) return;
      // Validate every element against the shared contract at this trust boundary — a
      // well-formed-JSON but wrong-shape frame must not flow into the store/renderer
      // (security.md). Drop invalid items; deliver the rest.
      const valid = parsed.flatMap((item) => {
        const result = notificationSchema.safeParse(item);
        return result.success ? [result.data] : [];
      });
      if (valid.length > 0) opts.onBatch(valid);
    } catch {
      // Ignore a malformed frame rather than letting it break the stream.
    }
  });

  // The browser transitions to CONNECTING and retries on its own; surface that so the
  // indicator can show "reconnecting" without us managing backoff.
  source.onerror = () =>
    opts.onStatus?.(source.readyState === source.CLOSED ? "closed" : "connecting");

  return {
    close() {
      source.close();
      opts.onStatus?.("closed");
    },
  };
}
