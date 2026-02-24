<template>
  <div 
    v-if="show" 
    class="perf-dashboard"
    :style="{ top: position.top + 'px', left: position.left + 'px', right: 'auto' }"
  >
    <div class="perf-header" @mousedown="startDrag">
      <h3>⚡ Performance Metrics</h3>
      <div class="header-actions">
        <button @click="exportJSON" class="btn-action" title="Export as JSON">
          Export JSON
        </button>
        <button @click="exportCSV" class="btn-action" title="Export as CSV">
          Export CSV
        </button>
        <button @click="printSummary" class="btn-action" title="Print summary to console">
          Print Summary
        </button>
        <button @click="clearData" class="btn-action btn-clear" title="Clear all metrics">
          Clear
        </button>
        <button @click="show = false" class="btn-close" title="Close dashboard">
          ×
        </button>
      </div>
    </div>

    <div class="perf-content">
      <!-- Summary Cards -->
      <div v-if="metrics.length > 0" class="summary-cards">
        <div class="card">
          <div class="card-label">Total Operations</div>
          <div class="card-value">{{ metrics.length }}</div>
        </div>
        <div class="card">
          <div class="card-label">Total Images Processed</div>
          <div class="card-value">{{ totalImages }}</div>
        </div>
        <div class="card">
          <div class="card-label">Avg Time per Image</div>
          <div class="card-value">{{ avgPerImage.toFixed(1) }}ms</div>
        </div>
      </div>

      <!-- Empty State -->
      <div v-else class="empty-state">
        <p>No performance metrics recorded yet.</p>
        <p class="hint">Perform batch operations to see metrics here.</p>
      </div>

      <!-- Operation List -->
      <div v-if="metrics.length > 0" class="operations-list">
        <div 
          v-for="(metric, index) in metrics" 
          :key="index" 
          class="operation-item"
          :class="{ 'with-workers': metric.workerUsed }"
        >
          <div class="op-header">
            <div class="op-type">{{ metric.operationType.toUpperCase() }}</div>
            <div class="op-method" :class="{ 'workers': metric.workerUsed }">
              {{ metric.workerUsed ? '🚀 Workers' : '🐌 Main Thread' }}
            </div>
          </div>
          <div class="op-details">
            <span class="detail">
              <strong>{{ metric.batchSize }}</strong> images
            </span>
            <span class="detail">
              <strong>{{ formatTime(metric.totalTime) }}</strong> total
            </span>
            <span class="detail">
              <strong>{{ metric.perImageTime.toFixed(1) }}ms</strong> per image
            </span>
            <span v-if="metric.memoryAfter !== undefined" class="detail">
              <strong>{{ metric.memoryAfter }}MB</strong> memory
            </span>
            <span class="detail timestamp">
              {{ formatTimestamp(metric.timestamp) }}
            </span>
          </div>
        </div>
      </div>

      <!-- Comparison Section (if you load before/after data) -->
      <div v-if="comparisonData.length > 0" class="comparison">
        <h4>📊 Before vs After Comparison</h4>
        <div class="comparison-table">
          <div class="comp-row header">
            <div>Operation</div>
            <div>Before (Avg)</div>
            <div>After (Avg)</div>
            <div>Improvement</div>
          </div>
          <div 
            v-for="comp in comparisonData" 
            :key="comp.operationType"
            class="comp-row"
          >
            <div class="comp-op">{{ comp.operationType }}</div>
            <div>{{ formatTime(comp.beforeAvg) }}</div>
            <div>{{ formatTime(comp.afterAvg) }}</div>
            <div class="improvement" :class="comp.improvement > 0 ? 'positive' : comp.improvement < 0 ? 'negative' : 'neutral'">
              {{ comp.improvement > 0 ? '+' : '' }}{{ comp.improvement.toFixed(1) }}%
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Floating toggle button (only in dev mode) -->
  <button 
    v-if="!show && isDev" 
    @click="show = true" 
    class="perf-toggle"
    title="Show Performance Dashboard"
  >
    ⚡
  </button>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { performanceLogger, type PerformanceMetrics } from '../utils/performanceLogger';

const isDev = import.meta.env.DEV;
const show = ref(false);
const metrics = ref<PerformanceMetrics[]>(performanceLogger.getMetrics());
const comparisonData = ref<Array<{
  operationType: string;
  improvement: number;
  beforeAvg: number;
  afterAvg: number;
}>>([]);

// Dragging state
const position = ref({ top: 20, left: 20 });
const isDragging = ref(false);
const dragStart = ref({ x: 0, y: 0, startLeft: 0, startTop: 0 });

const startDrag = (e: MouseEvent) => {
  // Don't start drag if clicking on buttons
  const target = e.target as HTMLElement;
  if (target.closest('button')) return;
  
  isDragging.value = true;
  dragStart.value = {
    x: e.clientX,
    y: e.clientY,
    startLeft: position.value.left,
    startTop: position.value.top,
  };
  document.addEventListener('mousemove', handleDrag);
  document.addEventListener('mouseup', stopDrag);
  e.preventDefault();
};

const handleDrag = (e: MouseEvent) => {
  if (!isDragging.value) return;
  
  const deltaX = e.clientX - dragStart.value.x;
  const deltaY = e.clientY - dragStart.value.y;
  
  const dashboardWidth = 600;
  const minTop = 0;
  const minLeft = 0;
  const maxLeft = window.innerWidth - dashboardWidth;
  const maxTop = window.innerHeight - 100;
  
  position.value = {
    left: Math.max(minLeft, Math.min(maxLeft, dragStart.value.startLeft + deltaX)),
    top: Math.max(minTop, Math.min(maxTop, dragStart.value.startTop + deltaY)),
  };
};

const stopDrag = () => {
  isDragging.value = false;
  document.removeEventListener('mousemove', handleDrag);
  document.removeEventListener('mouseup', stopDrag);
};

const totalImages = computed(() => 
  metrics.value.reduce((sum, m) => sum + m.batchSize, 0)
);

const avgPerImage = computed(() => {
  if (metrics.value.length === 0) return 0;
  const total = metrics.value.reduce((sum, m) => sum + (m.perImageTime * m.batchSize), 0);
  return total / totalImages.value;
});

const formatTime = (ms: number): string => {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = ((ms % 60000) / 1000).toFixed(1);
  return `${minutes}m ${seconds}s`;
};

const formatTimestamp = (timestamp: number): string => {
  const date = new Date(timestamp);
  return date.toLocaleTimeString();
};

const exportJSON = () => {
  performanceLogger.exportToFile('json');
};

const exportCSV = () => {
  performanceLogger.exportToFile('csv');
};

const printSummary = () => {
  performanceLogger.printSummary();
};

const clearData = () => {
  performanceLogger.clearMetrics();
  metrics.value = [];
  comparisonData.value = [];
};

// Refresh metrics periodically
let refreshInterval: ReturnType<typeof setInterval> | null = null;

onMounted(() => {
  // Initialize position to right side
  if (typeof window !== 'undefined') {
    position.value = { top: 20, left: Math.max(20, window.innerWidth - 620) };
  }
  refreshInterval = setInterval(() => {
    metrics.value = performanceLogger.getMetrics();
  }, 1000);
});

onUnmounted(() => {
  if (refreshInterval) {
    clearInterval(refreshInterval);
  }
  // Clean up drag listeners
  document.removeEventListener('mousemove', handleDrag);
  document.removeEventListener('mouseup', stopDrag);
});

// Expose method to load comparison data (can be called from parent)
const loadComparison = (before: PerformanceMetrics[], after: PerformanceMetrics[]) => {
  comparisonData.value = performanceLogger.compareMetrics(before, after);
};

// Expose for parent component access if needed
defineExpose({
  loadComparison,
});
</script>

<style scoped>
.perf-dashboard {
  position: fixed;
  width: 600px;
  max-width: calc(100vw - 40px);
  max-height: 90vh;
  padding-top: env(safe-area-inset-top, 0px);
  background: #1e1e2e;
  border: 2px solid #3a3a4a;
  border-radius: 12px;
  color: white;
  z-index: 10000;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
}

.perf-header {
  padding: 16px;
  background: #2a2a3a;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid #3a3a4a;
  flex-wrap: wrap;
  gap: 8px;
  cursor: move;
  user-select: none;
}

.perf-header h3 {
  margin: 0;
  font-size: 18px;
  color: #ffd700;
}

.header-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.btn-action {
  padding: 6px 12px;
  background: #3a3a4a;
  color: white;
  border: 1px solid #4a4a5a;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  transition: all 0.2s;
}

.btn-action:hover {
  background: #4a4a5a;
  border-color: #5a5a6a;
}

.btn-clear {
  background: #5a2a2a;
  border-color: #7a3a3a;
}

.btn-clear:hover {
  background: #6a3a3a;
  border-color: #8a4a4a;
}

.btn-close {
  padding: 6px 12px;
  background: #3a3a4a;
  color: white;
  border: 1px solid #4a4a5a;
  border-radius: 4px;
  cursor: pointer;
  font-size: 18px;
  line-height: 1;
  transition: all 0.2s;
}

.btn-close:hover {
  background: #4a4a4a;
}

.perf-content {
  padding: 16px;
  overflow-y: auto;
  flex: 1;
}

.empty-state {
  text-align: center;
  padding: 40px 20px;
  color: #888;
}

.empty-state .hint {
  font-size: 12px;
  color: #666;
  margin-top: 8px;
}

.summary-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 12px;
  margin-bottom: 20px;
}

.card {
  background: #2a2a3a;
  padding: 16px;
  border-radius: 8px;
  text-align: center;
  border: 1px solid #3a3a4a;
}

.card-label {
  font-size: 11px;
  color: #aaa;
  margin-bottom: 8px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.card-value {
  font-size: 24px;
  font-weight: bold;
  color: #4CAF50;
}

.operations-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.operation-item {
  background: #2a2a3a;
  padding: 12px;
  border-radius: 8px;
  border-left: 4px solid #4a4a5a;
  transition: all 0.2s;
}

.operation-item:hover {
  background: #2f2f3f;
}

.operation-item.with-workers {
  border-left-color: #4CAF50;
}

.op-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.op-type {
  font-weight: bold;
  font-size: 14px;
  color: #ffd700;
  letter-spacing: 1px;
}

.op-method {
  font-size: 11px;
  padding: 4px 8px;
  border-radius: 4px;
  background: #3a3a4a;
  color: #aaa;
}

.op-method.workers {
  background: #2a4a2a;
  color: #4CAF50;
}

.op-details {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  font-size: 13px;
  color: #ccc;
}

.detail {
  color: #ccc;
}

.detail strong {
  color: white;
  font-weight: 600;
}

.detail.timestamp {
  margin-left: auto;
  color: #888;
  font-size: 11px;
}

.comparison {
  margin-top: 24px;
  padding-top: 24px;
  border-top: 1px solid #3a3a4a;
}

.comparison h4 {
  margin: 0 0 16px 0;
  font-size: 16px;
  color: #ffd700;
}

.comparison-table {
  background: #2a2a3a;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid #3a3a4a;
}

.comp-row {
  display: grid;
  grid-template-columns: 1.5fr 1fr 1fr 1fr;
  padding: 12px;
  border-bottom: 1px solid #3a3a4a;
  font-size: 13px;
}

.comp-row:last-child {
  border-bottom: none;
}

.comp-row.header {
  background: #3a3a3a;
  font-weight: bold;
  border-bottom: 2px solid #4a4a5a;
  color: #ffd700;
}

.comp-op {
  text-transform: capitalize;
  font-weight: 600;
}

.improvement {
  font-weight: bold;
}

.improvement.positive {
  color: #4CAF50;
}

.improvement.negative {
  color: #f44336;
}

.improvement.neutral {
  color: #888;
}

.perf-toggle {
  position: fixed;
  bottom: calc(20px + env(safe-area-inset-bottom, 0px));
  right: 20px;
  width: 50px;
  height: 50px;
  border-radius: 50%;
  background: #2a2a3a;
  border: 2px solid #4a4a4a;
  color: #ffd700;
  font-size: 24px;
  cursor: pointer;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  transition: all 0.2s;
}

.perf-toggle:hover {
  background: #3a3a4a;
  border-color: #5a5a5a;
  transform: scale(1.1);
}

/* Scrollbar styling */
.perf-content::-webkit-scrollbar {
  width: 8px;
}

.perf-content::-webkit-scrollbar-track {
  background: #2a2a3a;
}

.perf-content::-webkit-scrollbar-thumb {
  background: #4a4a4a;
  border-radius: 4px;
}

.perf-content::-webkit-scrollbar-thumb:hover {
  background: #5a5a5a;
}
</style>

