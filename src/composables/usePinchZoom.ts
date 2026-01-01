import { ref, computed, nextTick, type Ref } from "vue";
import { useThrottleFn } from "@vueuse/core";

/**
 * Composable for pinch-to-zoom gesture detection
 * @param onScaleChange - Callback function called when scale changes (receives scale: number)
 * @param containerRef - Optional ref to container element (if not provided, uses document.body)
 * @param options - Configuration options
 * @returns Object with currentScale ref, isPinching state, and cleanup function
 */
export function usePinchZoom(
  onScaleChange: (scale: number) => void,
  containerRef?: Ref<HTMLElement | undefined>,
  options: {
    minScale?: number;
    maxScale?: number;
  } = {}
) {
  const { minScale = 0.5, maxScale = 2.0 } = options;
  const initialDistance = ref<number | null>(null);
  const initialScale = ref(1);
  const currentScale = ref(1);
  const isPinching = ref(false);

  const getDistance = (touches: TouchList): number => {
    if (touches.length < 2) return 0;
    const [touch1, touch2] = Array.from(touches);
    const dx = touch2.clientX - touch1.clientX;
    const dy = touch2.clientY - touch1.clientY;
    return Math.hypot(dx, dy);
  };

  // Throttle scale updates for smoother, more responsive updates (150ms interval)
  const throttledScaleUpdate = useThrottleFn((scale: number) => {
    onScaleChange(scale);
  }, 150);

  const handleTouchStart = (event: TouchEvent) => {
    if (event.touches.length === 2) {
      isPinching.value = true;
      initialDistance.value = getDistance(event.touches);
      initialScale.value = currentScale.value;
      event.preventDefault(); // Prevent default browser pinch zoom
    }
  };

  const handleTouchMove = (event: TouchEvent) => {
    if (event.touches.length === 2 && initialDistance.value !== null && isPinching.value) {
      const currentDistance = getDistance(event.touches);
      if (initialDistance.value > 0) {
        const scale = (currentDistance / initialDistance.value) * initialScale.value;
        const clampedScale = Math.max(minScale, Math.min(maxScale, scale));
        
        currentScale.value = clampedScale;
        throttledScaleUpdate(clampedScale);
      }
      event.preventDefault(); // Prevent default browser pinch zoom
    }
  };

  const handleTouchEnd = (event: TouchEvent) => {
    // Only reset if we're no longer pinching (less than 2 touches)
    if (event.touches.length < 2) {
      isPinching.value = false;
      initialDistance.value = null;
    }
  };

  const handleTouchCancel = () => {
    isPinching.value = false;
    initialDistance.value = null;
  };

  let element: HTMLElement | null = null;
  let cleanup: (() => void) | null = null;

  // Setup event listeners immediately
  nextTick(() => {
    element = containerRef?.value || document.body;
    
    if (element) {
      element.addEventListener("touchstart", handleTouchStart, { passive: false });
      element.addEventListener("touchmove", handleTouchMove, { passive: false });
      element.addEventListener("touchend", handleTouchEnd, { passive: true });
      element.addEventListener("touchcancel", handleTouchCancel, { passive: true });
      
      cleanup = () => {
        if (element) {
          element.removeEventListener("touchstart", handleTouchStart);
          element.removeEventListener("touchmove", handleTouchMove);
          element.removeEventListener("touchend", handleTouchEnd);
          element.removeEventListener("touchcancel", handleTouchCancel);
        }
      };
    }
  });

  return {
    currentScale,
    isPinching: computed(() => isPinching.value),
    cleanup: () => {
      if (cleanup) {
        cleanup();
        cleanup = null;
      }
    },
    resetScale: () => {
      currentScale.value = 1;
      initialScale.value = 1;
    },
    setInitialScale: (scale: number) => {
      currentScale.value = scale;
      initialScale.value = scale;
    },
  };
}

