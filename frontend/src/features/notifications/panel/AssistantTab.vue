<script setup lang="ts">
import { ref } from "vue";
import { SendHorizontal, Sparkles } from "@lucide/vue";
import Icon from "@/components/ui/Icon.vue";
import { useChatStore } from "@/stores/chat";
import { useSettingsStore } from "@/stores/settings";

// Real streaming Q/A over the user's notifications. The thread + streaming live in the chat store;
// this component owns only the draft input. Gated on the chatbotEnabled flag (the server enforces
// the same flag independently — this is UI affordance, not the security boundary).
const chat = useChatStore();
const settings = useSettingsStore();
const draft = ref("");

function onSubmit(): void {
  const q = draft.value.trim();
  if (!q || chat.status === "streaming") return;
  void chat.send(q);
  draft.value = "";
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <div class="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
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
        <p
          class="max-w-[82%] rounded-lg px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap"
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
          {{ m.text
          }}<span
            v-if="m.from === 'ai' && m.text === '' && chat.status === 'streaming'"
            class="text-faint"
            >…</span
          >
        </p>
      </div>
    </div>

    <div class="border-t border-line p-3">
      <!-- Composer — only when chat is enabled. -->
      <form
        v-if="settings.flags.chatbotEnabled"
        class="flex items-center gap-2 rounded-lg border border-line-strong bg-sunken px-3 py-2 focus-within:border-accent"
        @submit.prevent="onSubmit"
      >
        <input
          v-model="draft"
          type="text"
          data-test="ai-input"
          placeholder="Ask about your notifications…"
          aria-label="Ask the assistant"
          :disabled="chat.status === 'streaming'"
          class="flex-1 bg-transparent text-[13px] text-text placeholder:text-faint disabled:cursor-not-allowed"
          @keydown.enter.prevent="onSubmit"
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
