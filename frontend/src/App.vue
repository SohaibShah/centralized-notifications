<script setup lang="ts">
// Root shell: the router renders either the login screen or the notifications feed.
// Session bootstrapping + the route guard live in router/index.ts + stores/session.ts.
</script>

<template>
  <RouterView />
</template>
