<template>
  <Teleport to="body">
    <div
      v-if="isOpen"
      class="history-backdrop"
      @click="close"
    >
      <aside
        id="history-panel"
        class="history-panel"
        :class="{ 'history-panel--mobile': isMobile }"
        role="dialog"
        aria-modal="true"
        aria-label="Operation history"
        @click.stop
      >
        <header class="history-panel__header">
          <h2 class="history-panel__title">
            <i class="fas fa-clock-rotate-left" aria-hidden="true"></i>
            History
          </h2>
          <button
            type="button"
            class="history-panel__close"
            aria-label="Close history panel"
            @click="close"
          >
            <i class="fas fa-xmark"></i>
          </button>
        </header>

        <div
          v-if="isNavigating"
          class="history-panel__loading"
          role="status"
        >
          <i class="fas fa-spinner fa-spin"></i>
          Restoring state...
        </div>

        <div class="history-panel__body">
          <p
            v-if="displayUndo.length === 0 && displayRedo.length === 0"
            class="history-panel__empty"
          >
            No edits yet
          </p>

          <ul v-else class="history-list" role="list">
            <li
              v-for="entry in displayUndo"
              :key="entry.id"
              class="history-entry"
              :class="{ 'history-entry--current': entry.undoIndex === pointer - 1 && pointer > 0 }"
            >
              <button
                type="button"
                class="history-entry__button"
                :disabled="isNavigating || entry.undoIndex >= pointer - 1"
                :aria-current="entry.undoIndex === pointer - 1 ? 'step' : undefined"
                @click="navigateToEntry(entry.undoIndex)"
              >
                <span class="history-entry__description">{{ entry.description }}</span>
                <span class="history-entry__meta">
                  <span v-if="entry.affectedCount > 1">
                    {{ entry.affectedCount }} photos
                  </span>
                  <span>{{ formatTime(entry.timestamp) }}</span>
                </span>
              </button>
            </li>

            <li
              v-if="displayRedo.length > 0"
              class="history-divider"
              aria-hidden="true"
            >
              Undone actions
            </li>

            <li
              v-for="entry in displayRedo"
              :key="entry.id"
              class="history-entry history-entry--redo"
            >
              <div class="history-entry__button history-entry__button--static">
                <span class="history-entry__description">{{ entry.description }}</span>
                <span class="history-entry__meta">
                  <span v-if="entry.affectedCount > 1">
                    {{ entry.affectedCount }} photos
                  </span>
                  <span>{{ formatTime(entry.timestamp) }}</span>
                </span>
              </div>
            </li>
          </ul>

          <p
            v-if="truncatedCount > 0"
            class="history-panel__footnote"
          >
            Older actions removed (max {{ historyMaxSize }})
          </p>
        </div>

        <footer class="history-panel__footer">
          <button
            type="button"
            class="history-footer-btn"
            :disabled="!canUndo() || isNavigating"
            @click="undo"
          >
            Undo
          </button>
          <button
            type="button"
            class="history-footer-btn"
            :disabled="!canRedo() || isNavigating"
            @click="redo"
          >
            Redo
          </button>
        </footer>
      </aside>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue';
import { useMediaQuery } from '@vueuse/core';
import { useOperationHistory } from '../composables/useOperationHistory';
import {
  HISTORY_MAX_SIZE,
  HISTORY_PANEL_MOBILE_BREAKPOINT_PX,
} from '../constants/optimization';

const {
  panelState,
  isOpen,
  isNavigating,
  close,
  undo,
  redo,
  navigateToEntry,
  canUndo,
  canRedo,
} = useOperationHistory();

const isMobile = useMediaQuery(
  `(max-width: ${HISTORY_PANEL_MOBILE_BREAKPOINT_PX}px)`
);

const pointer = computed(() => panelState.value.pointer);
const truncatedCount = computed(() => panelState.value.truncatedCount);
const historyMaxSize = HISTORY_MAX_SIZE;

const displayUndo = computed(() =>
  [...panelState.value.undoEntries].reverse()
);

const displayRedo = computed(() => panelState.value.redoEntries);

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function onKeydown(event: KeyboardEvent) {
  if (!isOpen.value) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    close();
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown);
});

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown);
});
</script>

<style scoped>
.history-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1200;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  justify-content: flex-end;
  align-items: stretch;
}

.history-panel {
  width: min(360px, 100%);
  max-height: 100vh;
  background: rgba(18, 18, 20, 0.98);
  border-left: 1px solid rgba(255, 255, 255, 0.1);
  display: flex;
  flex-direction: column;
  box-shadow: -8px 0 32px rgba(0, 0, 0, 0.35);
}

.history-panel--mobile {
  width: 100%;
  max-height: 50vh;
  align-self: flex-end;
  border-left: none;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 16px 16px 0 0;
}

.history-backdrop:has(.history-panel--mobile) {
  align-items: flex-end;
}

.history-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.history-panel__title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.92);
  display: flex;
  align-items: center;
  gap: 8px;
}

.history-panel__close {
  background: transparent;
  border: none;
  color: rgba(255, 255, 255, 0.7);
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 6px;
}

.history-panel__close:hover {
  background: rgba(255, 255, 255, 0.08);
}

.history-panel__loading {
  padding: 8px 16px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.7);
  display: flex;
  align-items: center;
  gap: 8px;
}

.history-panel__body {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
}

.history-panel__empty {
  padding: 24px 16px;
  margin: 0;
  text-align: center;
  color: rgba(255, 255, 255, 0.5);
  font-size: 13px;
}

.history-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.history-entry__button {
  width: 100%;
  text-align: left;
  background: transparent;
  border: none;
  padding: 10px 16px;
  cursor: pointer;
  color: rgba(255, 255, 255, 0.88);
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.history-entry__button:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.06);
}

.history-entry__button:disabled {
  cursor: default;
  opacity: 0.85;
}

.history-entry--current .history-entry__button {
  background: rgba(212, 175, 55, 0.15);
  border-left: 3px solid #d4af37;
  padding-left: 13px;
}

.history-entry--redo .history-entry__button--static {
  opacity: 0.45;
  cursor: default;
}

.history-entry__description {
  font-size: 13px;
  font-weight: 500;
}

.history-entry__meta {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.5);
  display: flex;
  gap: 8px;
}

.history-divider {
  padding: 8px 16px 4px;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: rgba(255, 255, 255, 0.35);
}

.history-panel__footnote {
  padding: 8px 16px 12px;
  margin: 0;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.4);
}

.history-panel__footer {
  display: flex;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.history-footer-btn {
  flex: 1;
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.9);
  cursor: pointer;
  font-size: 12px;
}

.history-footer-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.history-footer-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.1);
}
</style>
