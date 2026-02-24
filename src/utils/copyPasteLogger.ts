/**
 * Copy/Paste Operation Logger
 * Tracks copy and paste operations for debugging transformation issues
 */

export interface CopiedSettings {
  flips: { horizontal: boolean; vertical: boolean };
  crop?: { x: number; y: number; width: number; height: number };
  rotation?: number;
}

export interface PhotoState {
  flips: { horizontal: boolean; vertical: boolean };
  crop?: { x: number; y: number; width: number; height: number };
  rotation?: number;
  hasEdits: boolean;
}

export interface CopyOperation {
  type: 'copy';
  timestamp: number;
  sourceIndex: number;
  settings: CopiedSettings;
}

export interface PasteOperation {
  type: 'paste';
  timestamp: number;
  sourceIndex?: number; // Index that was copied from (if available)
  targetIndices: number[];
  copiedSettings: CopiedSettings;
  results: Array<{
    targetIndex: number;
    beforeState: PhotoState;
    afterState: PhotoState;
    hasConflict: boolean;
    conflictDetails?: string[];
    usedOriginalImage: boolean; // Whether paste used original image (to prevent compounding)
  }>;
}

export type CopyPasteOperation = CopyOperation | PasteOperation;

class CopyPasteLogger {
  private operations: CopyPasteOperation[] = [];
  private maxOperations = 100; // Limit to prevent memory issues

  /**
   * Log a copy operation
   */
  logCopy(sourceIndex: number, settings: CopiedSettings): void {
    const operation: CopyOperation = {
      type: 'copy',
      timestamp: Date.now(),
      sourceIndex,
      settings: { ...settings },
    };

    this.operations.push(operation);
    this.trimOperations();
  }

  /**
   * Log a paste operation
   */
  logPaste(
    targetIndices: number[],
    copiedSettings: CopiedSettings,
    results: Array<{
      targetIndex: number;
      beforeState: PhotoState;
      afterState: PhotoState;
      hasConflict: boolean;
      conflictDetails?: string[];
      usedOriginalImage: boolean;
    }>,
    sourceIndex?: number
  ): void {
    const operation: PasteOperation = {
      type: 'paste',
      timestamp: Date.now(),
      sourceIndex,
      targetIndices: [...targetIndices],
      copiedSettings: { ...copiedSettings },
      results: results.map(r => ({
        ...r,
        beforeState: { ...r.beforeState },
        afterState: { ...r.afterState },
        conflictDetails: r.conflictDetails ? [...r.conflictDetails] : undefined,
      })),
    };

    this.operations.push(operation);
    this.trimOperations();
  }

  /**
   * Get all operations
   */
  getOperations(): CopyPasteOperation[] {
    return [...this.operations];
  }

  /**
   * Get only paste operations
   */
  getPasteOperations(): PasteOperation[] {
    return this.operations.filter(
      op => op.type === 'paste'
    ) as PasteOperation[];
  }

  /**
   * Get only copy operations
   */
  getCopyOperations(): CopyOperation[] {
    return this.operations.filter(
      op => op.type === 'copy'
    ) as CopyOperation[];
  }

  /**
   * Get the most recent copy operation
   */
  getLatestCopy(): CopyOperation | null {
    const copyOps = this.getCopyOperations();
    return copyOps.length > 0 ? copyOps[copyOps.length - 1] : null;
  }

  /**
   * Clear all operations
   */
  clear(): void {
    this.operations = [];
  }

  /**
   * Export operations as JSON
   */
  exportJSON(): void {
    const data = JSON.stringify(this.operations, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `copy-paste-ops-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /**
   * Check if a paste operation had conflicts
   */
  hasConflicts(operation: PasteOperation): boolean {
    return operation.results.some(r => r.hasConflict);
  }

  /**
   * Get summary statistics
   */
  getSummary(): {
    totalCopies: number;
    totalPastes: number;
    totalImagesPasted: number;
    operationsWithConflicts: number;
  } {
    const pastes = this.getPasteOperations();
    const copies = this.getCopyOperations();
    const operationsWithConflicts = pastes.filter(op => this.hasConflicts(op)).length;
    const totalImagesPasted = pastes.reduce(
      (sum, op) => sum + op.targetIndices.length,
      0
    );

    return {
      totalCopies: copies.length,
      totalPastes: pastes.length,
      totalImagesPasted,
      operationsWithConflicts,
    };
  }

  /**
   * Trim operations if exceeding max
   */
  private trimOperations(): void {
    if (this.operations.length > this.maxOperations) {
      this.operations = this.operations.slice(-this.maxOperations);
    }
  }
}

// Singleton instance
export const copyPasteLogger = new CopyPasteLogger();

