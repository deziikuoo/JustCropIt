/**
 * Export pipeline types (Phase 2)
 */

export interface ExportSettings {
  stripExifOnExport: boolean;
}

/** Session preference for download destination. */
export type ExportDestination = 'ask' | 'replace' | 'copy';

export type ExportDestinationChoice = Exclude<ExportDestination, 'ask'>;

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
