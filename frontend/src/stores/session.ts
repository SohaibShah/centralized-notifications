import { computed, ref } from "vue";
import { defineStore } from "pinia";
import { api } from "@/api/client";

export interface SessionUser {
  id: string;
  username: string;
  displayName?: string;
  roles: string[];
  teamIds: string[];
}

export const useSessionStore = defineStore("session", () => {
  const user = ref<SessionUser | null>(null);
  // Whether we've attempted to resolve the session at least once (so the router guard
  // doesn't bounce to /login before the first /auth/me completes).
  const ready = ref(false);

  const isAuthenticated = computed(() => user.value !== null);
  const isAdmin = computed(() => user.value?.roles.includes("admin") ?? false);

  async function fetchMe(): Promise<void> {
    try {
      const res = await api.get<{ user: SessionUser }>("/auth/me");
      user.value = res.user;
    } catch {
      user.value = null;
    } finally {
      ready.value = true;
    }
  }

  async function login(username: string, password: string): Promise<void> {
    const res = await api.post<{ user: SessionUser }>("/auth/login", { username, password });
    user.value = res.user;
  }

  async function logout(): Promise<void> {
    await api.post("/auth/logout");
    user.value = null;
  }

  return { user, ready, isAuthenticated, isAdmin, fetchMe, login, logout };
});
