/**
 * Undo/Redo Manager
 * Central manager for undo/redo operations using Command Pattern
 */

import type { Command, HistoryEntry, PhotoState } from "./types";
import { comparePhotoStates } from "./types";

export class UndoRedoManager {
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private maxHistorySize: number = 50;

  /**
   * Execute a command and add it to the undo stack
   */
  async executeCommand(command: Command): Promise<void> {
    // Validate command before execution
    if (!command.validate()) {
      throw new Error("Command validation failed");
    }

    // Capture state before execution for comparison
    const beforeState = command.captureState?.();

    try {
      // Execute the command
      await command.execute();

      // Capture state after execution
      const afterState = command.captureState?.();

      // Skip adding to history if state didn't change
      if (beforeState && afterState) {
        if (beforeState instanceof Map && afterState instanceof Map) {
          // Multiple photos - check if any changed
          let hasChanges = false;
          for (const [photoId, beforePhotoState] of beforeState) {
            const afterPhotoState = afterState.get(photoId);
            if (afterPhotoState && !comparePhotoStates(beforePhotoState, afterPhotoState)) {
              hasChanges = true;
              break;
            }
          }
          if (!hasChanges) {
            return; // No changes, skip adding to history
          }
        } else if (
          !(beforeState instanceof Map) &&
          !(afterState instanceof Map)
        ) {
          // Single photo
          if (comparePhotoStates(beforeState, afterState)) {
            return; // No changes, skip adding to history
          }
        }
      }

      // Add to undo stack
      const entry: HistoryEntry = {
        command,
        timestamp: Date.now(),
        affectedPhotoIds: command.getAffectedPhotoIds(),
      };

      this.undoStack.push(entry);
      this.redoStack = []; // Clear redo stack on new action
      this.enforceMaxSize();
    } catch (error) {
      // Rollback attempt - try to undo if possible
      try {
        await command.undo();
      } catch (rollbackError) {
        console.error("Rollback failed after command execution error:", rollbackError);
      }
      throw error; // Re-throw original error
    }
  }

  /**
   * Undo the last command
   */
  async undo(): Promise<boolean> {
    if (this.undoStack.length === 0) {
      return false;
    }

    const entry = this.undoStack.pop()!;
    try {
      await entry.command.undo();
      this.redoStack.push(entry);
      return true;
    } catch (error) {
      // If undo fails, put the entry back
      this.undoStack.push(entry);
      console.error("Undo operation failed:", error);
      throw error;
    }
  }

  /**
   * Redo the last undone command
   */
  async redo(): Promise<boolean> {
    if (this.redoStack.length === 0) {
      return false;
    }

    const entry = this.redoStack.pop()!;
    try {
      await entry.command.execute();
      this.undoStack.push(entry);
      return true;
    } catch (error) {
      // If redo fails, put the entry back
      this.redoStack.push(entry);
      console.error("Redo operation failed:", error);
      throw error;
    }
  }

  /**
   * Check if undo is available
   */
  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  /**
   * Check if redo is available
   */
  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /**
   * Clear all undo/redo history
   */
  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }

  /**
   * Remove history entries for a deleted photo
   */
  onPhotoDeleted(photoId: string): void {
    // Remove from undo stack
    this.undoStack = this.undoStack.filter(
      (entry) => !entry.affectedPhotoIds.includes(photoId)
    );

    // Remove from redo stack
    this.redoStack = this.redoStack.filter(
      (entry) => !entry.affectedPhotoIds.includes(photoId)
    );
  }

  /**
   * Enforce maximum history size
   */
  private enforceMaxSize(): void {
    if (this.undoStack.length > this.maxHistorySize) {
      // Remove oldest entries
      const removedCount = this.undoStack.length - this.maxHistorySize;
      this.undoStack.splice(0, removedCount);
    }
  }

  /**
   * Get the current history size
   */
  getHistorySize(): { undo: number; redo: number } {
    return {
      undo: this.undoStack.length,
      redo: this.redoStack.length,
    };
  }

  /**
   * Set the maximum history size
   */
  setMaxHistorySize(size: number): void {
    this.maxHistorySize = Math.max(1, size);
    this.enforceMaxSize();
  }
}
