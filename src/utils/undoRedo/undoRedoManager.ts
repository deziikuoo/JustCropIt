/**
 * Undo/Redo Manager
 * Central manager for undo/redo operations using Command Pattern
 */

import type { HistoryPanelState } from '../../types/history';
import { buildHistoryPanelState } from './historySnapshots';
import type { Command, HistoryEntry } from './types';
import { comparePhotoStates } from './types';

export class UndoRedoManager {
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private maxHistorySize: number = 50;
  private truncatedCount: number = 0;
  private listeners = new Set<() => void>();
  private isNavigating = false;

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  getHistoryPanelState(): HistoryPanelState {
    return buildHistoryPanelState(
      this.undoStack,
      this.redoStack,
      this.truncatedCount
    );
  }

  getIsNavigating(): boolean {
    return this.isNavigating;
  }

  /**
   * Undo until undo stack length equals targetPointer.
   * pointer 0 = no actions applied; pointer === undoStack.length = current state.
   */
  async undoTo(targetPointer: number): Promise<number> {
    if (this.isNavigating) {
      throw new Error('History navigation already in progress');
    }

    const clampedTarget = Math.max(
      0,
      Math.min(targetPointer, this.undoStack.length)
    );

    if (clampedTarget === this.undoStack.length) {
      return 0;
    }

    this.isNavigating = true;
    let stepsUndone = 0;

    try {
      while (this.undoStack.length > clampedTarget) {
        const didUndo = await this.undo();
        if (!didUndo) break;
        stepsUndone++;
      }
      return stepsUndone;
    } finally {
      this.isNavigating = false;
      this.notifyListeners();
    }
  }

  /**
   * Execute a command and add it to the undo stack
   */
  async executeCommand(command: Command): Promise<void> {
    if (!command.validate()) {
      throw new Error('Command validation failed');
    }

    const beforeState = command.captureState?.();

    try {
      await command.execute();

      const afterState = command.captureState?.();

      if (beforeState && afterState) {
        if (beforeState instanceof Map && afterState instanceof Map) {
          let hasChanges = false;
          for (const [photoId, beforePhotoState] of beforeState) {
            const afterPhotoState = afterState.get(photoId);
            if (
              afterPhotoState &&
              !comparePhotoStates(beforePhotoState, afterPhotoState)
            ) {
              hasChanges = true;
              break;
            }
          }
          if (!hasChanges) {
            return;
          }
        } else if (
          !(beforeState instanceof Map) &&
          !(afterState instanceof Map)
        ) {
          if (comparePhotoStates(beforeState, afterState)) {
            return;
          }
        }
      }

      const entry: HistoryEntry = {
        command,
        timestamp: Date.now(),
        affectedPhotoIds: command.getAffectedPhotoIds(),
      };

      this.undoStack.push(entry);
      this.redoStack = [];
      this.enforceMaxSize();
      this.notifyListeners();
    } catch (error) {
      try {
        await command.undo();
      } catch (rollbackError) {
        console.error(
          'Rollback failed after command execution error:',
          rollbackError
        );
      }
      throw error;
    }
  }

  async undo(): Promise<boolean> {
    if (this.undoStack.length === 0) {
      return false;
    }

    const entry = this.undoStack.pop()!;
    try {
      await entry.command.undo();
      this.redoStack.push(entry);
      if (!this.isNavigating) {
        this.notifyListeners();
      }
      return true;
    } catch (error) {
      this.undoStack.push(entry);
      console.error('Undo operation failed:', error);
      throw error;
    }
  }

  async redo(): Promise<boolean> {
    if (this.redoStack.length === 0) {
      return false;
    }

    const entry = this.redoStack.pop()!;
    try {
      await entry.command.execute();
      this.undoStack.push(entry);
      this.notifyListeners();
      return true;
    } catch (error) {
      this.redoStack.push(entry);
      console.error('Redo operation failed:', error);
      throw error;
    }
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.truncatedCount = 0;
    this.notifyListeners();
  }

  onPhotoDeleted(photoId: string): void {
    this.undoStack = this.undoStack.filter(
      (entry) => !entry.affectedPhotoIds.includes(photoId)
    );

    this.redoStack = this.redoStack.filter(
      (entry) => !entry.affectedPhotoIds.includes(photoId)
    );

    this.notifyListeners();
  }

  private enforceMaxSize(): void {
    if (this.undoStack.length > this.maxHistorySize) {
      const removedCount = this.undoStack.length - this.maxHistorySize;
      this.undoStack.splice(0, removedCount);
      this.truncatedCount += removedCount;
    }
  }

  getHistorySize(): { undo: number; redo: number } {
    return {
      undo: this.undoStack.length,
      redo: this.redoStack.length,
    };
  }

  setMaxHistorySize(size: number): void {
    this.maxHistorySize = Math.max(1, size);
    this.enforceMaxSize();
    this.notifyListeners();
  }
}
