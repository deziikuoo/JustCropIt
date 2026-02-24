<template>
  <div 
    v-if="show" 
    class="copy-paste-viz"
    :style="{ top: position.top + 'px', left: position.left + 'px' }"
  >
    <div class="viz-header" @mousedown="startDrag">
      <h3>📋 Copy/Paste Debugger</h3>
      <div class="header-actions">
        <button @click="exportJSON" class="btn-action" title="Export as JSON">
          Export JSON
        </button>
        <button @click="printSummary" class="btn-action" title="Print summary to console">
          Print Summary
        </button>
        <button @click="clearData" class="btn-action btn-clear" title="Clear all data">
          Clear
        </button>
        <button @click="show = false" class="btn-close" title="Close visualizer">
          ×
        </button>
      </div>
    </div>

    <div class="viz-content">
      <!-- Current Clipboard State -->
      <div v-if="latestCopy" class="clipboard-section">
        <h4>📌 Current Clipboard</h4>
        <div class="clipboard-card">
          <div class="clipboard-info">
            <div class="clipboard-source">
              Copied from: <strong>Photo #{{ latestCopy.sourceIndex }}</strong>
              <span class="timestamp">{{ formatTimestamp(latestCopy.timestamp) }}</span>
            </div>
            <div class="clipboard-settings">
              <div class="setting-item">
                <span class="setting-label">Flips:</span>
                <span class="setting-value">
                  {{ formatFlips(latestCopy.settings.flips) }}
                </span>
              </div>
              <div class="setting-item" v-if="latestCopy.settings.rotation !== undefined">
                <span class="setting-label">Rotation:</span>
                <span class="setting-value">{{ latestCopy.settings.rotation }}°</span>
              </div>
              <div class="setting-item" v-if="latestCopy.settings.crop">
                <span class="setting-label">Crop:</span>
                <span class="setting-value">
                  ({{ latestCopy.settings.crop.x }}, {{ latestCopy.settings.crop.y }}, 
                  {{ latestCopy.settings.crop.width }}×{{ latestCopy.settings.crop.height }})
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div v-else class="empty-clipboard">
        <p>No settings copied yet.</p>
      </div>

      <!-- Summary Cards -->
      <div v-if="summary.totalCopies > 0 || summary.totalPastes > 0" class="summary-cards">
        <div class="card">
          <div class="card-label">Total Copies</div>
          <div class="card-value">{{ summary.totalCopies }}</div>
        </div>
        <div class="card">
          <div class="card-label">Total Pastes</div>
          <div class="card-value">{{ summary.totalPastes }}</div>
        </div>
        <div class="card">
          <div class="card-label">Images Pasted</div>
          <div class="card-value">{{ summary.totalImagesPasted }}</div>
        </div>
        <div class="card" :class="{ 'has-conflicts': summary.operationsWithConflicts > 0 }">
          <div class="card-label">With Conflicts</div>
          <div class="card-value">{{ summary.operationsWithConflicts }}</div>
        </div>
      </div>

      <!-- Operation History -->
      <div class="operations-section">
        <h4>📜 Operation History</h4>
        <div v-if="operations.length === 0" class="empty-state">
          <p>No copy/paste operations recorded yet.</p>
        </div>
        <div v-else class="operations-list">
          <div
            v-for="(op, index) in operations"
            :key="index"
            class="operation-item"
            :class="{
              'op-copy': op.type === 'copy',
              'op-paste': op.type === 'paste',
              'has-conflicts': op.type === 'paste' && hasConflicts(op),
            }"
          >
            <!-- Copy Operation -->
            <template v-if="op.type === 'copy'">
              <div class="op-header">
                <div class="op-type">COPY</div>
                <div class="op-timestamp">{{ formatTimestamp(op.timestamp) }}</div>
              </div>
              <div class="op-details">
                <span class="detail">
                  From: <strong>Photo #{{ op.sourceIndex }}</strong>
                </span>
                <span class="detail">
                  Flips: {{ formatFlips(op.settings.flips) }}
                </span>
                <span v-if="op.settings.rotation !== undefined" class="detail">
                  Rotation: <strong>{{ op.settings.rotation }}°</strong>
                </span>
                <span v-if="op.settings.crop" class="detail">
                  Crop: <strong>{{ formatCrop(op.settings.crop) }}</strong>
                </span>
              </div>
            </template>

            <!-- Paste Operation -->
            <template v-if="op.type === 'paste'">
              <div class="op-header">
                <div class="op-type">PASTE</div>
                <div class="op-timestamp">{{ formatTimestamp(op.timestamp) }}</div>
                <div v-if="hasConflicts(op)" class="conflict-badge">⚠️ Conflicts</div>
              </div>
              <div class="op-details">
                <span class="detail">
                  To: <strong>{{ op.targetIndices.length }} image(s)</strong>
                  <span class="target-indices">[{{ op.targetIndices.join(', ') }}]</span>
                </span>
                <span v-if="op.sourceIndex !== undefined" class="detail">
                  From: <strong>Photo #{{ op.sourceIndex }}</strong>
                </span>
              </div>

              <!-- Paste Results for each target -->
              <div class="paste-results">
                <div
                  v-for="(result, resultIndex) in op.results"
                  :key="resultIndex"
                  class="paste-result-item"
                  :class="{ 'has-conflict': result.hasConflict }"
                >
                  <div class="result-header">
                    <span class="result-target">Photo #{{ result.targetIndex }}</span>
                    <span v-if="result.usedOriginalImage" class="original-badge" title="Used original image to prevent compounding">
                      🔄 Original
                    </span>
                    <span v-if="result.hasConflict" class="conflict-indicator">⚠️</span>
                  </div>
                  
                  <div class="result-comparison">
                    <div class="state-before">
                      <div class="state-label">Before:</div>
                      <div class="state-values">
                        <span>Flips: {{ formatFlips(result.beforeState.flips) }}</span>
                        <span v-if="result.beforeState.rotation !== undefined">
                          Rot: {{ result.beforeState.rotation }}°
                        </span>
                        <span v-if="result.beforeState.crop">
                          Crop: {{ formatCrop(result.beforeState.crop) }}
                        </span>
                      </div>
                    </div>
                    <div class="state-arrow">→</div>
                    <div class="state-after">
                      <div class="state-label">After:</div>
                      <div class="state-values">
                        <span>Flips: {{ formatFlips(result.afterState.flips) }}</span>
                        <span v-if="result.afterState.rotation !== undefined">
                          Rot: {{ result.afterState.rotation }}°
                        </span>
                        <span v-if="result.afterState.crop">
                          Crop: {{ formatCrop(result.afterState.crop) }}
                        </span>
                      </div>
                    </div>
                  </div>

                  <!-- Conflict Details -->
                  <div v-if="result.hasConflict && result.conflictDetails" class="conflict-details">
                    <div class="conflict-title">Conflicts:</div>
                    <ul>
                      <li v-for="(detail, detailIndex) in result.conflictDetails" :key="detailIndex">
                        {{ detail }}
                      </li>
                    </ul>
                  </div>
                </div>
              </div>
            </template>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Floating toggle button (only in dev mode) -->
  <button
    v-if="!show && isDev"
    @click="show = true"
    class="viz-toggle"
    title="Show Copy/Paste Visualizer"
  >
    📋
  </button>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import {
  copyPasteLogger,
  type CopyPasteOperation,
  type PasteOperation,
} from '../utils/copyPasteLogger';

const isDev = import.meta.env.DEV;
const show = ref(false);
const operations = ref<CopyPasteOperation[]>(copyPasteLogger.getOperations());

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
  
  const dashboardWidth = 700;
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

const latestCopy = computed(() => copyPasteLogger.getLatestCopy());
const summary = computed(() => copyPasteLogger.getSummary());

const formatTimestamp = (timestamp: number): string => {
  const date = new Date(timestamp);
  return date.toLocaleTimeString();
};

const formatFlips = (flips: { horizontal: boolean; vertical: boolean }): string => {
  if (flips.horizontal && flips.vertical) return 'Both';
  if (flips.horizontal) return 'Horizontal';
  if (flips.vertical) return 'Vertical';
  return 'None';
};

const formatCrop = (crop: { x: number; y: number; width: number; height: number }): string => {
  return `${crop.width}×${crop.height} @ (${crop.x}, ${crop.y})`;
};

const hasConflicts = (operation: PasteOperation): boolean => {
  return copyPasteLogger.hasConflicts(operation);
};

const exportJSON = () => {
  copyPasteLogger.exportJSON();
};

const printSummary = () => {
  console.log('Copy/Paste Summary:', summary.value);
  console.log('All Operations:', operations.value);
};

const clearData = () => {
  copyPasteLogger.clear();
  operations.value = [];
};

// Refresh operations periodically
let refreshInterval: ReturnType<typeof setInterval> | null = null;

onMounted(() => {
  // Initialize position to left side
  if (typeof window !== 'undefined') {
    position.value = { top: 20, left: 20 };
  }
  refreshInterval = setInterval(() => {
    operations.value = copyPasteLogger.getOperations();
  }, 500); // Refresh every 500ms for better responsiveness
});

onUnmounted(() => {
  if (refreshInterval) {
    clearInterval(refreshInterval);
  }
  // Clean up drag listeners
  document.removeEventListener('mousemove', handleDrag);
  document.removeEventListener('mouseup', stopDrag);
});
</script>

<style scoped>
.copy-paste-viz {
  position: fixed;
  width: 700px;
  max-width: calc(100vw - 40px);
  max-height: 90vh;
  background: #1e1e2e;
  border: 2px solid #3a3a4a;
  border-radius: 12px;
  color: white;
  z-index: 10001; /* Above performance dashboard */
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
}

.viz-header {
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

.viz-header h3 {
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

.viz-content {
  padding: 16px;
  overflow-y: auto;
  flex: 1;
}

.empty-state {
  text-align: center;
  padding: 40px 20px;
  color: #888;
}

.clipboard-section {
  margin-bottom: 24px;
}

.clipboard-section h4 {
  margin: 0 0 12px 0;
  font-size: 16px;
  color: #ffd700;
}

.clipboard-card {
  background: #2a2a3a;
  padding: 16px;
  border-radius: 8px;
  border: 1px solid #3a3a4a;
  border-left: 4px solid #4CAF50;
}

.clipboard-info {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.clipboard-source {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 14px;
  color: #ccc;
}

.clipboard-source strong {
  color: #4CAF50;
  font-size: 16px;
}

.timestamp {
  font-size: 11px;
  color: #888;
}

.clipboard-settings {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.setting-item {
  display: flex;
  gap: 8px;
  font-size: 13px;
}

.setting-label {
  color: #aaa;
  min-width: 80px;
}

.setting-value {
  color: white;
  font-weight: 500;
}

.empty-clipboard {
  text-align: center;
  padding: 20px;
  color: #888;
  margin-bottom: 24px;
  background: #2a2a3a;
  border-radius: 8px;
}

.summary-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 12px;
  margin-bottom: 24px;
}

.card {
  background: #2a2a3a;
  padding: 16px;
  border-radius: 8px;
  text-align: center;
  border: 1px solid #3a3a4a;
}

.card.has-conflicts {
  border-color: #f44336;
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

.card.has-conflicts .card-value {
  color: #f44336;
}

.operations-section h4 {
  margin: 0 0 16px 0;
  font-size: 16px;
  color: #ffd700;
}

.operations-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.operation-item {
  background: #2a2a3a;
  padding: 16px;
  border-radius: 8px;
  border: 1px solid #3a3a4a;
  transition: all 0.2s;
}

.operation-item.op-copy {
  border-left: 4px solid #2196F3;
}

.operation-item.op-paste {
  border-left: 4px solid #9C27B0;
}

.operation-item.has-conflicts {
  border-left-color: #f44336;
  background: #2a1f1f;
}

.op-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  gap: 8px;
}

.op-type {
  font-weight: bold;
  font-size: 14px;
  letter-spacing: 1px;
}

.op-copy .op-type {
  color: #2196F3;
}

.op-paste .op-type {
  color: #9C27B0;
}

.op-timestamp {
  font-size: 11px;
  color: #888;
  margin-left: auto;
}

.conflict-badge {
  background: #f44336;
  color: white;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: bold;
}

.op-details {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  font-size: 13px;
  color: #ccc;
  margin-bottom: 12px;
}

.detail {
  color: #ccc;
}

.detail strong {
  color: white;
  font-weight: 600;
}

.target-indices {
  color: #888;
  font-size: 11px;
  margin-left: 4px;
}

.paste-results {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid #3a3a4a;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.paste-result-item {
  background: #1f1f2f;
  padding: 12px;
  border-radius: 6px;
  border: 1px solid #3a3a4a;
}

.paste-result-item.has-conflict {
  border-color: #f44336;
  background: #2a1f1f;
}

.result-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  font-size: 13px;
}

.result-target {
  font-weight: bold;
  color: #9C27B0;
}

.original-badge {
  background: #2a4a2a;
  color: #4CAF50;
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 10px;
  font-weight: bold;
}

.conflict-indicator {
  color: #f44336;
  font-size: 16px;
}

.result-comparison {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 12px;
  color: #ccc;
}

.state-before,
.state-after {
  flex: 1;
  padding: 8px;
  background: #1a1a2a;
  border-radius: 4px;
}

.state-label {
  font-size: 10px;
  color: #888;
  margin-bottom: 4px;
  text-transform: uppercase;
}

.state-values {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.state-arrow {
  color: #666;
  font-size: 20px;
  font-weight: bold;
}

.conflict-details {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid #4a2a2a;
}

.conflict-title {
  font-size: 11px;
  color: #f44336;
  font-weight: bold;
  margin-bottom: 4px;
}

.conflict-details ul {
  margin: 4px 0 0 0;
  padding-left: 20px;
  font-size: 11px;
  color: #ff8888;
}

.conflict-details li {
  margin-bottom: 2px;
}

.viz-toggle {
  position: fixed;
  bottom: calc(80px + env(safe-area-inset-bottom, 0px));
  left: 20px;
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

.viz-toggle:hover {
  background: #3a3a4a;
  border-color: #5a5a5a;
  transform: scale(1.1);
}

/* Scrollbar styling */
.viz-content::-webkit-scrollbar {
  width: 8px;
}

.viz-content::-webkit-scrollbar-track {
  background: #2a2a3a;
}

.viz-content::-webkit-scrollbar-thumb {
  background: #4a4a4a;
  border-radius: 4px;
}

.viz-content::-webkit-scrollbar-thumb:hover {
  background: #5a5a5a;
}
</style>

