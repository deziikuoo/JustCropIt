import type { Photo } from '../types/photo';
import { getThumbnailCacheKey } from '../constants/optimization';
import { clearThumbnailBackfillFailure } from './thumbnailBackfill';

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
  if (photo.id) {
    clearThumbnailBackfillFailure(photo.id);
  }
  return {
    ...photo,
    ...updates,
    ...invalidatePhotoDisplay(photo),
  };
}
