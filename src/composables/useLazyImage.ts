import { ref, type Ref } from "vue";
import { useIntersectionObserver, type MaybeElement } from "@vueuse/core";

/**
 * Composable for lazy loading images using Intersection Observer
 * @param target - Template ref to the element to observe
 * @param rootMargin - Margin around the root (viewport) to trigger loading. Default: '300px'
 * @returns Object with isVisible ref and stop function
 */
export function useLazyImage(
  target: Ref<HTMLElement | null | undefined>,
  rootMargin: string = "300px"
): { isVisible: Ref<boolean>; stop: () => void } {
  const isVisible = ref(false);

  const { stop } = useIntersectionObserver(
    target,
    ([{ isIntersecting }]) => {
      if (isIntersecting) {
        isVisible.value = true;
        // Stop observing once visible to improve performance
        stop();
      }
    },
    {
      rootMargin,
      threshold: 0.01,
    }
  );

  return { isVisible, stop };
}

