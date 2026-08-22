/**
 * First-use consent + OPFS cleanup for the SAM object-finder weights.
 * sam-web writes encoder/decoder files at the OPFS root (not under photos/).
 */

import {
  SAM_CONSENT_SESSION_KEY,
  SAM_MODEL_CACHE_FILES,
  SAM_RETENTION_STORAGE_KEY,
} from '../constants/optimization';
import { quietIgnorableSamLogs } from './quietSamLogs';

export type SamRetention = 'keep' | 'remove-on-leave';

let lifecycleInstalled = false;

function readStorage(storage: Storage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(storage: Storage, key: string, value: string): void {
  try {
    storage.setItem(key, value);
  } catch {
    /* ignore quota / private mode */
  }
}

function clearStorageKey(storage: Storage, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function loadSamRetention(): SamRetention | null {
  const value = readStorage(localStorage, SAM_RETENTION_STORAGE_KEY);
  if (value === 'keep' || value === 'remove-on-leave') return value;
  return null;
}

export function saveSamRetention(retention: SamRetention): void {
  writeStorage(localStorage, SAM_RETENTION_STORAGE_KEY, retention);
  writeStorage(sessionStorage, SAM_CONSENT_SESSION_KEY, retention);
}

export function hasSamConsentThisSession(): boolean {
  const session = readStorage(sessionStorage, SAM_CONSENT_SESSION_KEY);
  return session === 'keep' || session === 'remove-on-leave';
}

export async function isSamModelCached(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) {
    return false;
  }
  try {
    const root = await navigator.storage.getDirectory();
    for (const filename of SAM_MODEL_CACHE_FILES) {
      const handle = await root.getFileHandle(filename);
      const file = await handle.getFile();
      if (file.size <= 0) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export async function needsSamModelConsent(): Promise<boolean> {
  if (hasSamConsentThisSession()) return false;
  if ((await isSamModelCached()) && loadSamRetention() === 'keep') return false;
  return true;
}

export function acceptSamModelConsent(retention: SamRetention): void {
  saveSamRetention(retention);
}

export function clearSamConsent(): void {
  clearStorageKey(localStorage, SAM_RETENTION_STORAGE_KEY);
  clearStorageKey(sessionStorage, SAM_CONSENT_SESSION_KEY);
}

export async function deleteSamModelFromDevice(): Promise<void> {
  const { cancelSamModelDownload } = await import('./samModelDownload');
  cancelSamModelDownload();
  const { disposeSamSession } = await import('./webSamSession');
  disposeSamSession();
  await removeSamModelCache();
  clearSamConsent();
}

export async function removeSamModelCache(): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) {
    return;
  }
  try {
    const root = await navigator.storage.getDirectory();
    await Promise.all(
      SAM_MODEL_CACHE_FILES.map(async (filename) => {
        try {
          await root.removeEntry(filename);
        } catch {
          /* missing is fine */
        }
      })
    );
  } catch {
    /* OPFS unavailable */
  }
}

export async function disposeSamAndMaybeRemoveCache(): Promise<void> {
  const { disposeSamSession } = await import('./webSamSession');
  disposeSamSession();
  if (loadSamRetention() === 'remove-on-leave') {
    await removeSamModelCache();
    clearStorageKey(sessionStorage, SAM_CONSENT_SESSION_KEY);
  }
}

export function installSamCacheLifecycle(): void {
  if (lifecycleInstalled || typeof window === 'undefined') return;
  lifecycleInstalled = true;
  quietIgnorableSamLogs();

  if (loadSamRetention() === 'remove-on-leave' && !hasSamConsentThisSession()) {
    void removeSamModelCache();
  }

  const onLeave = () => {
    void disposeSamAndMaybeRemoveCache();
  };
  window.addEventListener('pagehide', onLeave);
}
