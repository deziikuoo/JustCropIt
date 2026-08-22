import { BATCH_CROP_MODE_STORAGE_KEY } from '../constants/optimization';
import type { BatchCropMode } from '../types/batchCrop';

const MODES: BatchCropMode[] = [
  'same-box',
  'follow-subject',
  'this-person',
  'trim-bars',
];

export function loadBatchCropMode(): BatchCropMode {
  try {
    const stored = localStorage.getItem(BATCH_CROP_MODE_STORAGE_KEY);
    if (stored && (MODES as string[]).includes(stored)) {
      return stored as BatchCropMode;
    }
  } catch {
    /* ignore */
  }
  return 'same-box';
}

export function saveBatchCropMode(mode: BatchCropMode): void {
  try {
    localStorage.setItem(BATCH_CROP_MODE_STORAGE_KEY, mode);
  } catch {
    /* ignore */
  }
}
