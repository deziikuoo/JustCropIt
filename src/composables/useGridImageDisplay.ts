import { ref, watch, type Ref } from 'vue';
import type { Photo } from '../types/photo';
import { getThumbnailCacheKey } from '../constants/optimization';
import type { GridUrlCache } from '../utils/gridUrlCache';
import type { GridDecodeQueue } from '../utils/gridDecodeQueue';
import { getPhotoCacheKey } from '../utils/gridUrlSync';
import { generateAndPersistThumbnail } from '../utils/thumbnailBackfill';
import { blobToFile } from '../utils/blobToFile';

// Visible indices: decode queue generates missing thumbs on view.
// Idle prefetch (useGridIdlePrefetch) warms cache URLs for existing thumbnails only.
export interface UseGridImageDisplayOptions {
  photos: Ref<Photo[]>;
  visibleIndices: Ref<ReadonlySet<number>>;
  urlCache: GridUrlCache;
  decodeQueue: GridDecodeQueue;
  onThumbnailUpdated?: (
    index: number,
    thumbnail: File,
    thumbhash?: string | null
  ) => void;
}

export function useGridImageDisplay(options: UseGridImageDisplayOptions): {
  getDisplayUrl: (index: number) => string | null;
  isLoading: (index: number) => boolean;
  cancelForPhoto: (photoId: string) => void;
  clearDisplayState: () => void;
} {
  const displayUrls = ref(new Map<number, string>());
  const loadingIndices = ref(new Set<number>());
  const pendingPhotoIds = new Set<string>();
  const lastRevisionByPhotoId = new Map<string, number>();

  const clearDisplayForPhoto = (photoId: string) => {
    for (const index of [...loadingIndices.value]) {
      const photo = options.photos.value[index];
      if (photo?.id === photoId) {
        loadingIndices.value.delete(index);
      }
    }
    loadingIndices.value = new Set(loadingIndices.value);

    for (const [index] of displayUrls.value) {
      const photo = options.photos.value[index];
      if (photo?.id === photoId) {
        displayUrls.value.delete(index);
      }
    }
    displayUrls.value = new Map(displayUrls.value);
  };

  const handlePhotoDisplayChanges = () => {
    let changed = false;

    options.photos.value.forEach((photo, index) => {
      if (!photo.id) return;

      const lastRevision = lastRevisionByPhotoId.get(photo.id);
      const currentRevision = photo.thumbRevision;

      if (lastRevision === undefined) {
        lastRevisionByPhotoId.set(photo.id, currentRevision);
        return;
      }

      const revisionChanged = currentRevision !== lastRevision;
      const thumbCleared = !photo.thumbnail && displayUrls.value.has(index);

      if (revisionChanged || thumbCleared) {
        if (revisionChanged) {
          const oldKey = getThumbnailCacheKey(photo.id, lastRevision);
          options.urlCache.revoke(oldKey);
          lastRevisionByPhotoId.set(photo.id, currentRevision);
        }

        options.decodeQueue.cancelForPhoto(photo.id);
        pendingPhotoIds.delete(photo.id);
        displayUrls.value.delete(index);
        loadingIndices.value.delete(index);
        changed = true;
      }
    });

    if (changed) {
      displayUrls.value = new Map(displayUrls.value);
      loadingIndices.value = new Set(loadingIndices.value);
    }
  };

  const resolveDisplayUrl = (index: number): string | null => {
    const photo = options.photos.value[index];
    if (!photo?.id || !photo.thumbnail) {
      return null;
    }

    const key = getPhotoCacheKey(photo);
    if (!key) return null;

    const url = options.urlCache.getOrCreate(key, () =>
      URL.createObjectURL(photo.thumbnail!)
    );
    displayUrls.value.set(index, url);
    loadingIndices.value.delete(index);
    return url;
  };

  const enqueueThumbnailGeneration = (index: number, photoId: string) => {
    if (pendingPhotoIds.has(photoId)) return;

    const photoAtEnqueue = options.photos.value[index];
    if (!photoAtEnqueue?.id) return;

    const revisionAtEnqueue = photoAtEnqueue.thumbRevision;

    pendingPhotoIds.add(photoId);
    loadingIndices.value.add(index);
    loadingIndices.value = new Set(loadingIndices.value);

    void options.decodeQueue
      .enqueue(async () => {
        const photo = options.photos.value[index];
        if (!photo?.id || photo.id !== photoId) {
          return;
        }

        if (photo.thumbRevision !== revisionAtEnqueue) {
          return;
        }

        if (photo.thumbnail) {
          resolveDisplayUrl(index);
          return;
        }

        const result = await generateAndPersistThumbnail(photo, blobToFile);
        if (!result) {
          return;
        }

        const latestPhoto = options.photos.value[index];
        if (
          !latestPhoto?.id ||
          latestPhoto.id !== photoId ||
          latestPhoto.thumbRevision !== revisionAtEnqueue
        ) {
          return;
        }

        options.onThumbnailUpdated?.(
          index,
          result.thumbnailFile,
          result.thumbhash
        );

        const key = getPhotoCacheKey({
          ...latestPhoto,
          thumbnail: result.thumbnailFile,
        });
        if (key) {
          const url = options.urlCache.getOrCreate(key, () =>
            URL.createObjectURL(result.thumbnailFile)
          );
          displayUrls.value.set(index, url);
          displayUrls.value = new Map(displayUrls.value);
        }
        loadingIndices.value.delete(index);
        loadingIndices.value = new Set(loadingIndices.value);
      }, photoId)
      .catch((error) => {
        console.warn(`Failed to queue thumbnail for photo ${photoId}:`, error);
      })
      .finally(() => {
        pendingPhotoIds.delete(photoId);
        loadingIndices.value.delete(index);
        loadingIndices.value = new Set(loadingIndices.value);
      });
  };

  const syncVisibleDisplay = () => {
    handlePhotoDisplayChanges();

    const visible = options.visibleIndices.value;

    for (const index of [...displayUrls.value.keys()]) {
      if (!options.photos.value[index]) {
        displayUrls.value.delete(index);
      }
    }

    for (const index of visible) {
      const photo = options.photos.value[index];
      if (!photo?.id) continue;

      if (photo.thumbnail) {
        resolveDisplayUrl(index);
        continue;
      }

      if (!loadingIndices.value.has(index) && !pendingPhotoIds.has(photo.id)) {
        enqueueThumbnailGeneration(index, photo.id);
      }
    }

    displayUrls.value = new Map(displayUrls.value);
    loadingIndices.value = new Set(loadingIndices.value);
  };

  watch(
    () => options.visibleIndices.value,
    () => {
      syncVisibleDisplay();
    },
    { flush: 'post', deep: true }
  );

  watch(
    () =>
      options.photos.value.map(
        (photo) => `${photo.id ?? 'none'}:${photo.thumbRevision}:${photo.thumbnail ? 1 : 0}:${photo.thumbhash ? 1 : 0}`
      ),
    () => {
      syncVisibleDisplay();
    },
    { flush: 'post' }
  );

  const cancelForPhoto = (photoId: string) => {
    options.decodeQueue.cancelForPhoto(photoId);
    pendingPhotoIds.delete(photoId);
    clearDisplayForPhoto(photoId);
  };

  const clearDisplayState = () => {
    displayUrls.value = new Map();
    loadingIndices.value = new Set();
    pendingPhotoIds.clear();
    lastRevisionByPhotoId.clear();
  };

  syncVisibleDisplay();

  return {
    getDisplayUrl: (index: number) => displayUrls.value.get(index) ?? null,
    isLoading: (index: number) =>
      loadingIndices.value.has(index) && !displayUrls.value.has(index),
    cancelForPhoto,
    clearDisplayState,
  };
}
