<script setup lang="ts">
import { ScrollArea } from '@/components/lib/ui/scroll-area';
import { useModuleLayout } from '../composables/use-module-layout';
const { bounded } = useModuleLayout();
defineOptions({ inheritAttrs: false });
const props = defineProps<{ class?: string }>();
</script>
<template>
  <ScrollArea
    v-bind="$attrs"
    class="-mx-1 min-h-0"
    :class="bounded ? 'flex-1' : 'max-h-96'"
    :viewport-class="
      ['pl-1 pr-3 md:overscroll-contain-if-scrollable', !bounded && 'max-h-96'].filter(Boolean).join(' ')
    "
    data-module-scroll
  >
    <div :class="props.class"><slot /></div>
  </ScrollArea>
</template>
