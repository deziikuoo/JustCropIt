import type { Photo } from '../../types/photo';
import { hasPendingFlipBake } from '../editTransform';

/**
 * True when the photo has transform metadata that implies edited pixels
 * (already baked into current, or deferred flips pending export bake).
 * Canvas / deferred-bake output does not carry EXIF — safe strip fast-path.
 */
export function hasPixelEdits(photo: Photo): boolean {
  return !!(
    photo.crop ||
    photo.flips.horizontal ||
    photo.flips.vertical ||
    photo.rotation ||
    hasPendingFlipBake(photo)
  );
}
