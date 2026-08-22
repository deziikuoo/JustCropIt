import { ref, watch } from 'vue';
import {
  EXPORT_DESTINATION_DEFAULT,
  EXPORT_DESTINATION_SESSION_KEY,
} from '../constants/optimization';
import type { ExportDestination } from '../types/export';

function isExportDestination(value: string | null): value is ExportDestination {
  return value === 'ask' || value === 'replace' || value === 'copy';
}

function readDestinationPreference(): ExportDestination {
  if (typeof sessionStorage === 'undefined') return EXPORT_DESTINATION_DEFAULT;
  const stored = sessionStorage.getItem(EXPORT_DESTINATION_SESSION_KEY);
  return isExportDestination(stored) ? stored : EXPORT_DESTINATION_DEFAULT;
}

const exportDestination = ref<ExportDestination>(readDestinationPreference());

let watcherInitialized = false;

function ensureWatcher(): void {
  if (watcherInitialized) return;
  watcherInitialized = true;

  watch(exportDestination, (value) => {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(EXPORT_DESTINATION_SESSION_KEY, value);
    }
  });
}

export function useExportDestination() {
  ensureWatcher();

  return {
    exportDestination,
  };
}
