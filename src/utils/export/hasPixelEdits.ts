import type { Photo } from '../../types/photo';

/**
 * True when photo.current was produced via canvas pipeline (crop/flip/rotate).
 * Canvas output does not carry EXIF — safe to pass through when stripping.
 */
export function hasPixelEdits(photo: Photo): boolean {
  return !!(
    photo.crop ||
    photo.flips.horizontal ||
    photo.flips.vertical ||
    photo.rotation
  );
}
