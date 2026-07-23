<script setup lang="ts">
import { BellOff } from "@lucide/vue";
import { StatePanel } from "@notifications/vue";
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
