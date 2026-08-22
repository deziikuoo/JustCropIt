import type { Photo } from '../../types/photo';
import { isDeviceImportedPhoto } from '../../types/photo';
import type { PreparedExport } from '../../types/export';
import {
  canOverwriteHandle,
  ensureWritePermission,
  writeBlobToHandle,
} from '../fileSystemAccess';

export async function tryReplaceOriginal(
  photo: Photo,
  prepared: PreparedExport
): Promise<boolean> {
  if (!isDeviceImportedPhoto(photo) || !photo.fileHandle) return false;
  if (!canOverwriteHandle(photo.fileHandle.name, prepared.mimeType)) return false;

  const allowed = await ensureWritePermission(photo.fileHandle);
  if (!allowed) return false;

  const blob = new Blob([prepared.buffer], { type: prepared.mimeType });
  try {
    await writeBlobToHandle(photo.fileHandle, blob, photo.original);
    return true;
  } catch (error) {
    console.warn('[export] Failed to overwrite original file', error);
    return false;
  }
}
