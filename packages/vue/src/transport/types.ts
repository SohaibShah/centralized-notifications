import type { Notification } from "@notifications/shared";

/** JSON-in / JSON-out HTTP transport the library uses for its REST calls. A host injects its own to
 *  support token/bearer auth or a custom base; the default is a same-origin cookie transport. */
export interface Transport {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  patch<T>(path: string, body?: unknown): Promise<T>;
  del<T>(path: string): Promise<T>;
}

export interface SseClient {
  close(): void;
}
export type SseStatus = "connecting" | "open" | "closed";

/** Opens the live delivery stream; the provider binds `baseUrl` and passes this to the feed state. */
export type SseFactory = (opts: {
  onBatch: (batch: Notification[]) => void;
  onStatus?: (status: SseStatus) => void;
}) => SseClient;
