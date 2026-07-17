<script setup lang="ts">
import { SendHorizontal, Sparkles } from "@lucide/vue";
import Icon from "@/components/ui/Icon.vue";

// AI assistant — VISUAL STUB this pass (design spec). The thread is canned and the composer
// is inert; a real LLM is wired in the dedicated AI task. Kept isolated so that task is a
// drop-in replacement.
const thread: { from: "ai" | "me"; text: string }[] = [
  {
    from: "ai",
    text: "Hi — I can triage, summarise, or draft replies for your notifications. Ask away.",
  },
  { from: "me", text: "What's most urgent right now?" },
  {
    from: "ai",
    text: "The Acme Corp DSAR is overdue by 2 days — that's your top priority. Want me to open it or draft a status note?",
  },
];
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <div class="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
      <div
        v-for="(m, i) in thread"
        :key="i"
        class="flex"
        :class="m.from === 'me' ? 'justify-end' : 'justify-start'"
      >
        <p
          class="max-w-[82%] rounded-lg px-3 py-2 text-[13px] leading-relaxed"
          :class="
            m.from === 'me'
              ? 'rounded-br-sm bg-accent text-accent-ink'
              : 'ai-bubble-border rounded-bl-sm text-text'
          "
        >
          <Icon
            v-if="m.from === 'ai'"
            :icon="Sparkles"
            :size="13"
            class="mb-0.5 inline text-ai-2"
          />
          {{ m.text }}
        </p>
      </div>
    </div>

    <div class="border-t border-line p-3">
      <div class="flex items-center gap-2 rounded-lg border border-line-strong bg-sunken px-3 py-2">
        <input
          type="text"
          disabled
          placeholder="Ask about your notifications…"
          aria-label="Ask the assistant (coming soon)"
          class="flex-1 bg-transparent text-[13px] text-muted placeholder:text-faint disabled:cursor-not-allowed"
        />
        <button
          type="button"
          disabled
          data-test="ai-send"
          aria-label="Send (coming soon)"
          class="ai-gradient-bg grid size-7 shrink-0 place-items-center rounded-md text-accent-ink opacity-60 disabled:cursor-not-allowed"
        >
          <Icon :icon="SendHorizontal" :size="14" />
        </button>
      </div>
    </div>
  </div>
</template>
