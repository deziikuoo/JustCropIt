import {
  OBJECT_CROP_PAD_DEFAULT,
  OBJECT_CROP_PAD_STORAGE_KEY,
} from '../constants/optimization';
import { clampObjectPadPx } from './objectMaskCrop';

export function loadObjectCropPadPx(): number {
  try {
    const stored = localStorage.getItem(OBJECT_CROP_PAD_STORAGE_KEY);
    if (stored != null) {
      const parsed = Number.parseInt(stored, 10);
      if (Number.isFinite(parsed)) {
        return clampObjectPadPx(parsed);
      }
    }
  } catch {
    /* ignore */
  }
  return OBJECT_CROP_PAD_DEFAULT;
}

export function saveObjectCropPadPx(padPx: number): void {
  try {
    localStorage.setItem(
      OBJECT_CROP_PAD_STORAGE_KEY,
      String(clampObjectPadPx(padPx))
    );
  } catch {
    /* ignore */
  }
}
