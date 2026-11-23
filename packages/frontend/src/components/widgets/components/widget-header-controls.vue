<script setup lang="ts">
import { inject, type Ref } from 'vue';
const target = inject<Ref<HTMLElement | null> | null>('widget-header-controls', null);
</script>
<template>
  <Teleport v-if="target" :to="target"><slot /></Teleport><slot v-else />
</template>
