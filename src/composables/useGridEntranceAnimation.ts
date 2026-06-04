import { ref, watch, type Ref } from 'vue';
import type { Photo } from '../types/photo';
import {
  GRID_ENTRANCE_ANIMATION_CAP,
  GRID_ENTRANCE_STAGGER_MS,
} from '../constants/optimization';

export function useGridEntranceAnimation(photos: Ref<Photo[]>) {
  const entranceIndices = ref(new Set<number>());
  const entranceSlotByIndex = ref(new Map<number, number>());

  watch(
    () => photos.value.length,
    (length, prevLength) => {
      const previous = prevLength ?? 0;
      if (length <= previous) {
        if (length < previous) {
          const nextIndices = new Set<number>();
          const nextSlots = new Map<number, number>();
          for (const index of entranceIndices.value) {
            if (index < length) {
              nextIndices.add(index);
              const slot = entranceSlotByIndex.value.get(index);
              if (slot !== undefined) {
                nextSlots.set(index, slot);
              }
            }
          }
          entranceIndices.value = nextIndices;
          entranceSlotByIndex.value = nextSlots;
        }
        return;
      }

      const delta = length - previous;
      const animateCount = Math.min(delta, GRID_ENTRANCE_ANIMATION_CAP);
      const nextIndices = new Set(entranceIndices.value);
      const nextSlots = new Map(entranceSlotByIndex.value);

      for (let slot = 0; slot < animateCount; slot++) {
        const index = previous + slot;
        nextIndices.add(index);
        nextSlots.set(index, slot);
      }

      entranceIndices.value = nextIndices;
      entranceSlotByIndex.value = nextSlots;
    }
  );

  const resetForBatch = () => {
    entranceIndices.value = new Set();
    entranceSlotByIndex.value = new Map();
  };

  const getEntranceDelayMs = (index: number): number => {
    const slot = entranceSlotByIndex.value.get(index);
    return (slot ?? 0) * GRID_ENTRANCE_STAGGER_MS;
  };

  return {
    entranceIndices,
    entranceSlotByIndex,
    getEntranceDelayMs,
    resetForBatch,
  };
}
