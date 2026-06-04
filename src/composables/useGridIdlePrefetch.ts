import { ref, watch, onUnmounted, type Ref } from 'vue';
import type { Photo } from '../types/photo';
import type { GridUrlCache } from '../utils/gridUrlCache';
import { VIEWABILITY_THROTTLE_MS } from '../constants/optimization';
import { computePrefetchIndices } from '../utils/gridPrefetchIndices';
import { warmThumbnailUrl } from '../utils/gridUrlWarm';
import { scheduleIdleTask } from '../utils/scheduler';

const PREFETCH_CHUNK_SIZE = 4;
const PREFETCH_CHUNK_THRESHOLD = 8;

export interface UseGridIdlePrefetchOptions {
  photos: Ref<Photo[]>;
  visibleIndices: Ref<ReadonlySet<number>>;
  urlCache: GridUrlCache;
  totalCount: Ref<number>;
}

function cancelScheduledHandle(handle: number | null): void {
  if (handle === null || typeof window === 'undefined') {
    return;
  }

  if ('cancelIdleCallback' in window) {
    (window as Window & { cancelIdleCallback: (id: number) => void }).cancelIdleCallback(
      handle
    );
  } else {
    clearTimeout(handle);
  }
}

export function useGridIdlePrefetch(options: UseGridIdlePrefetchOptions): {
  cancelPrefetch: () => void;
  prefetchPending: Ref<boolean>;
} {
  const prefetchPending = ref(false);
  let prefetchGeneration = 0;
  let throttleTimer: ReturnType<typeof setTimeout> | null = null;
  let idleHandle: number | null = null;
  let pendingIndices: number[] = [];

  const cancelPrefetch = () => {
    prefetchGeneration += 1;

    if (throttleTimer !== null) {
      clearTimeout(throttleTimer);
      throttleTimer = null;
    }

    cancelScheduledHandle(idleHandle);
    idleHandle = null;
    pendingIndices = [];
    prefetchPending.value = false;
  };

  const warmIndices = (indices: number[], generation: number): number => {
    let warmed = 0;

    for (const index of indices) {
      if (generation !== prefetchGeneration) {
        break;
      }

      const photo = options.photos.value[index];
      if (!photo) continue;

      if (warmThumbnailUrl(options.urlCache, photo)) {
        warmed += 1;
      }
    }

    return warmed;
  };

  const schedulePrefetchChunk = (generation: number) => {
    if (generation !== prefetchGeneration) {
      return;
    }

    if (pendingIndices.length === 0) {
      prefetchPending.value = false;
      return;
    }

    prefetchPending.value = true;
    idleHandle = scheduleIdleTask(() => {
      idleHandle = null;

      if (generation !== prefetchGeneration) {
        prefetchPending.value = false;
        return;
      }

      const chunk = pendingIndices.splice(0, PREFETCH_CHUNK_SIZE);
      warmIndices(chunk, generation);

      if (pendingIndices.length > 0 && generation === prefetchGeneration) {
        schedulePrefetchChunk(generation);
      } else {
        prefetchPending.value = false;
      }
    }, { timeout: 2000 });
  };

  const runPrefetch = (generation: number) => {
    if (generation !== prefetchGeneration) {
      return;
    }

    cancelScheduledHandle(idleHandle);
    idleHandle = null;
    pendingIndices = [];

    const indices = computePrefetchIndices(
      options.visibleIndices.value,
      options.totalCount.value
    );

    if (indices.length === 0) {
      prefetchPending.value = false;
      return;
    }

    if (indices.length <= PREFETCH_CHUNK_THRESHOLD) {
      prefetchPending.value = true;
      idleHandle = scheduleIdleTask(() => {
        idleHandle = null;

        if (generation !== prefetchGeneration) {
          prefetchPending.value = false;
          return;
        }

        warmIndices(indices, generation);
        prefetchPending.value = false;
      }, { timeout: 2000 });
      return;
    }

    pendingIndices = [...indices];
    schedulePrefetchChunk(generation);
  };

  const schedulePrefetchAfterSettle = () => {
    cancelPrefetch();
    const generation = prefetchGeneration;

    throttleTimer = setTimeout(() => {
      throttleTimer = null;

      if (generation !== prefetchGeneration) {
        return;
      }

      runPrefetch(generation);
    }, VIEWABILITY_THROTTLE_MS);
  };

  watch(
    () => options.visibleIndices.value,
    () => {
      schedulePrefetchAfterSettle();
    },
    { flush: 'post', deep: true }
  );

  watch(
    () => options.totalCount.value,
    () => {
      schedulePrefetchAfterSettle();
    }
  );

  onUnmounted(cancelPrefetch);

  return {
    cancelPrefetch,
    prefetchPending,
  };
}
