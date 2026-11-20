<script lang="ts" setup>
import { CHART_TOOLTIP_SIZING_CLASS, CHART_TOOLTIP_SURFACE_CLASS } from '@/components/common/charts/chart-tooltip';
import * as Popover from '@/components/lib/ui/popover';
import * as Tooltip from '@/components/lib/ui/tooltip';
import { cn } from '@/lib/utils';
import { createReusableTemplate, useMediaQuery } from '@vueuse/core';
import { computed, ref } from 'vue';
import { useChartInteraction } from '@/composable/charts/use-chart-interaction';

defineOptions({ inheritAttrs: false });

const [UseTemplate, SlotContent] = createReusableTemplate();
// Detect touch-primary devices (coarse pointer = finger/stylus)
const isTouch = useMediaQuery('(pointer: coarse)');
const triggerRef = ref<HTMLElement | null>(null),
  contentRef = ref<HTMLElement | null>(null),
  open = ref(false);
useChartInteraction({
  containerRef: triggerRef,
  tooltipRef: contentRef,
  clear: () => {
    if (props.variant === 'chart') open.value = false;
  },
});

const props = withDefaults(
  defineProps<{
    content?: string;
    contentClassName?: string;
    delayDuration?: number;
    disabled?: boolean;
    /** `chart` swaps the popover surface for the shared chart-tooltip one, for data readouts. */
    variant?: 'default' | 'chart';
  }>(),
  { delayDuration: 300, variant: 'default' },
);

const contentClass = computed(() =>
  cn(props.variant === 'chart' && [CHART_TOOLTIP_SURFACE_CLASS, CHART_TOOLTIP_SIZING_CLASS], props.contentClassName),
);
</script>

<template>
  <span ref="triggerRef" class="contents">
    <UseTemplate>
      <slot name="content">
        {{ content }}
      </slot>
    </UseTemplate>

    <slot v-if="disabled" />

    <!-- Touch devices: Popover (tap to open) -->
    <template v-else-if="isTouch">
      <Popover.Popover v-model:open="open">
        <Popover.PopoverTrigger as-child :class="$attrs.class">
          <slot />
        </Popover.PopoverTrigger>

        <Popover.PopoverContent :class="cn('w-max max-w-62.5 p-2 text-sm', contentClass)">
          <div ref="contentRef"><SlotContent /></div>
        </Popover.PopoverContent>
      </Popover.Popover>
    </template>

    <!-- Non-touch devices: Tooltip (hover to show) -->
    <template v-else>
      <Tooltip.TooltipProvider :delay-duration="delayDuration">
        <Tooltip.Tooltip>
          <Tooltip.TooltipTrigger as-child :class="$attrs.class">
            <slot />
          </Tooltip.TooltipTrigger>

          <Tooltip.TooltipContent :class="contentClass">
            <SlotContent />
          </Tooltip.TooltipContent>
        </Tooltip.Tooltip>
      </Tooltip.TooltipProvider>
    </template>
  </span>
</template>
