import { openDB } from 'idb';
import type { DBSchema, IDBPDatabase } from 'idb';

interface PhotoData {
  id: string;
  original: Blob;
  current: Blob;
  metadata: {
    name: string;
    uploadedAt: number;
    expiresAt: number;
    flips: { horizontal: boolean; vertical: boolean };
    crop?: { x: number; y: number; width: number; height: number };
  };
}

interface PhotoStorageDB extends DBSchema {
  photos: {
    key: string;
    value: PhotoData;
    indexes: { 'by-expiresAt': number };
  };
}

const DB_NAME = 'photo-editor-db';
const DB_VERSION = 1;
const STORE_NAME = 'photos';
const STORAGE_LIMIT_SOFT = 2 * 1024 * 1024 * 1024; // 2GB
const STORAGE_LIMIT_HARD = 2.5 * 1024 * 1024 * 1024; // 2.5GB
const EXPIRATION_HOURS = 24;

let db: IDBPDatabase<PhotoStorageDB> | null = null;

export const initDB = async (): Promise<IDBPDatabase<PhotoStorageDB>> => {
  if (db) return db;

  db = await openDB<PhotoStorageDB>(DB_NAME, DB_VERSION, {
    upgrade(database: IDBPDatabase<PhotoStorageDB>) {
      const store = database.createObjectStore(STORE_NAME, {
        keyPath: 'id',
      });
      store.createIndex('by-expiresAt', 'metadata.expiresAt');
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
  if ('storage' in navigator && 'estimate' in navigator.storage) {
    const estimate = await navigator.storage.estimate();
    const usage = estimate.usage || 0;
    const quota = estimate.quota || 0;
    const available = quota - usage;
    const percentage = quota > 0 ? (usage / quota) * 100 : 0;

    return { usage, quota, available, percentage };
  }
  // Fallback if storage API not available
  return { usage: 0, quota: STORAGE_LIMIT_HARD, available: STORAGE_LIMIT_HARD, percentage: 0 };
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
      message: `Storage limit reached (${(percentage).toFixed(1)}% used). Please delete some photos or clear browser data.`,
    };
  }

  if (percentage >= softLimitPercentage) {
    return {
      canStore: true,
      shouldWarn: true,
      message: `Storage is ${(percentage).toFixed(1)}% full. Consider deleting old photos.`,
    };
  }

  return { canStore: true, shouldWarn: false };
};

export const estimatePhotoSize = async (file: File): Promise<number> => {
  return file.size;
};

export const canStorePhoto = async (file: File): Promise<{
  canStore: boolean;
  reason?: string;
}> => {
  const status = await getStorageStatus();
  if (!status.canStore) {
    return { canStore: false, reason: status.message };
  }

  const photoSize = await estimatePhotoSize(file);
  const { available } = await checkStorageQuota();

  // Reserve space for both original and current (worst case: current is same size)
  const requiredSpace = photoSize * 2;

  if (requiredSpace > available) {
    return {
      canStore: false,
      reason: `Not enough storage space. Need ${(requiredSpace / 1024 / 1024).toFixed(1)}MB but only ${(available / 1024 / 1024).toFixed(1)}MB available.`,
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
  }
): Promise<string> => {
  const database = await initDB();
  
  const now = Date.now();
  const expiresAt = now + EXPIRATION_HOURS * 60 * 60 * 1000;
  
  const originalBlob = await original.arrayBuffer().then(b => new Blob([b], { type: original.type }));
  const currentBlob = await current.arrayBuffer().then(b => new Blob([b], { type: current.type }));

  const id = `photo-${now}-${Math.random().toString(36).substr(2, 9)}`;
  
  const photoData: PhotoData = {
    id,
    original: originalBlob,
    current: currentBlob,
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
  }
): Promise<void> => {
  const database = await initDB();
  const existing = await database.get(STORE_NAME, id);
  
  if (!existing) {
    throw new Error(`Photo with id ${id} not found`);
  }

  const currentBlob = await current.arrayBuffer().then(b => new Blob([b], { type: current.type }));

  const updated: PhotoData = {
    ...existing,
    current: currentBlob,
    metadata: {
      ...existing.metadata,
      ...metadata,
    },
  };

  await database.put(STORE_NAME, updated);
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

export const deleteExpiredPhotos = async (): Promise<number> => {
  const database = await initDB();
  const now = Date.now();
  const index = database.transaction(STORE_NAME, 'readwrite').store.index('by-expiresAt');
  
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

