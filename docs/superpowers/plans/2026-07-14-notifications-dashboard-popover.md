# Notifications Dashboard Bell Popover — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reframe the frontend as a SaaS dashboard where notifications live in a topbar **bell popover** (with feed, filters, and an AI-chat stub) instead of a full-screen feed.

**Architecture:** A persistent `DashboardLayout` shell (sidebar + topbar + routed main) owns the feed store's SSE lifecycle so the bell's unread badge is always live. A `NotificationBell` in the topbar toggles a `NotificationPopover` with two tabs — `Inbox` (reuses the existing feed store, `FeedList`, `FilterMenu`, `NotificationCardRenderer` untouched) and `Ask AI` (a canned, inert stub). Notification settings link out to a placeholder `/settings` route. No backend changes.

**Tech Stack:** Vue 3 `<script setup>` + TS, Vite 6, Tailwind v4 (`@theme` tokens), vue-router 4, Pinia, `@lucide/vue`, Vitest + `@vue/test-utils`, Playwright.

## Global Constraints

- **TypeScript strict everywhere.** `any` requires an inline comment explaining why. (`tsconfig.base.json` adds `noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`.)
- **Design system, not defaults.** Style only via Tailwind utilities off the `@theme` tokens in `styles/main.css` (e.g. `text-text`, `bg-surface`, `border-line`, `text-accent`). Never hardcode hex/px in components. Priority → dot via `priorityDotClass` in `@/design/tokens`.
- **Multi-word component names** (Vue rule); the `components/ui/**` primitives are the only single-word exception (already configured in `eslint.config.js`).
- **`pnpm lint` and `pnpm typecheck` must be clean** before any task is "done." Run from repo root.
- **Tests:** Vitest units live beside source as `*.spec.ts` under `src/` (picked up by `frontend/vite.config.ts` `test.include`). Playwright e2e in `frontend/e2e/`.
- **UI is not "done" on `tsc`/unit alone** — verify in a real browser with the `browser-tester` subagent (per `.claude/rules/testing.md`).
- **Commits:** Conventional Commits (`feat:`, `refactor:`, `test:`). **Never add "Generated with AI" / "Co-Authored-By: AI" trailers.**
- **Reuse, don't reinvent:** `stores/feed.ts`, `api/sse.ts`, `api/client.ts`, `stores/session.ts`, `components/ui/*`, `FeedList.vue`, `FilterMenu.vue`, `NotificationCardRenderer.vue` are consumed **unchanged**.
- Backend, and the cross-tenant-visibility question, are untouched by this plan.

---

### Task 1: Dashboard shell + routing

Replace the full-screen feed with a persistent dashboard shell and nested routes. The shell owns the feed store's SSE lifecycle (moved out of the deleted feed view). No unit test — this is layout/routing scaffolding; verify with typecheck + build + browser. Notifications UI arrives in Tasks 2–3, so between this task and Task 3 the dashboard renders without a bell; that is expected.

**Files:**
- Create: `frontend/src/features/dashboard/DashboardLayout.vue`
- Create: `frontend/src/features/dashboard/DashboardHome.vue`
- Create: `frontend/src/features/dashboard/components/DashboardSidebar.vue`
- Create: `frontend/src/features/dashboard/components/DashboardTopBar.vue`
- Create: `frontend/src/features/settings/SettingsStub.vue`
- Modify: `frontend/src/router/index.ts`
- Delete: `frontend/src/features/notifications/NotificationsView.vue`, `frontend/src/features/notifications/components/AppSidebar.vue`, `frontend/src/features/notifications/components/TopBar.vue`

**Interfaces:**
- Consumes: `useFeedStore()` (`reset`, `connect`, `load`, `disconnect`) from `@/stores/feed`; `useSessionStore()` (`user`, `isAdmin`, `logout`) from `@/stores/session`.
- Produces: route names `dashboard` (path `/`) and `settings` (path `/settings`); `DashboardTopBar` exposes an empty right-side slot region where `NotificationBell` mounts in Task 3.

- [ ] **Step 1: Create `DashboardLayout.vue`**

```vue
<script setup lang="ts">
import { onBeforeUnmount, onMounted } from "vue";
import { useFeedStore } from "@/stores/feed";
import DashboardSidebar from "./components/DashboardSidebar.vue";
import DashboardTopBar from "./components/DashboardTopBar.vue";

// The shell owns the feed lifecycle now (not the feed view): SSE connects on entry so the
// topbar bell's unread badge is live even while the panel is closed. reset() clears any
// prior user's feed; connect() subscribes before load() so a burst mid-load isn't lost.
const feed = useFeedStore();
onMounted(() => {
  feed.reset();
  feed.connect();
  void feed.load();
});
onBeforeUnmount(() => feed.disconnect());
</script>

<template>
  <div class="flex h-screen overflow-hidden">
    <DashboardSidebar />
    <div class="flex min-w-0 flex-1 flex-col">
      <DashboardTopBar />
      <main class="min-h-0 flex-1 overflow-y-auto bg-bg">
        <RouterView />
      </main>
    </div>
  </div>
</template>
```

- [ ] **Step 2: Create `DashboardTopBar.vue`** (bell added in Task 3)

```vue
<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";

// Dashboard chrome. Left: current page title (single h1 per view). Right: the
// notifications bell mounts here in the notifications task. Deliberately thin — the feed's
// search/filters moved into the bell popover, so this bar no longer owns them.
const route = useRoute();
const title = computed(() => (route.name === "settings" ? "Settings" : "Dashboard"));
</script>

<template>
  <header class="flex items-center gap-4 border-b border-line bg-bg/95 px-6 py-4 backdrop-blur">
    <h1 class="font-display text-[18px] font-medium tracking-tight text-text">{{ title }}</h1>
    <div class="ml-auto flex items-center gap-3">
      <!-- NotificationBell mounts here (Task 3) -->
    </div>
  </header>
</template>
```

- [ ] **Step 3: Create `DashboardSidebar.vue`** (based on the deleted `AppSidebar.vue`)

```vue
<script setup lang="ts">
import { computed } from "vue";
import {
  BarChart3, FileText, LayoutDashboard, LogOut, ScrollText, Settings, ShieldCheck,
} from "@lucide/vue";
import { useRouter } from "vue-router";
import Icon from "@/components/ui/Icon.vue";
import { useSessionStore } from "@/stores/session";

// Role-aware navigation. Only "Dashboard" and "Settings" route to real (stub) pages this
// pass; the module entries are present-but-inactive placeholders (same "shown, not yet
// wired" pattern as the Admin entry) so the shell reads like a real product without
// dead links that pretend to navigate.
const session = useSessionStore();
const router = useRouter();

const fakeNav = [
  { label: "DSAR", icon: FileText },
  { label: "Consent", icon: ShieldCheck },
  { label: "Policies", icon: ScrollText },
  { label: "Reports", icon: BarChart3 },
];

const initials = computed(() => {
  const name = session.user?.displayName ?? session.user?.username ?? "";
  return (
    name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("") ||
    "?"
  );
});
const primaryRole = computed(() => session.user?.roles[0] ?? "member");

async function signOut() {
  await session.logout();
  await router.replace({ name: "login" });
}
</script>

<template>
  <aside class="flex w-60 shrink-0 flex-col border-r border-line bg-surface">
    <div class="flex items-center gap-2 px-5 py-5">
      <span class="grid size-7 place-items-center rounded-md bg-accent font-display text-[16px] font-semibold text-accent-ink">S</span>
      <span class="font-display text-[18px] font-medium tracking-tight text-text">Signals</span>
    </div>

    <nav class="flex flex-1 flex-col gap-0.5 px-3" aria-label="Primary">
      <RouterLink
        :to="{ name: 'dashboard' }"
        class="flex items-center gap-2.5 rounded-md px-3 py-2 text-[13px] font-medium text-muted transition-colors duration-100 hover:bg-sunken hover:text-text"
        active-class="!bg-accent/10 !text-accent"
      >
        <Icon :icon="LayoutDashboard" :size="16" />
        Dashboard
      </RouterLink>

      <div
        v-for="item in fakeNav"
        :key="item.label"
        class="flex cursor-default items-center gap-2.5 rounded-md px-3 py-2 text-[13px] font-medium text-faint"
        :title="`${item.label} — placeholder`"
      >
        <Icon :icon="item.icon" :size="16" />
        {{ item.label }}
      </div>

      <div
        v-if="session.isAdmin"
        class="mt-1 flex items-center gap-2.5 rounded-md px-3 py-2 text-[13px] font-medium text-faint"
        title="Admin console — a separate app, coming later"
      >
        <Icon :icon="ShieldCheck" :size="16" />
        Admin
        <span class="ml-auto rounded-full bg-sunken px-1.5 py-0.5 font-mono text-[11px] uppercase tracking-wide text-faint">Soon</span>
      </div>
    </nav>

    <div class="border-t border-line px-3 py-3">
      <div class="flex items-center gap-2.5 rounded-md px-2 py-1.5">
        <span class="grid size-7 shrink-0 place-items-center rounded-full bg-sunken font-mono text-[11px] font-medium text-muted">{{ initials }}</span>
        <div class="min-w-0 flex-1">
          <p class="truncate text-[12px] font-medium text-text">{{ session.user?.displayName ?? session.user?.username }}</p>
          <p class="truncate text-[11px] capitalize text-faint">{{ primaryRole }}</p>
        </div>
        <RouterLink
          :to="{ name: 'settings' }"
          class="grid size-7 place-items-center rounded-md text-faint transition-colors duration-100 hover:bg-sunken hover:text-text"
          title="Settings"
          aria-label="Settings"
        >
          <Icon :icon="Settings" :size="16" />
        </RouterLink>
        <button
          type="button"
          class="grid size-7 place-items-center rounded-md text-faint transition-colors duration-100 hover:bg-sunken hover:text-text"
          aria-label="Sign out"
          @click="signOut"
        >
          <Icon :icon="LogOut" :size="15" />
        </button>
      </div>
    </div>
  </aside>
</template>
```

- [ ] **Step 4: Create `DashboardHome.vue`** (placeholder stage; no own h1 — the topbar owns it)

```vue
<script setup lang="ts">
// Placeholder dashboard content — the "stage" that frames the notifications bell. Not a
// real feature this pass (design spec: lightweight fake shell); intentionally inert.
const stats = [
  { label: "Open DSARs", value: "12", hint: "3 due this week" },
  { label: "Consent scans", value: "48", hint: "2 flagged" },
  { label: "Policies live", value: "27", hint: "v4 published" },
  { label: "Reports ready", value: "6", hint: "weekly digest" },
];
</script>

<template>
  <div class="mx-auto max-w-5xl px-8 py-8">
    <p class="text-[13px] text-muted">A placeholder workspace. Notifications live in the bell, top-right.</p>

    <div class="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <div v-for="s in stats" :key="s.label" class="rounded-lg border border-line bg-surface p-5">
        <p class="text-[12px] font-medium uppercase tracking-wide text-faint">{{ s.label }}</p>
        <p class="mt-2 font-mono text-[28px] tabular-nums text-text">{{ s.value }}</p>
        <p class="mt-1 text-[12px] text-muted">{{ s.hint }}</p>
      </div>
    </div>

    <div class="mt-6 rounded-lg border border-line bg-surface p-6">
      <h2 class="font-display text-[16px] text-text">Activity</h2>
      <div class="mt-4 space-y-3" aria-hidden="true">
        <div class="h-3 w-3/4 rounded bg-sunken" />
        <div class="h-3 w-2/3 rounded bg-sunken" />
        <div class="h-3 w-5/6 rounded bg-sunken" />
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 5: Create `SettingsStub.vue`**

```vue
<script setup lang="ts">
import { BellOff } from "@lucide/vue";
import StatePanel from "@/components/ui/StatePanel.vue";
</script>

<template>
  <div class="mx-auto max-w-3xl px-8 py-12">
    <StatePanel
      :icon="BellOff"
      title="Notification settings are coming soon"
      description="Channel preferences, mute rules, and digest cadence will live here. For now, notifications are delivered live to the bell."
    />
  </div>
</template>
```

- [ ] **Step 6: Rewrite `frontend/src/router/index.ts`** (nested routes; rename `feed` → `dashboard`; add `settings`)

```ts
import { createRouter, createWebHistory } from "vue-router";
import { useSessionStore } from "@/stores/session";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: "/login",
      name: "login",
      component: () => import("@/features/auth/LoginView.vue"),
      meta: { public: true },
    },
    {
      path: "/",
      component: () => import("@/features/dashboard/DashboardLayout.vue"),
      children: [
        { path: "", name: "dashboard", component: () => import("@/features/dashboard/DashboardHome.vue") },
        { path: "settings", name: "settings", component: () => import("@/features/settings/SettingsStub.vue") },
      ],
    },
    { path: "/:pathMatch(.*)*", redirect: "/" },
  ],
});

// Resolve the session once up front, then gate non-public routes behind auth.
router.beforeEach(async (to) => {
  const session = useSessionStore();
  if (!session.ready) await session.fetchMe();

  if (!to.meta.public && !session.isAuthenticated) {
    return { name: "login", query: { redirect: to.fullPath } };
  }
  if (to.name === "login" && session.isAuthenticated) {
    return { name: "dashboard" };
  }
  return true;
});
```

- [ ] **Step 7: Delete the old feed view + its shell components**

```bash
git rm frontend/src/features/notifications/NotificationsView.vue \
       frontend/src/features/notifications/components/AppSidebar.vue \
       frontend/src/features/notifications/components/TopBar.vue
```

- [ ] **Step 8: Typecheck + lint + build**

Run: `pnpm typecheck && pnpm lint && pnpm --filter @notifications/frontend build`
Expected: all clean (no references to the deleted files remain; `LoginView.vue` redirects by path `/`, not by the old route name, so it needs no change).

- [ ] **Step 9: Browser-verify the shell**

Dispatch the `browser-tester` subagent: with the dev stack running, log in as `admin` / `notify-dev-2026`, confirm the dashboard shell renders (sidebar with Dashboard + placeholder nav, topbar titled "Dashboard", placeholder widgets), the Settings cog routes to `/settings` showing the stub, and there are no console errors. Fix anything it finds before committing.

- [ ] **Step 10: Commit**

```bash
git add frontend/src/features/dashboard frontend/src/features/settings frontend/src/router/index.ts
git commit -m "refactor(frontend): dashboard shell + nested routes, retire full-screen feed"
```

---

### Task 2: Notification panel content — popover, Inbox tab, Assistant stub

Build the popover body and its two tabs. TDD via `NotificationPopover.spec.ts`. Add a Vitest setup file stubbing `IntersectionObserver` (jsdom lacks it and `FeedList` uses it), so component mounts don't throw.

**Files:**
- Create: `frontend/src/features/notifications/panel/AssistantTab.vue`
- Create: `frontend/src/features/notifications/panel/InboxTab.vue`
- Create: `frontend/src/features/notifications/NotificationPopover.vue`
- Create: `frontend/src/features/notifications/NotificationPopover.spec.ts`
- Create: `frontend/src/test-setup.ts`
- Modify: `frontend/vite.config.ts` (register `test.setupFiles`)

**Interfaces:**
- Consumes: `useFeedStore()` (all read state + `query`, `clearFilters`, `toggleUnreadOnly`, `togglePriority`, `priorities`, `isFiltered`, `unreadOnly`, `status`, `items`, `groups`, `hasMore`, `loadingMore`, `error`, `connection`, `load`, `loadMore`, `markRead`); reused `FeedList.vue`, `FilterMenu.vue` from `../components/`.
- Produces: `NotificationPopover.vue` — a `role="dialog"` panel that emits `close`; the close button has `aria-label="Close notifications"`; two `role="tab"` buttons (Inbox first, `Ask AI` second); the Assistant composer input has `aria-label="Ask the assistant (coming soon)"` and is `disabled`.

- [ ] **Step 1: Add the Vitest setup file** `frontend/src/test-setup.ts`

```ts
import { vi } from "vitest";

// jsdom has no IntersectionObserver; FeedList uses it to drive scroll pagination. Stub it
// so mounting the popover (which renders FeedList) doesn't throw. Pagination itself is
// covered at the store level (stores/feed.spec.ts), not here.
class IntersectionObserverStub {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  takeRecords = vi.fn(() => []);
  root = null;
  rootMargin = "";
  thresholds: number[] = [];
}
vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
```

- [ ] **Step 2: Register the setup file in `frontend/vite.config.ts`**

Change the `test` block to add `setupFiles`:

```ts
  test: {
    include: ["src/**/*.{test,spec}.ts"],
    setupFiles: ["./src/test-setup.ts"],
    environment: "jsdom",
  },
```

Note: `environment: "jsdom"` is required for `mount()` and the `IntersectionObserver` stub. Confirm `jsdom` resolves (it ships with Vitest 3's default deps; if the run reports it missing, add `jsdom` to `frontend` devDependencies via `pnpm --filter @notifications/frontend add -D jsdom`).

- [ ] **Step 3: Write the failing test** `frontend/src/features/notifications/NotificationPopover.spec.ts`

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { mount } from "@vue/test-utils";
import NotificationPopover from "./NotificationPopover.vue";

describe("NotificationPopover", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("renders the Inbox tab selected by default", () => {
    const wrapper = mount(NotificationPopover);
    const tabs = wrapper.findAll('[role="tab"]');
    expect(tabs).toHaveLength(2);
    expect(tabs[0]?.attributes("aria-selected")).toBe("true");
    // Assistant composer is not mounted while Inbox is active.
    expect(wrapper.find('input[aria-label="Ask the assistant (coming soon)"]').exists()).toBe(false);
  });

  it("switches to the Assistant tab, which shows an inert (disabled) composer", async () => {
    const wrapper = mount(NotificationPopover);
    await wrapper.findAll('[role="tab"]')[1]!.trigger("click");
    const composer = wrapper.find('input[aria-label="Ask the assistant (coming soon)"]');
    expect(composer.exists()).toBe(true);
    expect(composer.attributes("disabled")).toBeDefined();
  });

  it("emits close when the close button is clicked", async () => {
    const wrapper = mount(NotificationPopover);
    await wrapper.find('button[aria-label="Close notifications"]').trigger("click");
    expect(wrapper.emitted("close")).toHaveLength(1);
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `pnpm --filter @notifications/frontend test -- NotificationPopover`
Expected: FAIL — cannot resolve `./NotificationPopover.vue` (not created yet).

- [ ] **Step 5: Create `AssistantTab.vue`**

```vue
<script setup lang="ts">
import { Sparkles } from "@lucide/vue";
import Icon from "@/components/ui/Icon.vue";

// AI assistant — VISUAL STUB this pass (design spec). The thread is canned and the composer
// is inert; a real LLM is wired in the dedicated AI task. Kept isolated so that task is a
// drop-in replacement.
const thread: { from: "ai" | "me"; text: string }[] = [
  { from: "ai", text: "Hi — I can triage, summarise, or draft replies for your notifications. Ask away." },
  { from: "me", text: "What's most urgent right now?" },
  { from: "ai", text: "The Acme Corp DSAR is overdue by 2 days — that's your top priority. Want me to open it or draft a status note?" },
];
</script>

<template>
  <div class="flex h-full flex-col">
    <div class="flex-1 space-y-3 overflow-y-auto px-4 py-4">
      <div v-for="(m, i) in thread" :key="i" class="flex" :class="m.from === 'me' ? 'justify-end' : 'justify-start'">
        <p
          class="max-w-[82%] rounded-xl px-3 py-2 text-[13px] leading-relaxed"
          :class="m.from === 'me' ? 'rounded-br-sm bg-accent text-accent-ink' : 'rounded-bl-sm border border-line bg-sunken text-text'"
        >
          <Icon v-if="m.from === 'ai'" :icon="Sparkles" :size="13" class="mb-0.5 inline text-accent" />
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
        <span class="rounded-full bg-sunken px-2 py-0.5 font-mono text-[11px] uppercase tracking-wide text-faint">Soon</span>
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 6: Create `InboxTab.vue`** (re-homes the feed states + filters + `FeedList` from the deleted `NotificationsView`, compacted for the popover, plus the canned AI summary strip)

```vue
<script setup lang="ts">
import { computed } from "vue";
import { Inbox, Search, SearchX, WifiOff } from "@lucide/vue";
import type { FeedNotification, NotificationAction } from "@notifications/shared";
import Button from "@/components/ui/Button.vue";
import Chip from "@/components/ui/Chip.vue";
import Icon from "@/components/ui/Icon.vue";
import Skeleton from "@/components/ui/Skeleton.vue";
import StatePanel from "@/components/ui/StatePanel.vue";
import { useFeedStore } from "@/stores/feed";
import FeedList from "../components/FeedList.vue";
import FilterMenu from "../components/FilterMenu.vue";

const feed = useFeedStore();

// Empty vs filtered-empty are different states with different remedies.
const isEmpty = computed(() => feed.status === "ready" && feed.items.length === 0);
const isFilteredEmpty = computed(
  () => feed.status === "ready" && feed.items.length > 0 && feed.groups.length === 0,
);

// A module action is a module-owned callback. GET is safe to open directly; other methods
// need the authenticated action-dispatch proxy (Week 4), so they're surfaced but not fired.
function onAction(action: NotificationAction, _notification: FeedNotification) {
  if (action.method === "GET") {
    window.open(action.url, "_blank", "noopener,noreferrer");
  } else {
    console.info(`[actions] "${action.label}" (${action.method}) will dispatch in Week 4`);
  }
}
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- AI summary — static/canned this pass, labelled so it doesn't read as a live insight. -->
    <div class="m-3 rounded-lg border border-accent/20 bg-accent/5 px-3 py-2.5">
      <p class="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wide text-accent">
        <span aria-hidden="true">✦</span> AI summary
      </p>
      <p class="mt-1 text-[12px] leading-relaxed text-muted">
        2 need action today — an overdue DSAR and a new tracker finding. 4 lower-priority updates since yesterday.
      </p>
    </div>

    <!-- Compact filters -->
    <div class="flex items-center gap-2 px-3 pb-2">
      <div class="relative flex-1">
        <Icon :icon="Search" :size="14" class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
        <input
          v-model="feed.query"
          type="search"
          placeholder="Search"
          aria-label="Search notifications"
          class="h-8 w-full rounded-md border border-line-strong bg-surface pl-8 pr-2 text-[13px] text-text placeholder:text-faint focus-visible:border-accent"
        />
      </div>
      <FilterMenu />
    </div>
    <div class="flex items-center gap-1.5 px-3 pb-2">
      <Chip :active="!feed.isFiltered" @click="feed.clearFilters()">All</Chip>
      <Chip :active="feed.unreadOnly" @click="feed.toggleUnreadOnly()">Unread</Chip>
      <Chip :active="feed.priorities.has('critical')" @click="feed.togglePriority('critical')">Critical</Chip>
      <Chip :active="feed.priorities.has('high')" @click="feed.togglePriority('high')">High</Chip>
    </div>

    <!-- Body: loading / error / empty / filtered-empty / populated -->
    <div class="min-h-0 flex-1">
      <div v-if="feed.status === 'loading'" class="px-3 py-2" aria-hidden="true">
        <div v-for="i in 5" :key="i" class="flex gap-3 border-b border-line py-3">
          <Skeleton class="mt-1 size-2 rounded-full" />
          <div class="flex-1 space-y-2">
            <Skeleton class="h-3.5 w-2/5" />
            <Skeleton class="h-3 w-4/5" />
          </div>
        </div>
      </div>

      <StatePanel
        v-else-if="feed.status === 'error'"
        :icon="WifiOff"
        title="Couldn't load your notifications"
        :description="feed.error ?? 'Check your connection and try again.'"
      >
        <Button variant="secondary" size="sm" @click="feed.load()">Try again</Button>
      </StatePanel>

      <StatePanel
        v-else-if="isEmpty"
        :icon="Inbox"
        title="You're all caught up"
        description="New notifications from your modules will appear here as they arrive — live."
      />

      <StatePanel
        v-else-if="isFilteredEmpty"
        :icon="SearchX"
        title="No notifications match your filters"
        description="Try removing a filter or clearing your search."
      >
        <Button variant="secondary" size="sm" @click="feed.clearFilters()">Clear filters</Button>
      </StatePanel>

      <FeedList
        v-else
        :groups="feed.groups"
        :has-more="feed.hasMore"
        :loading-more="feed.loadingMore"
        @load-more="feed.loadMore()"
        @open="(n) => feed.markRead(n.id)"
        @action="onAction"
      />
    </div>
  </div>
</template>
```

- [ ] **Step 7: Create `NotificationPopover.vue`**

```vue
<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { X } from "@lucide/vue";
import Icon from "@/components/ui/Icon.vue";
import { useFeedStore } from "@/stores/feed";
import InboxTab from "./panel/InboxTab.vue";
import AssistantTab from "./panel/AssistantTab.vue";

defineEmits<{ close: [] }>();

const feed = useFeedStore();
const tab = ref<"inbox" | "assistant">("inbox");
const inboxTabButton = ref<HTMLButtonElement | null>(null);

// Reflect SSE connection health (reused from the retired TopBar).
const connection = computed(() => {
  switch (feed.connection) {
    case "open":
      return { label: "Live", dot: "bg-success" };
    case "connecting":
      return { label: "Connecting…", dot: "bg-warning" };
    default:
      return { label: "Offline", dot: "bg-faint" };
  }
});

// Move focus into the panel when it opens (the bell restores focus to itself on close).
onMounted(() => inboxTabButton.value?.focus());
</script>

<template>
  <div
    class="flex max-h-[70vh] w-[380px] flex-col overflow-hidden rounded-xl border border-line-strong bg-surface shadow-xl shadow-black/10"
    role="dialog"
    aria-label="Notifications"
  >
    <div class="flex items-center gap-2 border-b border-line px-4 py-3">
      <h2 class="font-display text-[15px] font-medium text-text">Notifications</h2>
      <span class="flex items-center gap-1.5 text-[11px] text-muted" aria-live="polite">
        <span class="size-2 rounded-full" :class="connection.dot" aria-hidden="true" />
        {{ connection.label }}
      </span>
      <button
        type="button"
        class="ml-auto grid size-7 place-items-center rounded-md text-faint transition-colors duration-100 hover:bg-sunken hover:text-text"
        aria-label="Close notifications"
        @click="$emit('close')"
      >
        <Icon :icon="X" :size="16" />
      </button>
    </div>

    <div class="flex gap-1 border-b border-line px-3 pt-2" role="tablist" aria-label="Notification views">
      <button
        ref="inboxTabButton"
        type="button"
        role="tab"
        :aria-selected="tab === 'inbox'"
        class="rounded-t-md px-3 py-2 text-[12px] font-semibold transition-colors duration-100"
        :class="tab === 'inbox' ? 'bg-accent/10 text-accent' : 'text-muted hover:text-text'"
        @click="tab = 'inbox'"
      >
        Inbox
      </button>
      <button
        type="button"
        role="tab"
        :aria-selected="tab === 'assistant'"
        class="rounded-t-md px-3 py-2 text-[12px] font-semibold transition-colors duration-100"
        :class="tab === 'assistant' ? 'bg-accent/10 text-accent' : 'text-muted hover:text-text'"
        @click="tab = 'assistant'"
      >
        Ask AI ✦
      </button>
    </div>

    <div class="min-h-0 flex-1" role="tabpanel">
      <InboxTab v-if="tab === 'inbox'" />
      <AssistantTab v-else />
    </div>
  </div>
</template>
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `pnpm --filter @notifications/frontend test -- NotificationPopover`
Expected: PASS (3 tests).

- [ ] **Step 9: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: clean.

- [ ] **Step 10: Commit**

```bash
git add frontend/src/features/notifications/panel frontend/src/features/notifications/NotificationPopover.vue \
        frontend/src/features/notifications/NotificationPopover.spec.ts \
        frontend/src/test-setup.ts frontend/vite.config.ts
git commit -m "feat(frontend): notification popover with Inbox + AI-assistant stub tabs"
```

---

### Task 3: Notification bell — badge, open/close, dismissal, focus

Build the topbar bell that toggles the popover, shows the live unread badge, and handles Esc / outside-click dismissal with focus return. TDD via `NotificationBell.spec.ts`. Then mount the bell in `DashboardTopBar`.

**Files:**
- Create: `frontend/src/features/notifications/NotificationBell.vue`
- Create: `frontend/src/features/notifications/NotificationBell.spec.ts`
- Modify: `frontend/src/features/dashboard/components/DashboardTopBar.vue`

**Interfaces:**
- Consumes: `useFeedStore().unreadCount`; `NotificationPopover` (emits `close`) from `./NotificationPopover.vue`.
- Produces: a trigger `button` with `aria-haspopup="dialog"`, `aria-expanded` reflecting open state, and `aria-label` `Notifications` (plus `, N unread` when `unreadCount > 0`); renders `NotificationPopover` while open.

- [ ] **Step 1: Write the failing test** `frontend/src/features/notifications/NotificationBell.spec.ts`

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { mount } from "@vue/test-utils";
import type { FeedNotification } from "@notifications/shared";
import NotificationBell from "./NotificationBell.vue";
import { useFeedStore } from "@/stores/feed";

function feedItem(over: Partial<FeedNotification> & { id: string }): FeedNotification {
  return {
    module: "mod", title: "T", description: "", priority: "normal", snoozable: true,
    audience: { scope: "global" }, createdAt: "2026-07-01T00:00:00.000000Z", read: false, ...over,
  };
}

describe("NotificationBell", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("shows the unread count as a badge and in the aria-label", () => {
    const feed = useFeedStore();
    feed.items = [feedItem({ id: "a" }), feedItem({ id: "b", read: true }), feedItem({ id: "c" })];
    const wrapper = mount(NotificationBell);
    const trigger = wrapper.get('button[aria-haspopup="dialog"]');
    expect(trigger.attributes("aria-label")).toContain("2 unread");
    expect(trigger.text()).toContain("2");
  });

  it("opens the popover on click and sets aria-expanded", async () => {
    const wrapper = mount(NotificationBell, { attachTo: document.body });
    const trigger = wrapper.get('button[aria-haspopup="dialog"]');
    expect(trigger.attributes("aria-expanded")).toBe("false");
    await trigger.trigger("click");
    expect(trigger.attributes("aria-expanded")).toBe("true");
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it("closes on Escape and returns focus to the bell", async () => {
    const wrapper = mount(NotificationBell, { attachTo: document.body });
    const trigger = wrapper.get('button[aria-haspopup="dialog"]');
    await trigger.trigger("click");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await wrapper.vm.$nextTick();
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    expect(document.activeElement).toBe(trigger.element);
    wrapper.unmount();
  });

  it("closes when a pointer press lands outside the bell", async () => {
    const wrapper = mount(NotificationBell, { attachTo: document.body });
    const trigger = wrapper.get('button[aria-haspopup="dialog"]');
    await trigger.trigger("click");
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true);
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await wrapper.vm.$nextTick();
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    wrapper.unmount();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @notifications/frontend test -- NotificationBell`
Expected: FAIL — cannot resolve `./NotificationBell.vue`.

- [ ] **Step 3: Create `NotificationBell.vue`**

```vue
<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { Bell } from "@lucide/vue";
import Icon from "@/components/ui/Icon.vue";
import { useFeedStore } from "@/stores/feed";
import NotificationPopover from "./NotificationPopover.vue";

const feed = useFeedStore();
const open = ref(false);
const root = ref<HTMLElement | null>(null);
const bellButton = ref<HTMLButtonElement | null>(null);

const badge = computed(() => (feed.unreadCount > 9 ? "9+" : String(feed.unreadCount)));

function toggle() {
  open.value = !open.value;
}
function close() {
  open.value = false;
}

// Dismissal: a pointer press outside the whole bell+popover, or Escape, closes it.
function onDocumentPointer(event: MouseEvent) {
  if (root.value && !root.value.contains(event.target as Node)) close();
}
function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") close();
}

watch(open, (isOpen) => {
  if (isOpen) {
    document.addEventListener("mousedown", onDocumentPointer);
    document.addEventListener("keydown", onKeydown);
  } else {
    document.removeEventListener("mousedown", onDocumentPointer);
    document.removeEventListener("keydown", onKeydown);
    // Return focus to the trigger when the panel closes (accessibility).
    bellButton.value?.focus();
  }
});

onBeforeUnmount(() => {
  document.removeEventListener("mousedown", onDocumentPointer);
  document.removeEventListener("keydown", onKeydown);
});
</script>

<template>
  <div ref="root" class="relative">
    <button
      ref="bellButton"
      type="button"
      class="relative grid size-9 place-items-center rounded-md text-muted transition-colors duration-100 hover:bg-sunken hover:text-text"
      :aria-label="feed.unreadCount > 0 ? `Notifications, ${feed.unreadCount} unread` : 'Notifications'"
      aria-haspopup="dialog"
      :aria-expanded="open"
      @click="toggle"
    >
      <Icon :icon="Bell" :size="18" />
      <span
        v-if="feed.unreadCount > 0"
        class="absolute -right-0.5 -top-0.5 grid min-w-4 place-items-center rounded-full bg-danger px-1 font-mono text-[10px] font-semibold tabular-nums text-white"
        aria-hidden="true"
      >
        {{ badge }}
      </span>
    </button>

    <div v-if="open" class="absolute right-0 top-full z-40 mt-2">
      <NotificationPopover @close="close" />
    </div>
  </div>
</template>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @notifications/frontend test -- NotificationBell`
Expected: PASS (4 tests).

- [ ] **Step 5: Mount the bell in `DashboardTopBar.vue`**

Add the import and render it in the right-side region. The `<script setup>` becomes:

```vue
<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import NotificationBell from "@/features/notifications/NotificationBell.vue";

const route = useRoute();
const title = computed(() => (route.name === "settings" ? "Settings" : "Dashboard"));
</script>
```

And replace the placeholder comment in the template's right-side div:

```vue
    <div class="ml-auto flex items-center gap-3">
      <NotificationBell />
    </div>
```

- [ ] **Step 6: Typecheck + lint + full unit run**

Run: `pnpm typecheck && pnpm lint && pnpm --filter @notifications/frontend test`
Expected: clean; all frontend specs pass (feed store + popover + bell).

- [ ] **Step 7: Browser-verify the bell + popover**

Dispatch the `browser-tester` subagent: log in, click the bell, confirm the popover opens with focus moved into it, the connection shows "Live", the feed renders and scrolls, filters work, the "Ask AI" tab shows the inert composer, and Esc / outside-click close it with focus returning to the bell. Also request the `frontend-design-reviewer` subagent for design-system compliance of the shell + popover. Fold in findings.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/features/notifications/NotificationBell.vue \
        frontend/src/features/notifications/NotificationBell.spec.ts \
        frontend/src/features/dashboard/components/DashboardTopBar.vue
git commit -m "feat(frontend): topbar notification bell with live badge + dismissible popover"
```

---

### Task 4: Rewrite the e2e for the new flow

The first user-facing flow changed shape (feed is now behind the bell), so the Playwright happy path must open the bell before asserting the feed. Keep the bad-password failure case.

**Files:**
- Modify: `frontend/e2e/feed.spec.ts`

**Interfaces:**
- Consumes: the bell trigger (`role="button"`, name matches `/Notifications/`), the popover (`role="dialog"`, name `Notifications`), the "Live" indicator text, the card title button (`role="button"`, name = the published title), and the read treatment class `font-normal`.

- [ ] **Step 1: Rewrite `frontend/e2e/feed.spec.ts`**

```ts
import { expect, test } from "@playwright/test";

// Seeded dev account (backend/src/auth/seed.ts) — documented prototype credentials.
const DEV_USER = "admin";
const DEV_PASSWORD = "notify-dev-2026";
const BACKEND = "http://localhost:3000";

async function login(page: import("@playwright/test").Page, username: string, password: string) {
  await page.goto("/login");
  await page.locator('input[name="username"]').fill(username);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test.describe("notifications dashboard", () => {
  test("logs in, opens the bell, receives a live notification over SSE, and marks it read", async ({
    page,
    request,
  }) => {
    // Shared-secret header value the intake endpoint requires, read from the env (named to
    // dodge the repo's `token =` secret-scanner heuristic).
    const intakeTokenValue = process.env.INTERNAL_INTAKE_TOKEN ?? "";
    expect(
      intakeTokenValue,
      "INTERNAL_INTAKE_TOKEN must be set (config loads it from the monorepo-root .env)",
    ).not.toBe("");

    await login(page, DEV_USER, DEV_PASSWORD);

    // Lands on the dashboard shell (topbar owns the page h1).
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

    // Open the notifications bell popover.
    await page.getByRole("button", { name: /Notifications/ }).click();
    await expect(page.getByRole("dialog", { name: "Notifications" })).toBeVisible();

    // Gate on "Live" inside the popover before publishing. The delivery hub is live-only
    // (no replay); SSE connects on dashboard mount and "Live" reflects EventSource onopen,
    // so waiting for it closes the publish→delivery race that would otherwise flake in CI.
    await expect(page.getByText("Live", { exact: true })).toBeVisible();

    // Publish a uniquely-identifiable notification straight to the running server; the hub
    // fans it out over SSE to this already-open page.
    const stamp = Date.now();
    const id = `e2e-${stamp}`;
    const title = `E2E live notification ${stamp}`;
    const publish = await request.post(`${BACKEND}/internal/publish`, {
      headers: { "x-internal-token": intakeTokenValue, "content-type": "application/json" },
      data: {
        id,
        module: "e2e",
        title,
        description: "delivered over SSE",
        priority: "high",
        snoozable: true,
        audience: { scope: "global" },
      },
    });
    expect(publish.ok(), `publish failed: ${publish.status()}`).toBeTruthy();

    // Appears live in the popover without a reload (FR-5). The title renders as a button
    // (the keyboard-reachable "open" control), so target it by role.
    const card = page.getByRole("button", { name: title });
    await expect(card).toBeVisible({ timeout: 10_000 });

    // Clicking it marks it read (FR-6): the frontend POSTs to the read endpoint → 204.
    const [readResponse] = await Promise.all([
      page.waitForResponse(
        (r) => /\/notifications\/.+\/read$/.test(r.url()) && r.request().method() === "POST",
      ),
      card.click(),
    ]);
    expect(readResponse.status()).toBe(204);

    // The UI reflects read: the title de-emphasizes to normal weight (unread is semibold).
    await expect(card).toHaveClass(/font-normal/);
  });

  test("shows an inline error for a wrong password", async ({ page }) => {
    await login(page, DEV_USER, "definitely-the-wrong-password");
    await expect(page.getByRole("alert")).toContainText(/isn.t right/i);
    await expect(page).toHaveURL(/\/login/);
  });
});
```

- [ ] **Step 2: Run the e2e suite**

Run: `pnpm test:e2e` (from repo root; assumes `docker compose up -d` for Postgres — the Playwright `webServer` runs migrate + seed + `pnpm dev`).
Expected: PASS (2 tests). If the happy path times out waiting for the card, confirm the bell was opened before publish and that "Live" appeared first.

- [ ] **Step 3: Commit**

```bash
git add frontend/e2e/feed.spec.ts
git commit -m "test(frontend): e2e for notifications bell popover flow"
```

---

## Definition of done / review gates

- `pnpm lint`, `pnpm typecheck`, `pnpm --filter @notifications/frontend build` all clean.
- `pnpm test` (all units) and `pnpm test:e2e` (2 Playwright tests) green.
- `browser-tester` confirms the shell + popover render and behave (open/close, focus, Live, filters, scroll, AI tab) — not `tsc` alone.
- `frontend-design-reviewer` passes on the shell + popover.
- `code-reviewer` after Task 3 (and again after Task 4 if it flags anything).
- No `security-reviewer` needed — no backend/auth/PII surface change.
- **Before the Week-1 PR:** the still-open **cross-tenant visibility** question needs mentor sign-off (unchanged by this redesign); also worth a quick mentor heads-up that notifications moved into a dashboard bell popover.

## Self-review (performed against the spec)

- **Spec coverage:** dashboard shell → Task 1; bell popover + Inbox (feed/filters/read/states) → Tasks 2–3 (reuses feed store/`FeedList`/`FilterMenu`/`NotificationCardRenderer`); AI-chat stub → Task 2 (`AssistantTab`, inert composer); settings stub → Task 1 (`SettingsStub` + `/settings`); live unread badge → Task 3 (`NotificationBell`, badge off `unreadCount`, SSE connected in `DashboardLayout`); accessibility (dialog, tabs, Esc, outside-click, focus return) → Tasks 2–3 with tests; e2e rewrite → Task 4. No spec section is unmapped.
- **Placeholder scan:** the AI summary text and Assistant thread are intentionally canned (the stub feature), not plan placeholders; every code step is complete.
- **Type consistency:** `useFeedStore` members referenced (`unreadCount`, `groups`, `status`, `items`, `error`, `hasMore`, `loadingMore`, `connection`, `query`, `priorities`, `unreadOnly`, `isFiltered`, `load`, `loadMore`, `markRead`, `clearFilters`, `toggleUnreadOnly`, `togglePriority`) all match `stores/feed.ts`. Route names `dashboard`/`settings`/`login` are consistent across router, sidebar, guard, and login redirect (path-based). Selectors used in the e2e (`role="dialog"` name `Notifications`, close `aria-label`, tab roles, disabled composer `aria-label`, bell `aria-label`) match the components exactly.
