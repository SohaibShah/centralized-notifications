export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// Thin fetch wrapper. `credentials: "include"` sends the session cookie (same-origin via
// the Vite dev proxy / single-origin in prod). Non-2xx throws an ApiError carrying the
// status so callers can branch (e.g. 401 → "wrong credentials").
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // Only declare a JSON content-type when there's actually a body — a bodyless POST
  // (e.g. logout) with `content-type: application/json` is rejected by Fastify as an
  // empty JSON body (FST_ERR_CTP_EMPTY_JSON_BODY).
  const headers: Record<string, string> = { ...((init?.headers as Record<string, string>) ?? {}) };
  if (init?.body !== undefined && !("content-type" in headers)) {
    headers["content-type"] = "application/json";
  }
  const res = await fetch(path, { credentials: "include", ...init, headers });
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

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: "POST",
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
};
