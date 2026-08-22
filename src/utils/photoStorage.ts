import { openDB } from "idb";
import { invalidateIdentityPhoto, clearIdentityCache } from "./identityCache";
import type { DBSchema, IDBPDatabase } from "idb";
import {
  computeEffectiveBudget,
  formatGiB,
  formatMiB,
  readStorageEstimate,
  STORAGE_BROWSER_HARD_RATIO,
  STORAGE_BROWSER_SOFT_RATIO,
  STORAGE_LIMIT_HARD_BYTES,
} from "./storageBudget";
import {
  getPreferredBlobBackend,
  requestPersistentStorage,
} from "./storageCapabilities";
import {
  deletePhotoBlobsOpfs,
  deletePhotosBlobsOpfs,
  readPhotoBlobsOpfs,
  writePhotoBlobsOpfs,
  writePhotoCurrentOpfs,
} from "./photoBlobStore";

export type PhotoBlobStorage = "opfs" | "idb";

export interface PhotoData {
  id: string;
  /** Full-res blobs when storage === 'idb'; empty stubs when 'opfs'. */
  original: Blob;
  current: Blob;
  thumbnail?: Blob;
  /** Where full-res bytes live. Missing ⇒ legacy IDB blobs. */
  storage?: PhotoBlobStorage;
  metadata: {
    name: string;
    uploadedAt: number;
    expiresAt: number;
    flips: { horizontal: boolean; vertical: boolean };
    crop?: { x: number; y: number; width: number; height: number };
    rotation?: number;
    thumbhash?: string;
    sourceFormat?: string;
    exifNormalized?: boolean;
    importOrigin?: "device" | "video";
  };
  /** Chromium File System Access handle; structured-cloneable in IndexedDB. */
  fileHandle?: FileSystemFileHandle;
}

interface PhotoStorageDB extends DBSchema {
  photos: {
    key: string;
    value: PhotoData;
    indexes: { "by-expiresAt": number };
  };
}

const DB_NAME = "photo-editor-db";
/** v4: optional `storage` field ('opfs' | 'idb'); no structural migration. */
const DB_VERSION = 4;
const STORE_NAME = "photos";
const EXPIRATION_HOURS = 24;

const EMPTY_BLOB = new Blob([]);

let db: IDBPDatabase<PhotoStorageDB> | null = null;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isQuotaExceededError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as DOMException;
  return (
    e.name === "QuotaExceededError" ||
    e.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
    (typeof e.message === "string" &&
      /quota/i.test(e.message))
  );
}

export function isTransientIdbError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as DOMException;
  const name = e.name || "";
  const message = typeof e.message === "string" ? e.message : "";
  if (isQuotaExceededError(error)) return false;
  return (
    name === "InvalidStateError" ||
    name === "AbortError" ||
    name === "TransactionInactiveError" ||
    /connection is closing/i.test(message) ||
    /database connection is closing/i.test(message) ||
    /The database connection is closing/i.test(message)
  );
}

function resetDbHandle(): void {
  db = null;
}

export const initDB = async (): Promise<IDBPDatabase<PhotoStorageDB>> => {
  if (db) return db;

  const opened = await openDB<PhotoStorageDB>(DB_NAME, DB_VERSION, {
    upgrade(database: IDBPDatabase<PhotoStorageDB>, oldVersion) {
      if (oldVersion < 1) {
        const store = database.createObjectStore(STORE_NAME, {
          keyPath: "id",
        });
        store.createIndex("by-expiresAt", "metadata.expiresAt");
      }
      // v2–v4: optional fields on existing records; no store migration needed
    },
    blocked() {
      console.warn("[photoStorage] IndexedDB open blocked");
    },
  });

  opened.addEventListener("close", () => {
    resetDbHandle();
  });
  opened.addEventListener("versionchange", () => {
    try {
      opened.close();
    } catch {
      // ignore
    }
    resetDbHandle();
  });

  db = opened;
  return db;
};

async function withIdbRetry<T>(
  operation: () => Promise<T>,
  label: string
): Promise<T> {
  const delays = [50, 150, 400];
  let lastError: unknown;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (isQuotaExceededError(error)) throw error;
      if (!isTransientIdbError(error) || attempt >= delays.length) {
        throw error;
      }
      console.warn(
        `[photoStorage] ${label} transient failure (attempt ${attempt + 1}), reopening`,
        error
      );
      resetDbHandle();
      await sleep(delays[attempt]!);
    }
  }
  throw lastError;
}

export const checkStorageQuota = async (): Promise<{
  usage: number;
  quota: number;
  available: number;
  percentage: number;
}> => {
  const estimate = await readStorageEstimate();
  const budget = computeEffectiveBudget(estimate);
  return {
    usage: budget.usage,
    quota: budget.effectiveHard,
    available: budget.available,
    percentage:
      budget.effectiveHard > 0
        ? (budget.usage / budget.effectiveHard) * 100
        : 0,
  };
};

export const getStorageStatus = async (): Promise<{
  canStore: boolean;
  shouldWarn: boolean;
  message?: string;
  usage?: number;
  quota?: number;
  available?: number;
}> => {
  const estimate = await readStorageEstimate();
  const budget = computeEffectiveBudget(estimate);
  const { usage, effectiveHard, softWarnAt, available, browserQuota, limitingFactor } =
    budget;
  const browserPct =
    browserQuota > 0 ? (usage / browserQuota) * 100 : 0;

  if (usage >= effectiveHard) {
    const limitLabel =
      limitingFactor === "browser-quota"
        ? `browser/disk limit (~${formatGiB(effectiveHard)} GB available to this site)`
        : `app cap of ${formatGiB(STORAGE_LIMIT_HARD_BYTES)} GB`;
    return {
      canStore: false,
      shouldWarn: true,
      usage,
      quota: effectiveHard,
      available,
      message: `Storage limit reached (${formatGiB(usage)} GB used; ${limitLabel}). Delete photos or clear site data.`,
    };
  }

  if (
    browserQuota > 0 &&
    browserPct / 100 >= STORAGE_BROWSER_HARD_RATIO
  ) {
    return {
      canStore: false,
      shouldWarn: true,
      usage,
      quota: effectiveHard,
      available,
      message: `Browser storage is nearly full (${browserPct.toFixed(
        1
      )}% of browser quota). Private windows and some browsers (e.g. Brave) use a small quota — free disk space or exit private mode.`,
    };
  }

  if (
    usage >= softWarnAt ||
    (browserQuota > 0 && browserPct / 100 >= STORAGE_BROWSER_SOFT_RATIO)
  ) {
    return {
      canStore: true,
      shouldWarn: true,
      usage,
      quota: effectiveHard,
      available,
      message: `Storage is getting full (${formatMiB(
        usage
      )} MB used of ~${formatGiB(effectiveHard)} GB effective). Consider deleting old photos.`,
    };
  }

  return {
    canStore: true,
    shouldWarn: false,
    usage,
    quota: effectiveHard,
    available,
  };
};

export const estimatePhotoSize = async (file: File): Promise<number> => {
  return file.size;
};

export const canStorePhoto = async (
  file: File,
  options?: { identicalOriginalAndCurrent?: boolean }
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

  const identical = options?.identicalOriginalAndCurrent !== false;
  const requiredSpace = identical
    ? photoSize * 1.2
    : photoSize * 2 + photoSize * 0.15;

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

function fileToBlob(file: Blob): Blob {
  // Prefer pass-through: File is a Blob; avoid arrayBuffer clone when possible.
  if (file instanceof Blob) return file;
  return file;
}

async function putPhotoRecordsBatch(records: PhotoData[]): Promise<void> {
  if (records.length === 0) return;

  await withIdbRetry(async () => {
    const database = await initDB();
    if (records.length === 1) {
      await database.put(STORE_NAME, records[0]);
      return;
    }

    const tx = database.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    await Promise.all(records.map((record) => store.put(record)));
    await tx.done;
  }, "putBatch");
}

async function putPhotoRecord(photoData: PhotoData): Promise<void> {
  await putPhotoRecordsBatch([photoData]);
}

export type PhotoSaveMetadata = {
  name: string;
  flips: { horizontal: boolean; vertical: boolean };
  crop?: { x: number; y: number; width: number; height: number };
  rotation?: number;
  thumbhash?: string;
  sourceFormat?: string;
  exifNormalized?: boolean;
  importOrigin?: "device" | "video";
};

export interface BulkPhotoSaveRequest {
  original: File;
  current: File;
  metadata: PhotoSaveMetadata;
  thumbnail?: Blob;
  fileHandle?: FileSystemFileHandle;
}

function newPhotoId(): string {
  return `photo-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Coalescing saver: OPFS writes run in parallel; IndexedDB puts share a
 * transaction with whatever else finished in the same window.
 */
export function createBulkPhotoSaver(): {
  save: (request: BulkPhotoSaveRequest) => Promise<string>;
} {
  let backendPromise: Promise<PhotoBlobStorage> | null = null;
  const idbQueue: PhotoData[] = [];
  let idbFlush: Promise<void> | null = null;

  const getBackend = (): Promise<PhotoBlobStorage> => {
    if (!backendPromise) {
      backendPromise = getPreferredBlobBackend();
    }
    return backendPromise;
  };

  const flushIdb = async (): Promise<void> => {
    while (true) {
      if (idbFlush) {
        await idbFlush;
        if (idbQueue.length === 0) return;
        continue;
      }

      const batch = idbQueue.splice(0, idbQueue.length);
      if (batch.length === 0) return;

      const op = putPhotoRecordsBatch(batch)
        .catch(async (error) => {
          const opfsIds = batch
            .filter((record) => record.storage === "opfs")
            .map((record) => record.id);
          await deletePhotosBlobsOpfs(opfsIds).catch(() => undefined);
          throw error;
        })
        .finally(() => {
          if (idbFlush === op) idbFlush = null;
        });

      idbFlush = op;
      await op;
      return;
    }
  };

  const save = async (request: BulkPhotoSaveRequest): Promise<string> => {
    const id = newPhotoId();
    const now = Date.now();
    const expiresAt = now + EXPIRATION_HOURS * 60 * 60 * 1000;
    const sameFile = request.original === request.current;
    const originalBlob = fileToBlob(request.original);
    const currentBlob = sameFile ? originalBlob : fileToBlob(request.current);
    const chosen = await getBackend();

    let storage: PhotoBlobStorage = "idb";
    let idbOriginal = originalBlob;
    let idbCurrent = currentBlob;

    if (chosen === "opfs") {
      try {
        await writePhotoBlobsOpfs(id, originalBlob, currentBlob);
        storage = "opfs";
        idbOriginal = EMPTY_BLOB;
        idbCurrent = EMPTY_BLOB;
      } catch (error) {
        console.warn(
          "[photoStorage] OPFS write failed; falling back to IndexedDB blobs",
          error
        );
        storage = "idb";
        idbOriginal = originalBlob;
        idbCurrent = currentBlob;
      }
    }

    const photoData: PhotoData = {
      id,
      original: idbOriginal,
      current: idbCurrent,
      storage,
      ...(request.thumbnail ? { thumbnail: request.thumbnail } : {}),
      ...(request.fileHandle ? { fileHandle: request.fileHandle } : {}),
      metadata: {
        ...request.metadata,
        uploadedAt: now,
        expiresAt,
      },
    };

    idbQueue.push(photoData);
    await flushIdb();
    void requestPersistentStorage();
    return id;
  };

  return { save };
}

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
    importOrigin?: "device" | "video";
  },
  thumbnail?: Blob
): Promise<string> => {
  const now = Date.now();
  const expiresAt = now + EXPIRATION_HOURS * 60 * 60 * 1000;
  const id = `photo-${now}-${Math.random().toString(36).substr(2, 9)}`;

  const sameFile = original === current;
  const originalBlob = fileToBlob(original);
  const currentBlob = sameFile ? originalBlob : fileToBlob(current);

  const backend = await getPreferredBlobBackend();
  let storage: PhotoBlobStorage = "idb";
  let idbOriginal = originalBlob;
  let idbCurrent = currentBlob;

  if (backend === "opfs") {
    try {
      await writePhotoBlobsOpfs(id, originalBlob, currentBlob);
      storage = "opfs";
      idbOriginal = EMPTY_BLOB;
      idbCurrent = EMPTY_BLOB;
    } catch (error) {
      console.warn(
        "[photoStorage] OPFS write failed; falling back to IndexedDB blobs",
        error
      );
      storage = "idb";
      idbOriginal = originalBlob;
      idbCurrent = currentBlob;
    }
  }

  const photoData: PhotoData = {
    id,
    original: idbOriginal,
    current: idbCurrent,
    storage,
    ...(thumbnail ? { thumbnail } : {}),
    metadata: {
      ...metadata,
      uploadedAt: now,
      expiresAt,
    },
  };

  try {
    await putPhotoRecord(photoData);
  } catch (error) {
    if (storage === "opfs") {
      await deletePhotoBlobsOpfs(id).catch(() => undefined);
    }
    throw error;
  }

  void requestPersistentStorage();
  return id;
};

async function hydratePhotoBlobs(data: PhotoData): Promise<PhotoData> {
  if (data.storage !== "opfs") return data;
  const blobs = await readPhotoBlobsOpfs(data.id);
  if (!blobs) {
    console.warn(
      `[photoStorage] OPFS blobs missing for ${data.id}; record may be corrupt`
    );
    return data;
  }
  return {
    ...data,
    original: blobs.original,
    current: blobs.current,
  };
}

export const updatePhoto = async (
  id: string,
  current: File,
  metadata: {
    flips: { horizontal: boolean; vertical: boolean };
    crop?: { x: number; y: number; width: number; height: number };
    rotation?: number;
  },
  /** When provided, persist this thumb; otherwise clear (legacy invalidation). */
  thumbnail?: Blob
): Promise<void> => {
  await withIdbRetry(async () => {
    const database = await initDB();
    const existing = await database.get(STORE_NAME, id);

    if (!existing) {
      throw new Error(`Photo with id ${id} not found`);
    }

    const currentBlob = fileToBlob(current);
    const plainFlips = {
      horizontal: metadata.flips.horizontal,
      vertical: metadata.flips.vertical,
    };

    const storage = existing.storage ?? "idb";
    let idbCurrent = currentBlob;
    const nextThumbnail = thumbnail;
    const clearThumbMeta = thumbnail == null;

    if (storage === "opfs") {
      try {
        await writePhotoCurrentOpfs(id, currentBlob);
        idbCurrent = EMPTY_BLOB;
      } catch (error) {
        console.warn(
          "[photoStorage] OPFS current write failed; storing in IDB",
          error
        );
        const updated: PhotoData = {
          ...existing,
          current: currentBlob,
          storage: "idb",
          thumbnail: nextThumbnail,
          metadata: {
            name: existing.metadata.name,
            uploadedAt: existing.metadata.uploadedAt,
            expiresAt: existing.metadata.expiresAt,
            flips: plainFlips,
            crop: metadata.crop ? { ...metadata.crop } : undefined,
            rotation: metadata.rotation,
            thumbhash: clearThumbMeta ? undefined : existing.metadata.thumbhash,
            sourceFormat: existing.metadata.sourceFormat,
            exifNormalized: existing.metadata.exifNormalized,
            importOrigin: existing.metadata.importOrigin,
          },
        };
        await database.put(STORE_NAME, updated);
        return;
      }
    }

    const updated: PhotoData = {
      ...existing,
      current: idbCurrent,
      thumbnail: nextThumbnail,
      metadata: {
        name: existing.metadata.name,
        uploadedAt: existing.metadata.uploadedAt,
        expiresAt: existing.metadata.expiresAt,
        flips: plainFlips,
        crop: metadata.crop ? { ...metadata.crop } : undefined,
        rotation: metadata.rotation,
        thumbhash: clearThumbMeta ? undefined : existing.metadata.thumbhash,
        sourceFormat: existing.metadata.sourceFormat,
        exifNormalized: existing.metadata.exifNormalized,
        importOrigin: existing.metadata.importOrigin,
      },
    };

    await database.put(STORE_NAME, updated);
  }, "updatePhoto");
};

/**
 * Update transform metadata only — does not rewrite current/original/thumbnail blobs.
 */
export const updatePhotoMetadata = async (
  id: string,
  metadata: {
    flips: { horizontal: boolean; vertical: boolean };
    crop?: { x: number; y: number; width: number; height: number };
    rotation?: number;
  }
): Promise<void> => {
  await withIdbRetry(async () => {
    const database = await initDB();
    const existing = await database.get(STORE_NAME, id);

    if (!existing) {
      throw new Error(`Photo with id ${id} not found`);
    }

    const plainFlips = {
      horizontal: metadata.flips.horizontal,
      vertical: metadata.flips.vertical,
    };

    await database.put(STORE_NAME, {
      ...existing,
      metadata: {
        ...existing.metadata,
        flips: plainFlips,
        crop: metadata.crop ? { ...metadata.crop } : undefined,
        rotation: metadata.rotation,
      },
    });
  }, "updatePhotoMetadata");
};

export const updatePhotosMetadataBatch = async (
  updates: Array<{
    id: string;
    metadata: {
      flips: { horizontal: boolean; vertical: boolean };
      crop?: { x: number; y: number; width: number; height: number };
      rotation?: number;
    };
  }>
): Promise<void> => {
  if (updates.length === 0) return;

  await withIdbRetry(async () => {
    const database = await initDB();
    const tx = database.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);

    await Promise.all(
      updates.map(async (update) => {
        const existing = await store.get(update.id);
        if (!existing) {
          console.warn(
            `Photo with id ${update.id} not found, skipping metadata update`
          );
          return;
        }

        const plainFlips = {
          horizontal: update.metadata.flips.horizontal,
          vertical: update.metadata.flips.vertical,
        };

        await store.put({
          ...existing,
          metadata: {
            ...existing.metadata,
            flips: plainFlips,
            crop: update.metadata.crop
              ? { ...update.metadata.crop }
              : undefined,
            rotation: update.metadata.rotation,
          },
        });
      })
    );

    await tx.done;
  }, "updatePhotosMetadataBatch");
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
    /** When provided, persist this thumb; otherwise clear. */
    thumbnail?: Blob;
  }>
): Promise<void> => {
  // Resolve storage + OPFS writes before opening the IDB transaction.
  const preparedUpdates = await Promise.all(
    updates.map(async (u) => {
      const currentBlob = fileToBlob(u.current);
      const meta = await withIdbRetry(async () => {
        const database = await initDB();
        return database.get(STORE_NAME, u.id);
      }, "updatePhotosBatch-get");

      let storage: PhotoBlobStorage = meta?.storage ?? "idb";
      let idbCurrent = currentBlob;

      if (storage === "opfs") {
        try {
          await writePhotoCurrentOpfs(u.id, currentBlob);
          idbCurrent = EMPTY_BLOB;
        } catch {
          storage = "idb";
          idbCurrent = currentBlob;
        }
      }

      return {
        ...u,
        existing: meta,
        currentBlob: idbCurrent,
        storage,
        thumbnail: u.thumbnail,
      };
    })
  );

  await withIdbRetry(async () => {
    const database = await initDB();
    const tx = database.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);

    await Promise.all(
      preparedUpdates.map(async (update) => {
        const existing =
          update.existing ?? (await store.get(update.id));
        if (!existing) {
          console.warn(`Photo with id ${update.id} not found, skipping update`);
          return;
        }

        const plainFlips = {
          horizontal: update.metadata.flips.horizontal,
          vertical: update.metadata.flips.vertical,
        };
        const clearThumbMeta = update.thumbnail == null;

        const updated: PhotoData = {
          ...existing,
          current: update.currentBlob,
          storage: update.storage,
          thumbnail: update.thumbnail,
          metadata: {
            name: existing.metadata.name,
            uploadedAt: existing.metadata.uploadedAt,
            expiresAt: existing.metadata.expiresAt,
            flips: plainFlips,
            crop: update.metadata.crop
              ? { ...update.metadata.crop }
              : undefined,
            rotation: update.metadata.rotation,
            thumbhash: clearThumbMeta
              ? undefined
              : existing.metadata.thumbhash,
            sourceFormat: existing.metadata.sourceFormat,
            exifNormalized: existing.metadata.exifNormalized,
            importOrigin: existing.metadata.importOrigin,
          },
        };

        await store.put(updated);
      })
    );

    await tx.done;
  }, "updatePhotosBatch");
};

export const updatePhotoThumbnail = async (
  id: string,
  thumbnail: Blob,
  thumbhash?: string
): Promise<void> => {
  await withIdbRetry(async () => {
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
  }, "updatePhotoThumbnail");
};

export const loadPhoto = async (id: string): Promise<PhotoData | undefined> => {
  const data = await withIdbRetry(async () => {
    const database = await initDB();
    return database.get(STORE_NAME, id);
  }, "loadPhoto");
  if (!data) return undefined;
  return hydratePhotoBlobs(data);
};

export const loadAllPhotos = async (): Promise<PhotoData[]> => {
  const all = await withIdbRetry(async () => {
    const database = await initDB();
    return database.getAll(STORE_NAME);
  }, "loadAllPhotos");
  return Promise.all(all.map((p) => hydratePhotoBlobs(p)));
};

export const deletePhoto = async (id: string): Promise<void> => {
  await withIdbRetry(async () => {
    const database = await initDB();
    const existing = await database.get(STORE_NAME, id);
    await database.delete(STORE_NAME, id);
    if (existing?.storage === "opfs") {
      await deletePhotoBlobsOpfs(id);
    }
  }, "deletePhoto");
  invalidateIdentityPhoto(id);
};

export const deletePhotos = async (ids: string[]): Promise<void> => {
  await withIdbRetry(async () => {
    const database = await initDB();
    const tx = database.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);

    const opfsIds: string[] = [];
    await Promise.all(
      ids.map(async (id) => {
        const existing = await store.get(id);
        if (existing?.storage === "opfs") opfsIds.push(id);
        await store.delete(id);
      })
    );
    await tx.done;
    if (opfsIds.length > 0) {
      await deletePhotosBlobsOpfs(opfsIds);
    }
  }, "deletePhotos");
  ids.forEach((id) => invalidateIdentityPhoto(id));
  console.log(`deletePhotos: Successfully deleted ${ids.length} photos`);
};

export const deleteExpiredPhotos = async (): Promise<number> => {
  return withIdbRetry(async () => {
    const database = await initDB();
    const now = Date.now();
    const tx = database.transaction(STORE_NAME, "readwrite");
    const index = tx.store.index("by-expiresAt");

    let deletedCount = 0;
    const opfsIds: string[] = [];
    let cursor = await index.openCursor(IDBKeyRange.upperBound(now));

    while (cursor) {
      if (cursor.value.storage === "opfs") {
        opfsIds.push(cursor.value.id);
      }
      await cursor.delete();
      deletedCount++;
      cursor = await cursor.continue();
    }

    await tx.done;
    if (opfsIds.length > 0) {
      await deletePhotosBlobsOpfs(opfsIds);
    }
    return deletedCount;
  }, "deleteExpiredPhotos");
};

export const cleanupExpiredPhotos = async (): Promise<number> => {
  const deleted = await deleteExpiredPhotos();
  if (deleted > 0) {
    clearIdentityCache();
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
