import { reactive, ref } from "vue";
import { defineStore } from "pinia";
import type { ChatSource } from "@notifications/shared";

type Turn = { from: "me" | "ai"; text: string; sources: Record<string, ChatSource> };
const MAX_HISTORY = 8;

/** Streaming chat over the user's notifications. Client-only multi-turn: the thread lives here and
 *  the last few turns are sent as history with each question. Uses raw fetch (not the api client)
 *  because it reads the response as a stream rather than parsing a JSON body. */
export const useChatStore = defineStore("chat", () => {
  const thread = reactive<Turn[]>([]);
  const status = ref<"idle" | "streaming" | "error">("idle");

  async function send(question: string): Promise<void> {
    const q = question.trim();
    if (!q || status.value === "streaming") return;

    // History = prior turns (before this question), bounded, mapped to roles.
    const history = thread
      .slice(-MAX_HISTORY)
      .map((t) => ({ role: t.from === "me" ? "user" : "assistant", content: t.text }));

    thread.push({ from: "me", text: q, sources: {} });
    const ai = reactive<Turn>({ from: "ai", text: "", sources: {} });
    thread.push(ai);
    status.value = "streaming";

    try {
      const res = await fetch("/notifications/chat", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: q, history }),
      });
      if (!res.ok || !res.body) {
        ai.text =
          res.status === 404
            ? "AI chat is turned off."
            : "Couldn't get an answer — is the local model running?";
        status.value = "error";
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let errored = false;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const frames = buf.split("\n\n");
        buf = frames.pop() ?? "";
        for (const frame of frames) {
          if (frame.startsWith("event: error")) {
            errored = true;
            continue;
          }
          const dataLine = frame.split("\n").find((l) => l.startsWith("data:"));
          if (!dataLine) continue;
          const payload = dataLine.slice(5).trim();
          if (frame.startsWith("event: sources")) {
            try {
              for (const s of JSON.parse(payload) as ChatSource[]) ai.sources[s.ref] = s;
            } catch {
              /* ignore */
            }
            continue;
          }
          try {
            const json = JSON.parse(payload) as { delta?: string; done?: boolean };
            if (typeof json.delta === "string") ai.text += json.delta;
          } catch {
            /* ignore */
          }
        }
      }
      if (errored && !ai.text) ai.text = "The answer stream failed.";
      status.value = errored ? "error" : "idle";
    } catch {
      ai.text = "Couldn't reach the assistant.";
      status.value = "error";
    }
  }

  return { thread, status, send };
});
