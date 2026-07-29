import type { HistoryEntrySnapshot, HistoryPanelState } from '../../types/history';
import type { HistoryEntry } from './types';

function entryToSnapshot(
  entry: HistoryEntry,
  stackSide: 'undo' | 'redo',
  undoIndex: number
): HistoryEntrySnapshot {
  return {
    id: `${entry.timestamp}-${undoIndex}-${stackSide}`,
    description: entry.command.getDescription(),
    timestamp: entry.timestamp,
    affectedCount: entry.affectedPhotoIds.length,
    stackSide,
    undoIndex,
  };
}

export function buildHistoryPanelState(
  undoStack: HistoryEntry[],
  redoStack: HistoryEntry[],
  truncatedCount: number
): HistoryPanelState {
  const undoEntries = undoStack.map((entry, index) =>
    entryToSnapshot(entry, 'undo', index)
  );

  const redoEntries = redoStack
    .map((entry, index) =>
      entryToSnapshot(entry, 'redo', undoStack.length + index)
    )
    .reverse();

  return {
    undoEntries,
    redoEntries,
    pointer: undoStack.length,
    truncatedCount,
  };
}
