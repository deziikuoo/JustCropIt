import { ref, onMounted, onUnmounted, inject } from 'vue';
import type { HistoryPanelState } from '../types/history';
import { UNDO_REDO_MANAGER_KEY } from '../types/history';
import type { UndoRedoManager } from '../utils/undoRedo';
import { UNDO_TO_NAV_DEBOUNCE_MS } from '../constants/optimization';
import { performanceLogger } from '../utils/performanceLogger';

const isOpen = ref(false);
const panelState = ref<HistoryPanelState>({
  undoEntries: [],
  redoEntries: [],
  pointer: 0,
  truncatedCount: 0,
});
const isNavigating = ref(false);

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let subscriberCount = 0;
let unsubscribe: (() => void) | null = null;

export function useOperationHistory(explicitManager?: UndoRedoManager) {
  const resolved =
    explicitManager ?? inject<UndoRedoManager>(UNDO_REDO_MANAGER_KEY);
  if (!resolved) {
    throw new Error(
      'useOperationHistory requires UndoRedoManager via provide or explicit argument'
    );
  }
  const manager: UndoRedoManager = resolved;

  const refresh = () => {
    panelState.value = manager.getHistoryPanelState();
    isNavigating.value = manager.getIsNavigating();
  };

  onMounted(() => {
    subscriberCount++;
    if (subscriberCount === 1) {
      refresh();
      unsubscribe = manager.subscribe(refresh);
    }
  });

  onUnmounted(() => {
    subscriberCount--;
    if (subscriberCount === 0) {
      unsubscribe?.();
      unsubscribe = null;
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
    }
  });

  const toggleOpen = () => {
    isOpen.value = !isOpen.value;
  };

  const close = () => {
    isOpen.value = false;
  };

  async function undo(): Promise<void> {
    const operationId = `history-undo-${Date.now()}`;
    performanceLogger.startMeasurement(operationId);
    try {
      await manager.undo();
      refresh();
    } finally {
      await performanceLogger.endMeasurement(operationId, 'history-navigate', 1, false);
    }
  }

  async function redo(): Promise<void> {
    const operationId = `history-redo-${Date.now()}`;
    performanceLogger.startMeasurement(operationId);
    try {
      await manager.redo();
      refresh();
    } finally {
      await performanceLogger.endMeasurement(operationId, 'history-navigate', 1, false);
    }
  }

  async function navigateToEntry(undoIndex: number): Promise<void> {
    if (debounceTimer) return;

    debounceTimer = setTimeout(() => {
      debounceTimer = null;
    }, UNDO_TO_NAV_DEBOUNCE_MS);

    const targetPointer = undoIndex + 1;
    if (targetPointer >= panelState.value.pointer) return;

    const operationId = `history-nav-${Date.now()}`;
    performanceLogger.startMeasurement(operationId);
    isNavigating.value = true;

    try {
      const steps = await manager.undoTo(targetPointer);
      refresh();
      await performanceLogger.endMeasurement(
        operationId,
        'history-navigate',
        steps,
        false
      );
    } catch (error) {
      console.error('History navigation failed:', error);
      refresh();
    } finally {
      isNavigating.value = false;
    }
  }

  return {
    panelState,
    isOpen,
    isNavigating,
    toggleOpen,
    close,
    undo,
    redo,
    navigateToEntry,
    canUndo: () => manager.canUndo(),
    canRedo: () => manager.canRedo(),
  };
}
