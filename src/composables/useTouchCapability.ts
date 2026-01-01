import { computed } from "vue";

/**
 * Composable to detect if the device has touch capability
 * Uses feature detection (not user agent sniffing)
 * @returns Computed ref indicating if touch is available
 */
export function useTouchCapability() {
  const detectTouch = (): boolean => {
    if (typeof window === "undefined") {
      return false;
    }

    // Check for touch event support
    const hasTouchEvents =
      "ontouchstart" in window ||
      navigator.maxTouchPoints > 0 ||
      // @ts-ignore - Legacy IE support
      (navigator.msMaxTouchPoints && navigator.msMaxTouchPoints > 0);

    return hasTouchEvents;
  };

  // Return computed ref that synchronously detects touch capability
  return computed(() => detectTouch());
}

