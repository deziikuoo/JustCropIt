/**
 * Feature-detect storage backends. No UA blocking — Brave/Opera/Vivaldi/Comet/Edge
 * share Chromium OPFS; Safari/Firefox use the same probe and fall back to IDB.
 */

export type BlobBackend = 'opfs' | 'idb';

let opfsProbe: Promise<boolean> | null = null;
let opfsAvailableCached: boolean | null = null;
let persistRequested = false;

export function isSecureStorageContext(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext === true;
}

/**
 * Probe Origin Private File System with a throwaway write.
 * Result is cached for the session.
 */
export async function probeOpfsAvailable(): Promise<boolean> {
  if (opfsAvailableCached != null) return opfsAvailableCached;
  if (opfsProbe) return opfsProbe;

  opfsProbe = (async () => {
    try {
      if (!isSecureStorageContext()) {
        opfsAvailableCached = false;
        return false;
      }
      const storage = navigator.storage;
      if (!storage || typeof storage.getDirectory !== 'function') {
        opfsAvailableCached = false;
        return false;
      }
      const root = await storage.getDirectory();
      const dir = await root.getDirectoryHandle('__justcropit_probe__', {
        create: true,
      });
      const file = await dir.getFileHandle('probe.bin', { create: true });
      const writable = await file.createWritable();
      await writable.write(new Uint8Array([1, 2, 3]));
      await writable.close();
      await root.removeEntry('__justcropit_probe__', { recursive: true });
      opfsAvailableCached = true;
      return true;
    } catch (error) {
      console.warn('[storage] OPFS unavailable; using IndexedDB blobs', error);
      opfsAvailableCached = false;
      return false;
    }
  })();

  return opfsProbe;
}

export async function getPreferredBlobBackend(): Promise<BlobBackend> {
  return (await probeOpfsAvailable()) ? 'opfs' : 'idb';
}

/** Best-effort persistent storage (ignored if denied — Safari/private often deny). */
export async function requestPersistentStorage(): Promise<boolean> {
  if (persistRequested) return false;
  persistRequested = true;
  try {
    if (!navigator.storage?.persist) return false;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

/** Reset probe cache (tests / after catastrophic OPFS failure). */
export function resetStorageCapabilityCache(): void {
  opfsProbe = null;
  opfsAvailableCached = null;
}
