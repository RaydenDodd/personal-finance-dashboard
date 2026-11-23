<script setup lang="ts">
import { Button } from '@/components/lib/ui/button';
import WidgetWrapper from './widget-wrapper.vue';
const reload = () => window.location.reload();
</script>
<template>
  <WidgetWrapper
    ><template #title>Widget unavailable</template>
    <div class="flex min-h-40 flex-col items-center justify-center gap-3">
      <p class="text-muted-foreground text-xs">The widget could not be downloaded.</p>
      <Button variant="outline" size="sm" @click="reload">Reload widgets</Button>
    </div></WidgetWrapper
  >
</template>
