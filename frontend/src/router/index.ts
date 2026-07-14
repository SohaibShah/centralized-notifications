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
        {
          path: "",
          name: "dashboard",
          component: () => import("@/features/dashboard/DashboardHome.vue"),
        },
        {
          path: "settings",
          name: "settings",
          component: () => import("@/features/settings/SettingsStub.vue"),
        },
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
