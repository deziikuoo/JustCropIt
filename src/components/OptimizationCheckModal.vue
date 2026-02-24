<template>
  <div
    v-if="show"
    class="opt-check-modal"
    :style="{ top: position.top + 'px', left: position.left + 'px', right: 'auto' }"
  >
    <div class="opt-check-header" @mousedown="startDrag">
      <h3>Optimization Check</h3>
      <div class="header-actions">
        <button @click="refresh" class="btn-action" title="Re-run checks">
          Refresh
        </button>
        <button @click="show = false" class="btn-close" title="Close">
          ×
        </button>
      </div>
    </div>

    <div class="opt-check-content">
      <p class="intro">
        Verifies optimization features and parameter rules from
        <code>OptimizationImp2.md</code>.
      </p>

      <div class="summary-cards">
        <div class="card">
          <div class="card-label">Pass</div>
          <div class="card-value pass">{{ passCount }}</div>
        </div>
        <div class="card">
          <div class="card-label">Fail</div>
          <div class="card-value fail">{{ failCount }}</div>
        </div>
        <div class="card">
          <div class="card-label">Warn / Info</div>
          <div class="card-value warn">{{ warnInfoCount }}</div>
        </div>
      </div>

      <div class="checks-list">
        <div
          v-for="check in results"
          :key="check.id"
          class="check-item"
          :class="check.status"
        >
          <span class="check-icon" :aria-label="check.status">
            {{ statusIcon(check.status) }}
          </span>
          <div class="check-body">
            <div class="check-name">{{ check.name }}</div>
            <div class="check-message">{{ check.message }}</div>
            <div v-if="check.detail" class="check-detail">{{ check.detail }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <button
    v-if="!show && isDev"
    @click="show = true"
    class="opt-check-toggle"
    title="Show Optimization Check"
  >
    ✓
  </button>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import {
  runOptimizationChecks,
  type OptimizationCheckResult,
  type CheckStatus,
} from '../utils/optimizationChecker';

const isDev = import.meta.env.DEV;
const show = ref(false);
const results = ref<OptimizationCheckResult[]>([]);

const position = ref({ top: 20, left: 20 });
const isDragging = ref(false);
const dragStart = ref({ x: 0, y: 0, startLeft: 0, startTop: 0 });

function runChecks() {
  results.value = runOptimizationChecks();
}

function refresh() {
  runChecks();
}

function statusIcon(status: CheckStatus): string {
  switch (status) {
    case 'pass':
      return '✓';
    case 'fail':
      return '✗';
    case 'warn':
      return '⚠';
    case 'info':
    default:
      return 'ℹ';
  }
}

const passCount = computed(() => results.value.filter((r) => r.status === 'pass').length);
const failCount = computed(() => results.value.filter((r) => r.status === 'fail').length);
const warnInfoCount = computed(() =>
  results.value.filter((r) => r.status === 'warn' || r.status === 'info').length
);

const startDrag = (e: MouseEvent) => {
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
  const modalWidth = 520;
  const minTop = 0;
  const minLeft = 0;
  const maxLeft = window.innerWidth - modalWidth;
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

onMounted(() => {
  if (typeof window !== 'undefined') {
    position.value = { top: 20, left: Math.max(20, window.innerWidth - 540) };
  }
  runChecks();
});

onUnmounted(() => {
  document.removeEventListener('mousemove', handleDrag);
  document.removeEventListener('mouseup', stopDrag);
});
</script>

<style scoped>
.opt-check-modal {
  position: fixed;
  width: 520px;
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

.opt-check-header {
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

.opt-check-header h3 {
  margin: 0;
  font-size: 18px;
  color: #ffd700;
}

.header-actions {
  display: flex;
  gap: 8px;
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

.opt-check-content {
  padding: 16px;
  overflow-y: auto;
  flex: 1;
}

.intro {
  font-size: 13px;
  color: #aaa;
  margin: 0 0 16px 0;
}

.intro code {
  background: #2a2a3a;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 12px;
}

.summary-cards {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin-bottom: 20px;
}

.card {
  background: #2a2a3a;
  padding: 12px;
  border-radius: 8px;
  text-align: center;
  border: 1px solid #3a3a4a;
}

.card-label {
  font-size: 11px;
  color: #aaa;
  margin-bottom: 6px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.card-value {
  font-size: 20px;
  font-weight: bold;
}

.card-value.pass {
  color: #4caf50;
}

.card-value.fail {
  color: #f44336;
}

.card-value.warn {
  color: #ff9800;
}

.checks-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.check-item {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  background: #2a2a3a;
  padding: 12px;
  border-radius: 8px;
  border-left: 4px solid #4a4a5a;
}

.check-item.pass {
  border-left-color: #4caf50;
}

.check-item.fail {
  border-left-color: #f44336;
}

.check-item.warn {
  border-left-color: #ff9800;
}

.check-item.info {
  border-left-color: #2196f3;
}

.check-icon {
  font-size: 18px;
  line-height: 1.2;
  flex-shrink: 0;
}

.check-item.pass .check-icon {
  color: #4caf50;
}

.check-item.fail .check-icon {
  color: #f44336;
}

.check-item.warn .check-icon {
  color: #ff9800;
}

.check-item.info .check-icon {
  color: #2196f3;
}

.check-body {
  flex: 1;
  min-width: 0;
}

.check-name {
  font-weight: 600;
  font-size: 13px;
  color: #e0e0e0;
  margin-bottom: 4px;
}

.check-message {
  font-size: 12px;
  color: #b0b0b0;
  line-height: 1.4;
}

.check-detail {
  font-size: 11px;
  color: #888;
  margin-top: 4px;
}

.opt-check-toggle {
  position: fixed;
  bottom: calc(80px + env(safe-area-inset-bottom, 0px));
  right: 20px;
  width: 50px;
  height: 50px;
  border-radius: 50%;
  background: #2a2a3a;
  border: 2px solid #4a4a4a;
  color: #4caf50;
  font-size: 22px;
  cursor: pointer;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  transition: all 0.2s;
}

.opt-check-toggle:hover {
  background: #3a3a4a;
  border-color: #5a5a5a;
  transform: scale(1.1);
}

.opt-check-content::-webkit-scrollbar {
  width: 8px;
}

.opt-check-content::-webkit-scrollbar-track {
  background: #2a2a3a;
}

.opt-check-content::-webkit-scrollbar-thumb {
  background: #4a4a4a;
  border-radius: 4px;
}

.opt-check-content::-webkit-scrollbar-thumb:hover {
  background: #5a5a5a;
}
</style>
