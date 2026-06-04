import { computed, type Ref } from 'vue';
import { getVirtualScrollPhotoThreshold } from '../constants/optimization';

/**
 * Resolves the photo count at which virtual scrolling activates for the current viewport.
 * Pass a ref from useMediaQuery('(max-width: 480px)') to stay aligned with PhotoGrid layout.
 */
export function useVirtualScrollThreshold(isMobileViewport: Ref<boolean>) {
  const threshold = computed(() =>
    getVirtualScrollPhotoThreshold(isMobileViewport.value)
  );

  const isVirtualScrollEnabled = (photoCount: number) =>
    photoCount >= threshold.value;

  return { threshold, isVirtualScrollEnabled };
}
