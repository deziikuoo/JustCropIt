/**
 * Operation history panel types (Phase 3)
 */

export type HistoryStackSide = 'undo' | 'redo';

export interface HistoryEntrySnapshot {
  id: string;
  description: string;
  timestamp: number;
  affectedCount: number;
  stackSide: HistoryStackSide;
  undoIndex: number;
}

export interface HistoryPanelState {
  undoEntries: HistoryEntrySnapshot[];
  redoEntries: HistoryEntrySnapshot[];
  pointer: number;
  truncatedCount: number;
}

export const UNDO_REDO_MANAGER_KEY = Symbol('undoRedoManager');
