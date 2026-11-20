import { nextTick, type Ref } from 'vue';

import { useChartInteraction } from './use-chart-interaction';

interface TooltipPosition {
  x: number;
  y: number;
}

/**
 * Composable that provides tooltip positioning logic for chart components.
 * Ensures tooltips stay within viewport boundaries by flipping position
 * when they would overflow screen edges.
 *
 * @param strategy - 'absolute' positions relative to containerRef (default),
 *   'fixed' positions relative to the viewport (use when container has overflow clipping).
 */
export function useChartTooltipPosition({
  containerRef,
  tooltipRef,
  tooltip,
  strategy = 'absolute',
  onDismiss,
}: {
  containerRef: Ref<HTMLElement | null>;
  tooltipRef: Ref<HTMLElement | null>;
  tooltip: TooltipPosition & { visible?: boolean };
  strategy?: 'absolute' | 'fixed';
  onDismiss?: () => void;
}) {
  let activeTarget: EventTarget | null = null;
  const interaction = useChartInteraction({
    containerRef,
    tooltipRef,
    clear: () => {
      const wasActive = tooltip.visible === true || activeTarget !== null;
      if ('visible' in tooltip) tooltip.visible = false;
      // Reset each chart's own hover dot/line/segment through its existing leave handler.
      // Store the overlay, not event.currentTarget after the native event has returned.
      if (activeTarget instanceof Element) {
        activeTarget.dispatchEvent(new MouseEvent('mouseleave'));
        activeTarget.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' }));
      }
      activeTarget = null;
      if (wasActive) onDismiss?.();
    },
  });
  function updateTooltipPosition(
    event: MouseEvent | { clientX: number; clientY: number },
    { allowRetry = true }: { allowRetry?: boolean } = {},
  ) {
    if (event instanceof Event) activeTarget = event.currentTarget ?? event.target;
    if (interaction.isScrolling()) {
      interaction.dismiss();
      return;
    }
    if (!containerRef.value || !tooltipRef.value) return;

    const tooltipRect = tooltipRef.value.getBoundingClientRect();

    // On the first show `tooltip.visible` has only just flipped to true, so
    // Vue hasn't re-run `v-show` yet and the element is still `display:none`,
    // which measures 0×0. Positioning against a zero-width box skips the
    // edge-flip and drops the tooltip off-screen on the first tap. Wait one
    // tick for layout, then measure for real.
    if (allowRetry && tooltipRect.width === 0 && tooltipRect.height === 0) {
      nextTick(() => updateTooltipPosition(event, { allowRetry: false }));
      return;
    }

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    const containerRect = containerRef.value.getBoundingClientRect();
    const originX = strategy === 'fixed' ? 0 : containerRect.left;
    const originY = strategy === 'fixed' ? 0 : containerRect.top;

    let x = event.clientX - originX + 10;
    let y = event.clientY - originY - 10;

    if (originX + x + tooltipRect.width > viewportWidth) {
      x = event.clientX - originX - tooltipRect.width - 10;
    }
    if (originX + x < 0) {
      x = -originX + 10;
    }

    if (originY + y + tooltipRect.height > viewportHeight) {
      y = event.clientY - originY - tooltipRect.height - 10;
    }
    // Clamp viewport coordinates before converting back to container space.
    x = Math.max(8 - originX, Math.min(x, viewportWidth - tooltipRect.width - 8 - originX));
    y = Math.max(8 - originY, Math.min(y, viewportHeight - tooltipRect.height - 8 - originY));

    tooltip.x = x;
    tooltip.y = y;
  }

  return { updateTooltipPosition, dismissTooltip: interaction.dismiss, isChartScrolling: interaction.isScrolling };
}
