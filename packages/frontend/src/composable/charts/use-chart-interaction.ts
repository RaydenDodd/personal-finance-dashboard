import { useEventListener } from '@vueuse/core';
import { type Ref } from 'vue';

/** Shared chart selection lifetime. A tap may inspect; a scroll must always navigate. */
export function useChartInteraction({
  containerRef,
  tooltipRef,
  clear,
}: {
  containerRef: Ref<HTMLElement | null>;
  tooltipRef?: Ref<HTMLElement | null>;
  clear: () => void;
}) {
  let touch: { x: number; y: number } | null = null;
  let scrolling = false;
  let suppressUntil = 0;
  const contains = (target: EventTarget | null) =>
    target instanceof Node && (containerRef.value?.contains(target) || tooltipRef?.value?.contains(target));
  const dismiss = () => clear();
  useEventListener(
    document,
    'pointerdown',
    (event: PointerEvent) => {
      if (!contains(event.target)) dismiss();
      if (event.pointerType === 'touch') {
        touch = { x: event.clientX, y: event.clientY };
        scrolling = false;
        suppressUntil = 0;
      }
    },
    { capture: true, passive: true },
  );
  useEventListener(
    document,
    'pointermove',
    (event: PointerEvent) => {
      if (event.pointerType !== 'touch' || !touch) return;
      const dx = Math.abs(event.clientX - touch.x),
        dy = Math.abs(event.clientY - touch.y);
      if (dy > 8 && dy >= dx) {
        scrolling = true;
        suppressUntil = performance.now() + 700;
        dismiss();
      }
    },
    { capture: true, passive: true },
  );
  const finish = () => {
    touch = null;
    if (scrolling) dismiss();
  };
  useEventListener(document, 'pointerup', finish, { capture: true, passive: true });
  useEventListener(
    document,
    'pointercancel',
    () => {
      finish();
      dismiss();
    },
    { capture: true, passive: true },
  );
  useEventListener(document, 'scroll', dismiss, { capture: true, passive: true });
  useEventListener(window, 'resize', dismiss, { passive: true });
  useEventListener(window, 'blur', dismiss);
  useEventListener(document, 'keydown', (event: KeyboardEvent) => {
    if (event.key === 'Escape') dismiss();
  });
  return { dismiss, isScrolling: () => (scrolling && touch !== null) || performance.now() < suppressUntil };
}
