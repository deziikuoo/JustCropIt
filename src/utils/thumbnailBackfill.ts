import type { Ref } from 'vue';
import type { Photo } from '../types/photo';
import { createThumbnailFromFile } from './thumbnailGenerator';
import { createThumbhashFromBlob } from './thumbhashGenerator';
import { updatePhotoThumbnail } from './photoStorage';
import { processInChunks, scheduleIdleTask } from './scheduler';
import type { BlobToFileFn } from './blobToFile';

const BACKFILL_CHUNK_SIZE = 3;

/** Photos whose bytes cannot be decoded — retrying every backfill pass only spams the console. */
const undecodablePhotoIds = new Set<string>();

export interface GeneratedThumbnailResult {
  thumbnailFile: File;
  thumbhash: string | null;
}

export async function generateAndPersistThumbnail(
  photo: Photo,
  blobToFile: BlobToFileFn
): Promise<GeneratedThumbnailResult | null> {
  if (!photo.id || undecodablePhotoIds.has(photo.id)) {
    return null;
  }

  try {
    const thumbBlob = await createThumbnailFromFile(photo.current);
    const thumbhash = await createThumbhashFromBlob(thumbBlob);
    await updatePhotoThumbnail(photo.id, thumbBlob, thumbhash ?? undefined);
    const thumbName = photo.current.name
      ? `thumb-${photo.current.name}`
      : `thumb-${photo.id}.jpg`;
    return {
      thumbnailFile: blobToFile(thumbBlob, thumbName, 'image/jpeg'),
      thumbhash,
    };
  } catch (error) {
    undecodablePhotoIds.add(photo.id);
    console.warn(
      `Failed to generate thumbnail for photo ${photo.id} (${photo.current.type || 'unknown type'}, ${photo.current.size} bytes) — skipping future retries:`,
      error
    );
    return null;
  }
}

/** Allow a photo to be retried once its bytes have been rewritten (crop, revert, undo). */
export function clearThumbnailBackfillFailure(photoId: string): void {
  undecodablePhotoIds.delete(photoId);
}

export function scheduleThumbnailBackfill(
  photos: Ref<Photo[]>,
  blobToFile: BlobToFileFn
): void {
  const indicesNeedingBackfill = photos.value
    .map((photo, index) => ({ photo, index }))
    .filter(({ photo }) => photo.id && !photo.thumbnail)
    .map(({ index }) => index);

  if (indicesNeedingBackfill.length === 0) {
    scheduleThumbhashBackfill(photos, blobToFile);
    return;
  }

  scheduleIdleTask(async () => {
    await processInChunks(
      indicesNeedingBackfill,
      async (index) => {
        const photo = photos.value[index];
        if (!photo?.id || photo.thumbnail) {
          return null;
        }

        const result = await generateAndPersistThumbnail(photo, blobToFile);
        if (result) {
          photos.value[index] = {
            ...photo,
            thumbnail: result.thumbnailFile,
            thumbhash: result.thumbhash,
          };
        }
        return result;
      },
      BACKFILL_CHUNK_SIZE
    );
    scheduleThumbhashBackfill(photos, blobToFile);
  }, { timeout: 2000 });
}

export function scheduleThumbhashBackfill(
  photos: Ref<Photo[]>,
  _blobToFile: BlobToFileFn
): void {
  const indicesNeedingHash = photos.value
    .map((photo, index) => ({ photo, index }))
    .filter(({ photo }) => photo.id && photo.thumbnail && !photo.thumbhash)
    .map(({ index }) => index);

  if (indicesNeedingHash.length === 0) {
    return;
  }

  scheduleIdleTask(async () => {
    await processInChunks(
      indicesNeedingHash,
      async (index) => {
        const photo = photos.value[index];
        if (!photo?.id || !photo.thumbnail || photo.thumbhash) {
          return null;
        }

        const thumbhash = await createThumbhashFromBlob(photo.thumbnail);
        if (!thumbhash) {
          return null;
        }

        await updatePhotoThumbnail(photo.id, photo.thumbnail, thumbhash);
        photos.value[index] = {
          ...photo,
          thumbhash,
        };
        return thumbhash;
      },
      BACKFILL_CHUNK_SIZE
    );
  }, { timeout: 2000 });
}
