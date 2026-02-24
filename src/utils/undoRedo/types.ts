/**
 * Undo/Redo System Types
 * Type definitions for the undo/redo command pattern implementation
 */

/**
 * Photo state snapshot - stores only transformation state, not image data
 */
export interface PhotoState {
  flips: { horizontal: boolean; vertical: boolean };
  crop?: { x: number; y: number; width: number; height: number };
  rotation?: number;
}

/**
 * Command interface - all undo/redo commands must implement this
 */
export interface Command {
  /**
   * Execute the command
   */
  execute(): Promise<void>;

  /**
   * Undo the command
   */
  undo(): Promise<void>;

  /**
   * Validate if the command can be executed
   */
  validate(): boolean;

  /**
   * Get the photo IDs affected by this command
   */
  getAffectedPhotoIds(): string[];

  /**
   * Get a human-readable description of the command
   */
  getDescription(): string;

  /**
   * Capture the current state before execution (for comparison)
   */
  captureState?(): PhotoState | Map<string, PhotoState>;
}

/**
 * History entry stored in undo/redo stacks
 */
export interface HistoryEntry {
  command: Command;
  timestamp: number;
  affectedPhotoIds: string[];
}

/**
 * Compare two photo states to determine if they are equal
 * Used to skip adding duplicate states to history
 */
export function comparePhotoStates(a: PhotoState, b: PhotoState): boolean {
  // Compare flips
  if (
    a.flips.horizontal !== b.flips.horizontal ||
    a.flips.vertical !== b.flips.vertical
  ) {
    return false;
  }

  // Compare rotation
  if (a.rotation !== b.rotation) {
    return false;
  }

  // Compare crop (handle undefined cases)
  if (!a.crop && !b.crop) {
    return true; // Both undefined
  }
  if (!a.crop || !b.crop) {
    return false; // One is undefined, other is not
  }

  // Compare crop coordinates
  return (
    a.crop.x === b.crop.x &&
    a.crop.y === b.crop.y &&
    a.crop.width === b.crop.width &&
    a.crop.height === b.crop.height
  );
}
