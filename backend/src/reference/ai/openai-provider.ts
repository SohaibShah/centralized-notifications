import type { AiMessage, AiProvider } from "@notifications/core";

/** An OpenAI-compatible chat-completions transport. Points at local Ollama's /v1 by default; the same
 *  adapter targets a cloud/scaled endpoint by changing baseUrl (+ apiKey). Never logs prompt/output. */
export function createOpenAiProvider(cfg: {
  baseUrl: string;
  model: string;
  apiKey?: string;
  timeoutMs?: number;
}): AiProvider {
  return {
    async complete(messages: AiMessage[], opts) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), cfg.timeoutMs ?? 30_000);
      try {
        const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}),
          },
          body: JSON.stringify({
            model: cfg.model,
            messages,
            max_tokens: opts?.maxTokens ?? 300,
            temperature: opts?.temperature ?? 0.3,
            stream: false,
          }),
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`AI provider HTTP ${res.status}`);
        const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
        const content = data.choices?.[0]?.message?.content;
        if (typeof content !== "string") throw new Error("AI provider returned no content");
        return content;
      } finally {
        clearTimeout(timer);
      }
    },

    async *completeStream(messages: AiMessage[], opts) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), cfg.timeoutMs ?? 30_000);
      try {
        const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}),
          },
          body: JSON.stringify({
            model: cfg.model,
            messages,
            max_tokens: opts?.maxTokens ?? 500,
            temperature: opts?.temperature ?? 0.2,
            stream: true,
          }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) throw new Error(`AI provider HTTP ${res.status}`);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? ""; // keep the trailing partial line
          for (const raw of lines) {
            const line = raw.trim();
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (payload === "[DONE]") return;
            try {
              const json = JSON.parse(payload) as { choices?: { delta?: { content?: string } }[] };
              const delta = json.choices?.[0]?.delta?.content;
              if (typeof delta === "string" && delta) yield delta;
            } catch {
              /* keep-alive / non-JSON line — ignore */
            }
          }
        }
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
