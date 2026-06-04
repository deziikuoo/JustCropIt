import { ref, watch, onUnmounted, type Ref } from 'vue';
import {
  INITIAL_GRID_MOUNT_BATCH,
  GRID_MOUNT_BATCH_SIZE,
} from '../constants/optimization';
import { scheduleIdleTask } from '../utils/scheduler';

export function useBatchedGridMount(
  totalCount: Ref<number>,
  virtualScrollEnabled: Ref<boolean>
) {
  const mountedDisplayCount = ref(
    Math.min(INITIAL_GRID_MOUNT_BATCH, totalCount.value)
  );
  let idleHandle: number | null = null;

  const cancelPendingMount = () => {
    if (idleHandle !== null && typeof window !== 'undefined') {
      if ('cancelIdleCallback' in window) {
        (window as Window & { cancelIdleCallback: (id: number) => void }).cancelIdleCallback(
          idleHandle
        );
      } else {
        clearTimeout(idleHandle);
      }
      idleHandle = null;
    }
  };

  const scheduleMountBatch = () => {
    if (virtualScrollEnabled.value) return;
    if (mountedDisplayCount.value >= totalCount.value) return;

    cancelPendingMount();
    idleHandle = scheduleIdleTask(() => {
      idleHandle = null;
      if (virtualScrollEnabled.value) return;

      mountedDisplayCount.value = Math.min(
        mountedDisplayCount.value + GRID_MOUNT_BATCH_SIZE,
        totalCount.value
      );

      if (mountedDisplayCount.value < totalCount.value) {
        scheduleMountBatch();
      }
    }, { timeout: 2000 });
  };

  watch(
    totalCount,
    (count, prevCount) => {
      if (virtualScrollEnabled.value) {
        mountedDisplayCount.value = count;
        return;
      }

      if (count < (prevCount ?? count)) {
        mountedDisplayCount.value = Math.min(mountedDisplayCount.value, count);
        cancelPendingMount();
        return;
      }

      if (count === 0) {
        mountedDisplayCount.value = 0;
        cancelPendingMount();
        return;
      }

      if (mountedDisplayCount.value === 0) {
        mountedDisplayCount.value = Math.min(INITIAL_GRID_MOUNT_BATCH, count);
      }

      if (mountedDisplayCount.value < count) {
        scheduleMountBatch();
      }
    },
    { immediate: true }
  );

  watch(virtualScrollEnabled, (enabled) => {
    if (enabled) {
      cancelPendingMount();
      mountedDisplayCount.value = totalCount.value;
    } else {
      mountedDisplayCount.value = Math.min(
        Math.max(mountedDisplayCount.value, INITIAL_GRID_MOUNT_BATCH),
        totalCount.value
      );
      scheduleMountBatch();
    }
  });

  onUnmounted(cancelPendingMount);

  return { mountedDisplayCount };
}
