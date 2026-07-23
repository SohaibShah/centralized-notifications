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
  };
}
