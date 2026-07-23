<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from "vue";
import { SendHorizontal, Sparkles } from "@lucide/vue";
import Icon from "../../ui/Icon.vue";
import { useChat } from "../../provider/context";
import { useSettings } from "../../provider/context";
import MarkdownMessage from "./MarkdownMessage";

// Real streaming Q/A over the user's notifications. The thread + streaming live in the chat store;
// this component owns only the draft input. Gated on the chatbotEnabled flag (the server enforces
// the same flag independently — this is UI affordance, not the security boundary).
const chat = useChat();
const settings = useSettings();
const draft = ref("");
const inputEl = ref<HTMLTextAreaElement | null>(null);

function onSubmit(): void {
  const q = draft.value.trim();
  if (!q || chat.status === "streaming") return;
  void chat.send(q);
  draft.value = "";
  void nextTick(autoGrow); // collapse the textarea back to one row after sending
}

// Enter sends; Shift+Enter inserts a newline (the textarea's default). Ignore Enter mid-IME
// composition so committing a candidate doesn't fire an accidental send.
function onKeydown(e: KeyboardEvent): void {
  if (e.key !== "Enter" || e.shiftKey || e.isComposing) return;
  e.preventDefault();
  onSubmit();
}

// Grow the composer with its content, up to a few lines, then scroll internally.
function autoGrow(): void {
  const el = inputEl.value;
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
}

// ── Auto-scroll ─────────────────────────────────────────────────────────────────────────────────
// Keep the newest message in view: land at the bottom when the tab opens and follow the answer as it
// streams — but only while the user is already near the bottom, so scrolling up to re-read isn't
// yanked back down.
const scroller = ref<HTMLElement | null>(null);
let pinned = true;

function nearBottom(): boolean {
  const el = scroller.value;
  return !el || el.scrollHeight - el.scrollTop - el.clientHeight < 48;
}
function scrollToBottom(): void {
  const el = scroller.value;
  if (el) el.scrollTop = el.scrollHeight;
}
function onScroll(): void {
  pinned = nearBottom();
}

onMounted(async () => {
  await nextTick();
  scrollToBottom();
});

// A new turn (the question, then the answer bubble) always pins to the bottom.
watch(
  () => chat.thread.length,
  async () => {
    pinned = true;
    await nextTick();
    scrollToBottom();
  },
);

// Streaming growth of the last answer follows along only if the user hasn't scrolled up.
watch(
  () => chat.thread[chat.thread.length - 1]?.text,
  async () => {
    if (!pinned) return;
    await nextTick();
    scrollToBottom();
  },
);
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <div
      ref="scroller"
      class="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4"
      @scroll="onScroll"
    >
      <!-- Empty state: a short prompt before the first question. -->
      <div
        v-if="chat.thread.length === 0"
        class="flex items-start gap-2 text-[13px] leading-relaxed text-muted"
      >
        <Icon :icon="Sparkles" :size="13" class="mt-0.5 shrink-0 text-ai-2" />
        <p>Ask me about your notifications — what's urgent, what's overdue, or anything else.</p>
      </div>

      <div
        v-for="(m, i) in chat.thread"
        :key="i"
        class="flex"
        :class="m.from === 'me' ? 'justify-end' : 'justify-start'"
      >
        <!-- AI answer: rendered as markdown, with inline [n#] citations as chips. -->
        <div
          v-if="m.from === 'ai'"
          data-test="ai-answer"
          class="ai-bubble-border max-w-[82%] rounded-lg rounded-bl-sm px-3 py-2 text-[13px] leading-relaxed text-text"
        >
          <Icon :icon="Sparkles" :size="13" class="mb-1 text-ai-2" />
          <MarkdownMessage :text="m.text" :sources="m.sources" />
          <span v-if="m.text === '' && chat.status === 'streaming'" class="text-faint">…</span>
        </div>

        <!-- User question: plain text, newlines preserved. -->
        <p
          v-else
          class="max-w-[82%] whitespace-pre-wrap rounded-lg rounded-br-sm bg-accent px-3 py-2 text-[13px] leading-relaxed text-accent-ink"
        >
          {{ m.text }}
        </p>
      </div>
    </div>

    <div class="border-t border-line p-3">
      <!-- Composer — only when chat is enabled. -->
      <form
        v-if="settings.flags.chatbotEnabled"
        class="flex items-end gap-2 rounded-lg border border-line-strong bg-sunken px-3 py-2 focus-within:border-accent"
        @submit.prevent="onSubmit"
      >
        <textarea
          ref="inputEl"
          v-model="draft"
          rows="1"
          data-test="ai-input"
          placeholder="Ask about your notifications…  (Shift+Enter for a new line)"
          aria-label="Ask the assistant"
          :disabled="chat.status === 'streaming'"
          class="max-h-32 flex-1 resize-none bg-transparent text-[13px] leading-relaxed text-text placeholder:text-faint focus:outline-none disabled:cursor-not-allowed"
          @keydown="onKeydown"
          @input="autoGrow"
        />
        <button
          type="submit"
          data-test="ai-send"
          aria-label="Send"
          :disabled="chat.status === 'streaming' || !draft.trim()"
          class="ai-gradient-bg grid size-7 shrink-0 place-items-center rounded-md text-accent-ink transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Icon :icon="SendHorizontal" :size="14" />
        </button>
      </form>

      <!-- Off state — server also enforces this; keep the messaging honest. -->
      <p
        v-else
        data-test="ai-off"
        class="rounded-lg border border-line bg-sunken px-3 py-2 text-[13px] text-muted"
      >
        AI chat is turned off.
      </p>
    </div>
  </div>
</template>
