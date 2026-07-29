/**
 * Export pipeline types (Phase 2)
 */

export interface ExportSettings {
  stripExifOnExport: boolean;
}

export type ExportPath = 'passthrough' | 'fast-path' | 'slow-path';

export interface PreparedExport {
  buffer: ArrayBuffer;
  fileName: string;
  mimeType: string;
  path: ExportPath;
  workerUsed: boolean;
}

export interface ExportBatchStats {
  passThroughCount: number;
  fastPathCount: number;
  slowPathCount: number;
  workerUsed: boolean;
}
