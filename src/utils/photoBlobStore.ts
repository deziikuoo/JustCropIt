/**
 * Origin Private File System for full-res photo originals/current.
 * Thumbnails stay in IndexedDB for fast grid object URLs.
 */

const ROOT_DIR = 'photos';

async function getPhotosRoot(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(ROOT_DIR, { create: true });
}

async function getPhotoDir(
  photoId: string,
  create: boolean
): Promise<FileSystemDirectoryHandle> {
  const photos = await getPhotosRoot();
  return photos.getDirectoryHandle(photoId, { create });
}

async function writeBlobFile(
  dir: FileSystemDirectoryHandle,
  name: string,
  blob: Blob
): Promise<void> {
  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  try {
    await writable.write(blob);
  } finally {
    await writable.close();
  }
}

async function readBlobFile(
  dir: FileSystemDirectoryHandle,
  name: string
): Promise<Blob | null> {
  try {
    const handle = await dir.getFileHandle(name);
    const file = await handle.getFile();
    return file;
  } catch {
    return null;
  }
}

export async function writePhotoBlobsOpfs(
  photoId: string,
  original: Blob,
  current: Blob
): Promise<void> {
  const dir = await getPhotoDir(photoId, true);
  const same =
    original === current ||
    (original.size === current.size && original.type === current.type);
  await writeBlobFile(dir, 'original.bin', original);
  if (same) {
    // Point current at original bytes by writing once; read path falls back.
    try {
      await dir.removeEntry('current.bin');
    } catch {
      // ignore missing
    }
  } else {
    await writeBlobFile(dir, 'current.bin', current);
  }
}

export async function writePhotoCurrentOpfs(
  photoId: string,
  current: Blob
): Promise<void> {
  const dir = await getPhotoDir(photoId, true);
  await writeBlobFile(dir, 'current.bin', current);
}

export async function readPhotoBlobsOpfs(
  photoId: string
): Promise<{ original: Blob; current: Blob } | null> {
  try {
    const dir = await getPhotoDir(photoId, false);
    const original = await readBlobFile(dir, 'original.bin');
    if (!original) return null;
    const current = (await readBlobFile(dir, 'current.bin')) ?? original;
    return { original, current };
  } catch {
    return null;
  }
}

export async function deletePhotoBlobsOpfs(photoId: string): Promise<void> {
  try {
    const photos = await getPhotosRoot();
    await photos.removeEntry(photoId, { recursive: true });
  } catch {
    // already gone
  }
}

export async function deletePhotosBlobsOpfs(photoIds: string[]): Promise<void> {
  await Promise.all(photoIds.map((id) => deletePhotoBlobsOpfs(id)));
}
