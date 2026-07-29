import type { ActionDispatcher } from "@notifications/core";

/**
 * The host-side HTTP `ActionDispatcher`. Core composes the absolute `url` (host from the DB
 * module registry, path a validated relative path) and hands us `{url, method, body}`; we attach
 * the service-to-service dispatch token and perform the actual outbound fetch. Keeping this
 * concrete HTTP client here (not in `packages/core`) is what keeps core env/identity-free.
 *
 * - No redirect following (`redirect: "manual"`) — a module must not bounce the call elsewhere.
 * - Bounded timeout via AbortController; default 5s.
 * - Never throws on a non-2xx response — core decides what a given status means.
 */
export function createHttpActionDispatcher(opts: {
  token: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): ActionDispatcher {
  const doFetch = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 5000;
  return {
    async dispatch({ url, method, body }) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await doFetch(url, {
          method,
          redirect: "manual",
          signal: controller.signal,
          headers: {
            "content-type": "application/json",
            "x-module-dispatch-token": opts.token,
          },
          ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
        });
        const text = await res.text();
        let parsed: unknown = null;
        try {
          parsed = text ? JSON.parse(text) : null;
        } catch {
          parsed = null;
        }
        return { status: res.status, body: parsed };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
