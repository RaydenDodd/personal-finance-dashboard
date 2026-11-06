import { useDebounce, useMediaQuery, useWindowSize } from '@vueuse/core';
import { ComputedRef, computed } from 'vue';

interface Options {
  wait?: number; // Debounce wait time (default: 300ms)
  direction?: 'up' | 'down'; // "down" for <=, "up" for >= (default: "down")
}

export const CUSTOM_BREAKPOINTS = Object.freeze({
  uiMobile: 767,
  uiDesktop: 1024,
});

type Breakpoint = number | (typeof CUSTOM_BREAKPOINTS)[keyof typeof CUSTOM_BREAKPOINTS];

export function useWindowBreakpoints(size: Breakpoint, options?: Options): ComputedRef<boolean>;
export function useWindowBreakpoints(size: Breakpoint[], options?: Options): ComputedRef<boolean[]>;

export function useWindowBreakpoints(
  size: Breakpoint | Breakpoint[],
  options: Options = {},
): ComputedRef<boolean | boolean[]> {
  const { wait = 300, direction = 'down' } = options;
  const { width: windowWidth } = useWindowSize();
  const debouncedWindowWidth = useDebounce(windowWidth, wait);
  // A rotated iPhone is wider than the desktop breakpoint but still needs the
  // touch layout. Other desktop/tablet breakpoint comparisons stay unchanged.
  const isTouchLandscape = useMediaQuery('(pointer: coarse) and (max-width: 1000px) and (max-height: 500px)');
  const matches = (breakpoint: Breakpoint) =>
    direction === 'down'
      ? debouncedWindowWidth.value <= breakpoint ||
        (breakpoint === CUSTOM_BREAKPOINTS.uiMobile && isTouchLandscape.value)
      : debouncedWindowWidth.value >= breakpoint;

  const isExpectedSize = computed(() => {
    if (Array.isArray(size)) {
      return size.map(matches);
    }

    return matches(size);
  });

  return isExpectedSize;
}
