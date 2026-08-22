export interface PickedImageFile {
  file: File;
  handle: FileSystemFileHandle;
}

function isAbortError(error: unknown): boolean {
  return (
    !!error &&
    typeof error === 'object' &&
    'name' in error &&
    (error as { name: string }).name === 'AbortError'
  );
}

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  if (dot < 0) return '';
  return fileName.slice(dot + 1).toLowerCase();
}

function extensionsForMime(mimeType: string): string[] {
  const mime = mimeType.toLowerCase();
  if (mime === 'image/jpeg' || mime === 'image/jpg') return ['jpg', 'jpeg'];
  if (mime === 'image/png') return ['png'];
  if (mime === 'image/webp') return ['webp'];
  if (mime === 'image/gif') return ['gif'];
  if (mime === 'image/bmp') return ['bmp'];
  return [];
}

export function canUseOpenFilePicker(): boolean {
  return typeof window !== 'undefined' && typeof window.showOpenFilePicker === 'function';
}

/** True when export bytes are safe to write into the original file name/type. */
export function canOverwriteHandle(
  handleName: string,
  exportMime: string
): boolean {
  const ext = extensionOf(handleName);
  if (!ext) return false;
  return extensionsForMime(exportMime).includes(ext);
}

export async function pickImageFilesWithHandles(): Promise<
  PickedImageFile[] | null
> {
  if (!canUseOpenFilePicker() || !window.showOpenFilePicker) return null;

  try {
    const handles = await window.showOpenFilePicker({
      multiple: true,
      id: 'justcropit-photos',
      startIn: 'pictures',
      types: [
        {
          description: 'Images',
          accept: {
            'image/*': [
              '.png',
              '.jpg',
              '.jpeg',
              '.webp',
              '.gif',
              '.bmp',
              '.heic',
              '.heif',
              '.avif',
            ],
          },
        },
      ],
    });

    return Promise.all(
      handles.map(async (handle) => ({
        file: await handle.getFile(),
        handle,
      }))
    );
  } catch (error) {
    if (isAbortError(error)) return [];
    throw error;
  }
}

export async function ensureWritePermission(
  handle: FileSystemFileHandle
): Promise<boolean> {
  try {
    const current = await handle.queryPermission({ mode: 'readwrite' });
    if (current === 'granted') return true;
    if (current === 'denied') return false;
    const next = await handle.requestPermission({ mode: 'readwrite' });
    return next === 'granted';
  } catch {
    return false;
  }
}

export async function primeWritePermissions(
  handles: Array<FileSystemFileHandle | undefined>
): Promise<void> {
  const unique = handles.filter((handle): handle is FileSystemFileHandle => !!handle);
  await Promise.all(unique.map((handle) => ensureWritePermission(handle)));
}

/**
 * Overwrite the handle's file. If the write fails after truncate, try to
 * restore `restoreBlob` so the original is not left empty.
 */
export async function writeBlobToHandle(
  handle: FileSystemFileHandle,
  blob: Blob,
  restoreBlob?: Blob
): Promise<void> {
  const writable = await handle.createWritable();
  try {
    await writable.write(blob);
    await writable.close();
  } catch (error) {
    try {
      await writable.abort();
    } catch {
      // ignore
    }
    if (restoreBlob) {
      try {
        const restore = await handle.createWritable();
        await restore.write(restoreBlob);
        await restore.close();
      } catch {
        // ignore restore failure; rethrow the original write error
      }
    }
    throw error;
  }
}
