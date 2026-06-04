import type { Photo } from '../types/photo';
import type { GridUrlCache } from './gridUrlCache';
import { getPhotoCacheKey } from './gridUrlSync';

export function warmThumbnailUrl(cache: GridUrlCache, photo: Photo): boolean {
  if (!photo.id || !photo.thumbnail) {
    return false;
  }

  const key = getPhotoCacheKey(photo);
  if (!key) {
    return false;
  }

  cache.getOrCreate(key, () => URL.createObjectURL(photo.thumbnail!));
  return true;
}
