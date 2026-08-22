import type { Photo } from '../types/photo';
import { getThumbnailCacheKey } from '../constants/optimization';
import type { GridUrlCache } from './gridUrlCache';

export function getPhotoCacheKey(photo: Photo): string | null {
  if (!photo.id) return null;
  return getThumbnailCacheKey(photo.id, photo.thumbRevision);
}

export function syncGridUrlsForVisibility(
  cache: GridUrlCache,
  photos: Photo[],
  visibleIndices: ReadonlySet<number>,
  previousVisible: ReadonlySet<number>
): void {
  if (visibleIndices.size === 0 && photos.length > 0) {
    return;
  }

  for (const index of previousVisible) {
    if (visibleIndices.has(index)) continue;
    const photo = photos[index];
    if (!photo) continue;
    const key = getPhotoCacheKey(photo);
    if (key) cache.revoke(key);
  }
}

export function revokePhotoCacheKey(
  cache: GridUrlCache,
  photo: Photo
): void {
  const key = getPhotoCacheKey(photo);
  if (key) cache.revoke(key);
}
