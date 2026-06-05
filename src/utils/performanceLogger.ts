/**
 * Performance Logger Utility
 * 
 * Tracks and logs performance metrics for image processing operations.
 * Provides clean, readable output and export capabilities for performance analysis.
 */

export interface PerformanceMetrics {
  operationType: 'flip-horizontal' | 'flip-vertical' | 'crop' | 'paste' | 'download' | 'delete' | 'upload' | 'select-drag' | 'select-all' | 'revert' | 'video-extract';
  batchSize: number;
  totalTime: number; // Total operation time in milliseconds
  perImageTime: number; // Average time per image in milliseconds
  memoryBefore?: number; // Memory usage before operation (MB)
  memoryAfter?: number; // Memory usage after operation (MB)
  timestamp: number; // When the operation occurred
  workerUsed: boolean; // Whether Web Workers were used
}

export interface GridRuntimeSnapshot {
  gridUrlsActive: number;
  gridDecodesQueued: number;
  visibleIndices: number;
  timestamp: number;
}

const GRID_SNAPSHOT_MAX = 120;

class PerformanceLogger {
  private metrics: PerformanceMetrics[] = [];
  private activeMeasurements: Map<string, number> = new Map();
  private gridSnapshots: GridRuntimeSnapshot[] = [];

  /**
   * Start measuring an operation
   * @param operationId - Unique identifier for this operation
   */
  startMeasurement(operationId: string): void {
    this.activeMeasurements.set(operationId, performance.now());
    performance.mark(`${operationId}-start`);
  }

  /**
   * End measurement and record metrics
   * @param operationId - Unique identifier matching the start measurement
   * @param operationType - Type of operation performed
   * @param batchSize - Number of images processed
   * @param workerUsed - Whether Web Workers were used (default: false)
   * @returns The recorded performance metrics
   */
  async endMeasurement(
    operationId: string,
    operationType: PerformanceMetrics['operationType'],
    batchSize: number,
    workerUsed: boolean = false
  ): Promise<PerformanceMetrics> {
    const startTime = this.activeMeasurements.get(operationId);
    if (!startTime) {
      console.warn(`[Performance Logger] No start time found for operation: ${operationId}`);
      // Fallback: try to get from performance marks
      performance.mark(`${operationId}-end`);
      performance.measure(operationId, `${operationId}-start`, `${operationId}-end`);
    } else {
      performance.mark(`${operationId}-end`);
      performance.measure(operationId, `${operationId}-start`, `${operationId}-end`);
    }

    const measure = performance.getEntriesByName(operationId, 'measure')[0] as PerformanceMeasure;
    if (!measure) {
      console.warn(`[Performance Logger] Could not find performance measure for: ${operationId}`);
      // Fallback to manual calculation
      const endTime = performance.now();
      const totalTime = startTime ? endTime - startTime : 0;
      
      const memory = (performance as any).memory;
      const memoryData = memory ? {
        memoryBefore: Math.round(memory.usedJSHeapSize / 1024 / 1024),
        memoryAfter: Math.round(memory.usedJSHeapSize / 1024 / 1024),
      } : {};

      const metric: PerformanceMetrics = {
        operationType,
        batchSize,
        totalTime: Math.round(totalTime),
        perImageTime: batchSize > 0 ? Math.round(totalTime / batchSize) : 0,
        ...memoryData,
        timestamp: Date.now(),
        workerUsed,
      };

      this.metrics.push(metric);
      this.activeMeasurements.delete(operationId);
      this.logMetric(metric);
      
      return metric;
    }

    const totalTime = measure.duration;
    const perImageTime = batchSize > 0 ? totalTime / batchSize : 0;

    // Get memory info if available (Chrome/Edge only)
    const memory = (performance as any).memory;
    const memoryData = memory ? {
      memoryBefore: Math.round(memory.usedJSHeapSize / 1024 / 1024),
      memoryAfter: Math.round(memory.usedJSHeapSize / 1024 / 1024),
    } : {};

    const metric: PerformanceMetrics = {
      operationType,
      batchSize,
      totalTime: Math.round(totalTime),
      perImageTime: Math.round(perImageTime),
      ...memoryData,
      timestamp: Date.now(),
      workerUsed,
    };

    this.metrics.push(metric);
    this.activeMeasurements.delete(operationId);
    
    // Clean up performance marks
    try {
      performance.clearMarks(`${operationId}-start`);
      performance.clearMarks(`${operationId}-end`);
      performance.clearMeasures(operationId);
    } catch (e) {
      // Ignore cleanup errors
    }

    this.logMetric(metric);
    return metric;
  }

  /**
   * Log a metric to console in a readable format
   */
  private logMetric(metric: PerformanceMetrics): void {
    if (!import.meta.env.DEV) return; // Only log in development

    console.log(`\n📊 ${metric.operationType.toUpperCase()} Performance:`);
    console.log(`   Images: ${metric.batchSize}`);
    console.log(`   Total Time: ${(metric.totalTime / 1000).toFixed(2)}s (${metric.totalTime}ms)`);
    console.log(`   Per Image: ${metric.perImageTime.toFixed(2)}ms`);
    if (metric.memoryBefore !== undefined && metric.memoryAfter !== undefined) {
      const memoryChange = metric.memoryAfter - metric.memoryBefore;
      const memoryChangeStr = memoryChange >= 0 ? `+${memoryChange}` : `${memoryChange}`;
      console.log(`   Memory: ${metric.memoryBefore}MB → ${metric.memoryAfter}MB (${memoryChangeStr}MB)`);
    }
    console.log(`   Method: ${metric.workerUsed ? '🚀 Web Workers' : '🐌 Main Thread'}\n`);
  }

  /**
   * Get all recorded metrics
   */
  getMetrics(): PerformanceMetrics[] {
    return [...this.metrics];
  }

  /**
   * Get metrics grouped by operation type
   */
  private groupByOperation(): Record<string, PerformanceMetrics[]> {
    const grouped: Record<string, PerformanceMetrics[]> = {};
    this.metrics.forEach(m => {
      if (!grouped[m.operationType]) {
        grouped[m.operationType] = [];
      }
      grouped[m.operationType].push(m);
    });
    return grouped;
  }

  /**
   * Get average metrics for a specific operation type
   */
  getAverageMetrics(operationType: PerformanceMetrics['operationType']): {
    avgTotalTime: number;
    avgPerImageTime: number;
    sampleCount: number;
    totalImages: number;
  } {
    const filtered = this.metrics.filter(m => m.operationType === operationType);
    if (filtered.length === 0) {
      return { avgTotalTime: 0, avgPerImageTime: 0, sampleCount: 0, totalImages: 0 };
    }

    const avgTotalTime = filtered.reduce((sum, m) => sum + m.totalTime, 0) / filtered.length;
    const avgPerImageTime = filtered.reduce((sum, m) => sum + m.perImageTime, 0) / filtered.length;
    const totalImages = filtered.reduce((sum, m) => sum + m.batchSize, 0);

    return {
      avgTotalTime,
      avgPerImageTime,
      sampleCount: filtered.length,
      totalImages,
    };
  }

  /**
   * Generate a readable summary table
   */
  getSummary(): string {
    const summary: string[] = [];
    summary.push('\n╔══════════════════════════════════════════════════╗');
    summary.push('║        PERFORMANCE METRICS SUMMARY               ║');
    summary.push('╠══════════════════════════════════════════════════╣');
    
    const grouped = this.groupByOperation();
    
    Object.entries(grouped).forEach(([type, metrics]) => {
      const avgTime = metrics.reduce((sum, m) => sum + m.totalTime, 0) / metrics.length;
      const avgPerImage = metrics.reduce((sum, m) => sum + m.perImageTime, 0) / metrics.length;
      const totalImages = metrics.reduce((sum, m) => sum + m.batchSize, 0);
      
      summary.push(`║ ${type.toUpperCase().padEnd(48)} ║`);
      summary.push(`║   Operations: ${metrics.length.toString().padEnd(37)} ║`);
      summary.push(`║   Total Images: ${totalImages.toString().padEnd(35)} ║`);
      summary.push(`║   Avg Total Time: ${(avgTime / 1000).toFixed(2)}s`.padEnd(48) + ' ║');
      summary.push(`║   Avg Per Image: ${avgPerImage.toFixed(2)}ms`.padEnd(48) + ' ║');
      summary.push('╠══════════════════════════════════════════════════╣');
    });
    
    summary.push('╚══════════════════════════════════════════════════╝\n');
    return summary.join('\n');
  }

  /**
   * Print summary to console
   */
  printSummary(): void {
    if (import.meta.env.DEV) {
      console.log(this.getSummary());
    }
  }

  /**
   * Export metrics as JSON
   */
  exportJSON(): string {
    return JSON.stringify(this.metrics, null, 2);
  }

  /**
   * Export metrics as CSV (readable format)
   */
  exportCSV(): string {
    const headers = 'Operation, Batch Size, Total Time (ms), Per Image (ms), Memory Before (MB), Memory After (MB), Method, Timestamp\n';
    const rows = this.metrics.map(m => {
      const timestamp = new Date(m.timestamp).toISOString();
      const method = m.workerUsed ? 'Workers' : 'Main Thread';
      return `${m.operationType}, ${m.batchSize}, ${m.totalTime}, ${m.perImageTime.toFixed(2)}, ${m.memoryBefore || 'N/A'}, ${m.memoryAfter || 'N/A'}, ${method}, ${timestamp}`;
    }).join('\n');
    return headers + rows;
  }

  /**
   * Export metrics as a downloadable file
   */
  exportToFile(format: 'json' | 'csv' = 'json'): void {
    const content = format === 'json' ? this.exportJSON() : this.exportCSV();
    const mimeType = format === 'json' ? 'application/json' : 'text/csv';
    const extension = format === 'json' ? 'json' : 'csv';
    
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `performance-metrics-${Date.now()}.${extension}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /**
   * Compare two sets of metrics (before/after)
   */
  compareMetrics(before: PerformanceMetrics[], after: PerformanceMetrics[]): {
    operationType: string;
    improvement: number; // Percentage improvement (positive = faster)
    beforeAvg: number;
    afterAvg: number;
    beforeCount: number;
    afterCount: number;
  }[] {
    const operations = ['flip-horizontal', 'flip-vertical', 'crop', 'paste', 'download', 'delete', 'upload', 'select-drag', 'select-all', 'revert'] as const;
    
    return operations.map(op => {
      const beforeOps = before.filter(m => m.operationType === op);
      const afterOps = after.filter(m => m.operationType === op);
      
      if (beforeOps.length === 0 || afterOps.length === 0) {
        return {
          operationType: op,
          improvement: 0,
          beforeAvg: 0,
          afterAvg: 0,
          beforeCount: beforeOps.length,
          afterCount: afterOps.length,
        };
      }

      const beforeAvg = beforeOps.reduce((sum, m) => sum + m.totalTime, 0) / beforeOps.length;
      const afterAvg = afterOps.reduce((sum, m) => sum + m.totalTime, 0) / afterOps.length;
      const improvement = ((beforeAvg - afterAvg) / beforeAvg) * 100;

      return {
        operationType: op,
        improvement,
        beforeAvg,
        afterAvg,
        beforeCount: beforeOps.length,
        afterCount: afterOps.length,
      };
    }).filter(comp => comp.beforeCount > 0 || comp.afterCount > 0);
  }

  /**
   * Clear all recorded metrics
   */
  clearMetrics(): void {
    this.metrics = [];
    this.activeMeasurements.clear();
  }

  /**
   * Get total images processed across all operations
   */
  getTotalImagesProcessed(): number {
    return this.metrics.reduce((sum, m) => sum + m.batchSize, 0);
  }

  /**
   * Get total operations count
   */
  getTotalOperations(): number {
    return this.metrics.length;
  }

  /**
   * Record grid runtime metrics (dev-only storage).
   */
  recordGridSnapshot(
    snapshot: Omit<GridRuntimeSnapshot, 'timestamp'>
  ): void {
    if (!import.meta.env.DEV) return;

    this.gridSnapshots.push({
      ...snapshot,
      timestamp: Date.now(),
    });

    while (this.gridSnapshots.length > GRID_SNAPSHOT_MAX) {
      this.gridSnapshots.shift();
    }
  }

  getLatestGridSnapshot(): GridRuntimeSnapshot | null {
    if (this.gridSnapshots.length === 0) return null;
    return this.gridSnapshots[this.gridSnapshots.length - 1];
  }

  getGridSnapshots(limit?: number): GridRuntimeSnapshot[] {
    if (limit === undefined || limit >= this.gridSnapshots.length) {
      return [...this.gridSnapshots];
    }
    return this.gridSnapshots.slice(-limit);
  }

  clearGridSnapshots(): void {
    this.gridSnapshots = [];
  }
}

// Export singleton instance
export const performanceLogger = new PerformanceLogger();

