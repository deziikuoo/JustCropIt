import { openDB } from "idb";
import type { DBSchema, IDBPDatabase } from "idb";

export interface PhotoData {
  id: string;
  original: Blob;
  current: Blob;
  thumbnail?: Blob;
  metadata: {
    name: string;
    uploadedAt: number;
    expiresAt: number;
    flips: { horizontal: boolean; vertical: boolean };
    crop?: { x: number; y: number; width: number; height: number };
    rotation?: number; // Rotation angle in degrees (0, 90, 180, 270, etc.)
    thumbhash?: string;
    sourceFormat?: string;
    exifNormalized?: boolean;
  };
}

interface PhotoStorageDB extends DBSchema {
  photos: {
    key: string;
    value: PhotoData;
    indexes: { "by-expiresAt": number };
  };
}

const DB_NAME = "photo-editor-db";
const DB_VERSION = 3;
const STORE_NAME = "photos";
const STORAGE_LIMIT_SOFT = 2 * 1024 * 1024 * 1024; // 2GB
const STORAGE_LIMIT_HARD = 2.5 * 1024 * 1024 * 1024; // 2.5GB
const EXPIRATION_HOURS = 24;

let db: IDBPDatabase<PhotoStorageDB> | null = null;

export const initDB = async (): Promise<IDBPDatabase<PhotoStorageDB>> => {
  if (db) return db;

  db = await openDB<PhotoStorageDB>(DB_NAME, DB_VERSION, {
    upgrade(database: IDBPDatabase<PhotoStorageDB>, oldVersion) {
      if (oldVersion < 1) {
        const store = database.createObjectStore(STORE_NAME, {
          keyPath: "id",
        });
        store.createIndex("by-expiresAt", "metadata.expiresAt");
      }
      // v2: thumbnail is an optional field on existing records; no store migration needed
      // v3: optional metadata.thumbhash on existing records; no store migration needed
    },
  });

  return db;
};

export const checkStorageQuota = async (): Promise<{
  usage: number;
  quota: number;
  available: number;
  percentage: number;
}> => {
  if ("storage" in navigator && "estimate" in navigator.storage) {
    const estimate = await navigator.storage.estimate();
    const usage = estimate.usage || 0;
    const quota = estimate.quota || 0;
    const available = quota - usage;
    const percentage = quota > 0 ? (usage / quota) * 100 : 0;

    return { usage, quota, available, percentage };
  }
  // Fallback if storage API not available
  return {
    usage: 0,
    quota: STORAGE_LIMIT_HARD,
    available: STORAGE_LIMIT_HARD,
    percentage: 0,
  };
};

export const getStorageStatus = async (): Promise<{
  canStore: boolean;
  shouldWarn: boolean;
  message?: string;
}> => {
  const { quota, percentage } = await checkStorageQuota();
  const softLimitPercentage = (STORAGE_LIMIT_SOFT / quota) * 100;
  const hardLimitPercentage = (STORAGE_LIMIT_HARD / quota) * 100;

  if (percentage >= hardLimitPercentage) {
    return {
      canStore: false,
      shouldWarn: true,
      message: `Storage limit reached (${percentage.toFixed(
        1
      )}% used). Please delete some photos or clear browser data.`,
    };
  }

  if (percentage >= softLimitPercentage) {
    return {
      canStore: true,
      shouldWarn: true,
      message: `Storage is ${percentage.toFixed(
        1
      )}% full. Consider deleting old photos.`,
    };
  }

  return { canStore: true, shouldWarn: false };
};

export const estimatePhotoSize = async (file: File): Promise<number> => {
  return file.size;
};

export const canStorePhoto = async (
  file: File
): Promise<{
  canStore: boolean;
  reason?: string;
}> => {
  const status = await getStorageStatus();
  if (!status.canStore) {
    return { canStore: false, reason: status.message };
  }

  const photoSize = await estimatePhotoSize(file);
  const { available } = await checkStorageQuota();

  // Reserve space for original, current, and approximate thumbnail overhead
  const requiredSpace = photoSize * 2 + photoSize * 0.15;

  if (requiredSpace > available) {
    return {
      canStore: false,
      reason: `Not enough storage space. Need ${(
        requiredSpace /
        1024 /
        1024
      ).toFixed(1)}MB but only ${(available / 1024 / 1024).toFixed(
        1
      )}MB available.`,
    };
  }

  return { canStore: true };
};

export const savePhoto = async (
  original: File,
  current: File,
  metadata: {
    name: string;
    flips: { horizontal: boolean; vertical: boolean };
    crop?: { x: number; y: number; width: number; height: number };
    rotation?: number;
    thumbhash?: string;
    sourceFormat?: string;
    exifNormalized?: boolean;
  },
  thumbnail?: Blob
): Promise<string> => {
  const database = await initDB();

  const now = Date.now();
  const expiresAt = now + EXPIRATION_HOURS * 60 * 60 * 1000;

  const originalBlob = await original
    .arrayBuffer()
    .then((b) => new Blob([b], { type: original.type }));
  const currentBlob = await current
    .arrayBuffer()
    .then((b) => new Blob([b], { type: current.type }));

  const id = `photo-${now}-${Math.random().toString(36).substr(2, 9)}`;

  const photoData: PhotoData = {
    id,
    original: originalBlob,
    current: currentBlob,
    ...(thumbnail ? { thumbnail } : {}),
    metadata: {
      ...metadata,
      uploadedAt: now,
      expiresAt,
    },
  };

  await database.put(STORE_NAME, photoData);
  return id;
};

export const updatePhoto = async (
  id: string,
  current: File,
  metadata: {
    flips: { horizontal: boolean; vertical: boolean };
    crop?: { x: number; y: number; width: number; height: number };
    rotation?: number;
  }
): Promise<void> => {
  const database = await initDB();
  const existing = await database.get(STORE_NAME, id);

  if (!existing) {
    throw new Error(`Photo with id ${id} not found`);
  }

  const currentBlob = await current
    .arrayBuffer()
    .then((b) => new Blob([b], { type: current.type }));

  // Convert Proxy objects to plain objects for IndexedDB
  const plainFlips = {
    horizontal: metadata.flips.horizontal,
    vertical: metadata.flips.vertical,
  };

  const updated: PhotoData = {
    ...existing,
    current: currentBlob,
    thumbnail: undefined,
    metadata: {
      name: existing.metadata.name,
      uploadedAt: existing.metadata.uploadedAt,
      expiresAt: existing.metadata.expiresAt,
      flips: plainFlips,
      crop: metadata.crop ? { ...metadata.crop } : undefined,
      rotation: metadata.rotation,
      thumbhash: undefined,
    },
  };

  console.log("updatePhoto: Saving metadata:", updated.metadata);
  await database.put(STORE_NAME, updated);
  console.log("updatePhoto: Successfully saved to database");
};

export const updatePhotosBatch = async (
  updates: Array<{
    id: string;
    current: File;
    metadata: {
      flips: { horizontal: boolean; vertical: boolean };
      crop?: { x: number; y: number; width: number; height: number };
      rotation?: number;
    };
  }>
): Promise<void> => {
  // Pre-convert blobs to avoid blocking the transaction logic
  const preparedUpdates = await Promise.all(
    updates.map(async (u) => ({
      ...u,
      currentBlob: await u.current
        .arrayBuffer()
        .then((b) => new Blob([b], { type: u.current.type })),
    }))
  );

  const database = await initDB();
  const tx = database.transaction(STORE_NAME, "readwrite");
  const store = tx.objectStore(STORE_NAME);

  // Execute all updates within the transaction
  await Promise.all(
    preparedUpdates.map(async (update) => {
      const existing = await store.get(update.id);
      if (!existing) {
        console.warn(`Photo with id ${update.id} not found, skipping update`);
        return;
      }

      const plainFlips = {
        horizontal: update.metadata.flips.horizontal,
        vertical: update.metadata.flips.vertical,
      };

      const updated: PhotoData = {
        ...existing,
        current: update.currentBlob,
        thumbnail: undefined,
        metadata: {
          name: existing.metadata.name,
          uploadedAt: existing.metadata.uploadedAt,
          expiresAt: existing.metadata.expiresAt,
          flips: plainFlips,
          crop: update.metadata.crop ? { ...update.metadata.crop } : undefined,
          rotation: update.metadata.rotation,
          thumbhash: undefined,
        },
      };

      await store.put(updated);
    })
  );

  await tx.done;
  console.log(`updatePhotosBatch: Successfully updated ${updates.length} photos`);
};

export const updatePhotoThumbnail = async (
  id: string,
  thumbnail: Blob,
  thumbhash?: string
): Promise<void> => {
  const database = await initDB();
  const existing = await database.get(STORE_NAME, id);

  if (!existing) {
    throw new Error(`Photo with id ${id} not found`);
  }

  await database.put(STORE_NAME, {
    ...existing,
    thumbnail,
    metadata: {
      ...existing.metadata,
      ...(thumbhash ? { thumbhash } : {}),
    },
  });
};

export const loadPhoto = async (id: string): Promise<PhotoData | undefined> => {
  const database = await initDB();
  return await database.get(STORE_NAME, id);
};

export const loadAllPhotos = async (): Promise<PhotoData[]> => {
  const database = await initDB();
  return await database.getAll(STORE_NAME);
};

export const deletePhoto = async (id: string): Promise<void> => {
  const database = await initDB();
  await database.delete(STORE_NAME, id);
};

export const deletePhotos = async (ids: string[]): Promise<void> => {
  const database = await initDB();
  const tx = database.transaction(STORE_NAME, "readwrite");
  const store = tx.objectStore(STORE_NAME);

  await Promise.all(ids.map((id) => store.delete(id)));
  await tx.done;
  console.log(`deletePhotos: Successfully deleted ${ids.length} photos`);
};

export const deleteExpiredPhotos = async (): Promise<number> => {
  const database = await initDB();
  const now = Date.now();
  const index = database
    .transaction(STORE_NAME, "readwrite")
    .store.index("by-expiresAt");

  let deletedCount = 0;
  let cursor = await index.openCursor(IDBKeyRange.upperBound(now));

  while (cursor) {
    await cursor.delete();
    deletedCount++;
    cursor = await cursor.continue();
  }

  return deletedCount;
};

export const cleanupExpiredPhotos = async (): Promise<number> => {
  const deleted = await deleteExpiredPhotos();
  if (deleted > 0) {
    console.log(`Cleaned up ${deleted} expired photos`);
  }
  return deleted;
};

export const getExpirationInfo = (): { hours: number; message: string } => {
  return {
    hours: EXPIRATION_HOURS,
    message: `Photos are automatically deleted after ${EXPIRATION_HOURS} hours. Clearing your browser data will also delete all photos.`,
  };
};
