import { ref, watch } from 'vue';
import {
  EXPORT_SETTINGS_SESSION_KEY,
  EXPORT_STRIP_DEFAULT,
} from '../constants/optimization';
import type { ExportSettings } from '../types/export';

function readStripPreference(): boolean {
  if (typeof sessionStorage === 'undefined') return EXPORT_STRIP_DEFAULT;
  const stored = sessionStorage.getItem(EXPORT_SETTINGS_SESSION_KEY);
  if (stored === null) return EXPORT_STRIP_DEFAULT;
  return stored === 'true';
}

const stripExifOnExport = ref(readStripPreference());

let watcherInitialized = false;

function ensureWatcher(): void {
  if (watcherInitialized) return;
  watcherInitialized = true;

  watch(stripExifOnExport, (value) => {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(EXPORT_SETTINGS_SESSION_KEY, String(value));
    }
  });
}

export function useExportSettings() {
  ensureWatcher();

  const settings = (): ExportSettings => ({
    stripExifOnExport: stripExifOnExport.value,
  });

  return {
    stripExifOnExport,
    settings,
  };
}
