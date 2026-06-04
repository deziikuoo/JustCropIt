import type { Photo } from '../types/photo';
import { getThumbnailCacheKey } from '../constants/optimization';

export function getPreviousDisplayCacheKey(photo: Photo): string | null {
  if (!photo.id) return null;
  return getThumbnailCacheKey(photo.id, photo.thumbRevision);
}

export function invalidatePhotoDisplay(photo: Photo): {
  thumbRevision: number;
  thumbnail: undefined;
  thumbhash: undefined;
} {
  return {
    thumbRevision: photo.thumbRevision + 1,
    thumbnail: undefined,
    thumbhash: undefined,
  };
}

export function applyDisplayInvalidation<T extends Photo>(
  photo: T,
  updates: Partial<T>
): T {
  return {
    ...photo,
    ...updates,
    ...invalidatePhotoDisplay(photo),
  };
}
