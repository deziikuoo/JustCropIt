import {
  ref,
  watch,
  nextTick,
  onUnmounted,
  readonly,
  type Ref,
  type DeepReadonly,
} from 'vue';
import {
  VIEWABILITY_THROTTLE_MS,
  VIEWABILITY_ROOT_MARGIN,
} from '../constants/optimization';

export interface UseGridViewabilityOptions {
  totalCount: Ref<number>;
  virtualScrollEnabled: Ref<boolean>;
  visibleRange: Ref<{ start: number; end: number }>;
  containerRef: Ref<HTMLElement | null | undefined>;
  photoCardRefs: Ref<Map<number, HTMLElement>>;
}

export function useGridViewability(options: UseGridViewabilityOptions): {
  visibleIndices: DeepReadonly<Ref<Set<number>>>;
  stop: () => void;
} {
  const visibleIndices = ref<Set<number>>(new Set());
  const rawIndices = new Set<number>();
  let throttleTimer: ReturnType<typeof setTimeout> | null = null;
  let intersectionObserver: IntersectionObserver | null = null;
  const observedElements = new Map<number, HTMLElement>();

  const applyVisibleIndices = () => {
    visibleIndices.value = new Set(rawIndices);
  };

  const flushThrottled = () => {
    if (rawIndices.size === 0) {
      if (throttleTimer) {
        clearTimeout(throttleTimer);
        throttleTimer = null;
      }
      applyVisibleIndices();
      return;
    }

    if (throttleTimer) return;

    throttleTimer = setTimeout(() => {
      throttleTimer = null;
      applyVisibleIndices();
    }, VIEWABILITY_THROTTLE_MS);
  };

  const applyRangeIndices = (start: number, end: number) => {
    rawIndices.clear();
    for (let i = start; i < end; i++) {
      if (i >= 0 && i < options.totalCount.value) {
        rawIndices.add(i);
      }
    }
    flushThrottled();
  };

  const ensureIntersectionObserver = () => {
    if (intersectionObserver || typeof IntersectionObserver === 'undefined') {
      return;
    }

    intersectionObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const indexAttr = (entry.target as HTMLElement).getAttribute(
            'data-photo-index'
          );
          if (indexAttr === null) continue;
          const index = parseInt(indexAttr, 10);
          if (Number.isNaN(index)) continue;

          if (entry.isIntersecting) {
            rawIndices.add(index);
          } else {
            rawIndices.delete(index);
          }
        }
        flushThrottled();
      },
      { rootMargin: VIEWABILITY_ROOT_MARGIN, threshold: 0.01 }
    );
  };

  const teardownIntersectionObserver = () => {
    if (intersectionObserver) {
      intersectionObserver.disconnect();
      intersectionObserver = null;
    }
    observedElements.clear();
  };

  const syncCardObservers = () => {
    if (options.virtualScrollEnabled.value) {
      return;
    }

    ensureIntersectionObserver();
    if (!intersectionObserver) return;

    const observer = intersectionObserver;
    const cardRefs = options.photoCardRefs.value;

    for (const [index, element] of observedElements) {
      if (!cardRefs.has(index)) {
        observer.unobserve(element);
        observedElements.delete(index);
        rawIndices.delete(index);
      }
    }

    for (const [index, element] of cardRefs) {
      if (observedElements.has(index)) continue;
      observer.observe(element);
      observedElements.set(index, element);
      rawIndices.add(index);
    }

    if (rawIndices.size === 0 && observedElements.size > 0) {
      for (const index of observedElements.keys()) {
        rawIndices.add(index);
      }
    }

    flushThrottled();
  };

  watch(
    () =>
      [options.virtualScrollEnabled.value, options.visibleRange.value] as const,
    ([enabled, range], previous) => {
      if (enabled) {
        teardownIntersectionObserver();
        applyRangeIndices(range.start, range.end);
        return;
      }

      const wasVirtual = previous?.[0] === true;
      if (wasVirtual) {
        rawIndices.clear();
        applyVisibleIndices();
      }
      nextTick(() => syncCardObservers());
    },
    { immediate: true, deep: true }
  );

  watch(
    () => options.photoCardRefs.value.size,
    () => {
      if (options.virtualScrollEnabled.value) return;
      nextTick(() => syncCardObservers());
    },
    { flush: 'post' }
  );

  watch(
    () => options.totalCount.value,
    () => {
      for (const index of [...rawIndices]) {
        if (index >= options.totalCount.value) {
          rawIndices.delete(index);
        }
      }

      if (options.virtualScrollEnabled.value) {
        applyRangeIndices(
          options.visibleRange.value.start,
          options.visibleRange.value.end
        );
      } else {
        flushThrottled();
      }
    }
  );

  const stop = () => {
    if (throttleTimer) {
      clearTimeout(throttleTimer);
      throttleTimer = null;
    }
    teardownIntersectionObserver();
    rawIndices.clear();
    visibleIndices.value = new Set();
  };

  onUnmounted(stop);

  return {
    visibleIndices: readonly(visibleIndices),
    stop,
  };
}
