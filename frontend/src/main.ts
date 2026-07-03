import { createApp } from "vue";
import { SHARED_PACKAGE } from "@notifications/shared";
import App from "./App.vue";

// Referencing the shared package here proves the @notifications/shared workspace
// link resolves from the frontend too. The real contract-driven UI (design tokens,
// FormRenderer, virtualized live feed) arrives in later Week 1 tasks.
console.info(`notifications frontend wired to ${SHARED_PACKAGE}`);

createApp(App).mount("#app");
