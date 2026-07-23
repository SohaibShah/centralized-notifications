import type { Transport } from "./types";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * The default same-origin/cookie transport (used by the reference host). `credentials:"include"`
 * sends the session cookie; a JSON content-type is set only when there's a body. Non-2xx throws an
 * `ApiError` carrying the status + the server's `error` message. A host with token/bearer auth injects
 * its own `Transport` instead.
 */
export function createCookieTransport(baseUrl: string): Transport {
  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const headers: Record<string, string> = {
      ...((init?.headers as Record<string, string>) ?? {}),
    };
    if (init?.body !== undefined && !("content-type" in headers)) {
      headers["content-type"] = "application/json";
    }
    const res = await fetch(baseUrl + path, { credentials: "include", ...init, headers });
    if (!res.ok) {
      let message = res.statusText;
      try {
        const body = (await res.json()) as { error?: string };
        if (body?.error) message = body.error;
      } catch {
        // non-JSON body; keep statusText
      }
      throw new ApiError(res.status, message);
    }
    return (res.status === 204 ? undefined : await res.json()) as T;
  }
  return {
    get: (p) => request(p),
    post: (p, b) =>
      request(p, { method: "POST", body: b === undefined ? undefined : JSON.stringify(b) }),
    patch: (p, b) =>
      request(p, { method: "PATCH", body: b === undefined ? undefined : JSON.stringify(b) }),
    del: (p) => request(p, { method: "DELETE" }),
  };
}
