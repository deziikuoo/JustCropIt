<template>
  <Teleport to="body">
    <div
      v-if="show"
      class="frame-preview-backdrop"
      @click="$emit('close')"
    >
      <div
        class="frame-preview-modal"
        role="dialog"
        aria-modal="true"
        :aria-label="`Frame ${currentIndex + 1} of ${frames.length}`"
        @click.stop
      >
        <header class="frame-preview-header">
          <div class="frame-preview-title">
            <span class="frame-index">Frame {{ currentIndex + 1 }} of {{ frames.length }}</span>
            <span class="frame-timestamp">{{ formatTimestamp(currentFrame.timestamp) }}</span>
          </div>
          <button
            type="button"
            class="frame-preview-close"
            aria-label="Close preview"
            @click="$emit('close')"
          >
            <i class="fas fa-times"></i>
          </button>
        </header>

        <div class="frame-preview-body">
          <button
            v-if="frames.length > 1"
            type="button"
            class="nav-btn nav-btn-prev"
            :disabled="currentIndex <= 0"
            aria-label="Previous frame"
            @click="navigate(currentIndex - 1)"
          >
            <i class="fas fa-chevron-left"></i>
          </button>

          <div class="frame-preview-image-wrap">
            <img
              v-if="currentImageUrl"
              :key="currentFrame.index"
              :src="currentImageUrl"
              :alt="`Frame at ${formatTimestamp(currentFrame.timestamp)}`"
              class="frame-preview-image"
              decoding="async"
              @click.stop
            />
          </div>

          <button
            v-if="frames.length > 1"
            type="button"
            class="nav-btn nav-btn-next"
            :disabled="currentIndex >= frames.length - 1"
            aria-label="Next frame"
            @click="navigate(currentIndex + 1)"
          >
            <i class="fas fa-chevron-right"></i>
          </button>
        </div>

        <footer class="frame-preview-footer" v-if="frames.length > 1">
          <span class="nav-hint">Use arrow keys to browse</span>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, watch, onUnmounted } from 'vue';
import type { ExtractedFrameFile } from '../composables/useVideoExtraction';

const props = defineProps<{
  show: boolean;
  frames: ExtractedFrameFile[];
  currentIndex: number;
  getFrameUrl: (frame: ExtractedFrameFile) => string;
  formatTimestamp: (seconds: number) => string;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'navigate', index: number): void;
}>();

const currentFrame = computed(() => props.frames[props.currentIndex] ?? props.frames[0]);

const currentImageUrl = computed(() => {
  const frame = currentFrame.value;
  if (!frame) return '';
  return props.getFrameUrl(frame);
});

function navigate(index: number) {
  if (index < 0 || index >= props.frames.length) return;
  emit('navigate', index);
}

function prefetchAdjacentFrames() {
  const { frames, currentIndex, getFrameUrl } = props;
  const prev = frames[currentIndex - 1];
  const next = frames[currentIndex + 1];
  if (prev) getFrameUrl(prev);
  if (next) getFrameUrl(next);
}

function handleKeydown(event: KeyboardEvent) {
  if (!props.show) return;

  if (event.key === 'Escape') {
    event.preventDefault();
    emit('close');
    return;
  }

  if (event.key === 'ArrowLeft') {
    event.preventDefault();
    navigate(props.currentIndex - 1);
    return;
  }

  if (event.key === 'ArrowRight') {
    event.preventDefault();
    navigate(props.currentIndex + 1);
  }
}

let previousBodyOverflow = '';

function lockBodyScroll() {
  previousBodyOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
}

function unlockBodyScroll() {
  document.body.style.overflow = previousBodyOverflow;
}

watch(
  () => props.show,
  (isOpen) => {
    if (isOpen) {
      lockBodyScroll();
      window.addEventListener('keydown', handleKeydown);
      prefetchAdjacentFrames();
    } else {
      unlockBodyScroll();
      window.removeEventListener('keydown', handleKeydown);
    }
  },
  { immediate: true }
);

watch(
  () => props.currentIndex,
  () => {
    if (props.show) {
      prefetchAdjacentFrames();
    }
  }
);

onUnmounted(() => {
  unlockBodyScroll();
  window.removeEventListener('keydown', handleKeydown);
});
</script>

<style scoped>
.frame-preview-backdrop {
  position: fixed;
  inset: 0;
  z-index: 250;
  padding: env(safe-area-inset-top, 0) env(safe-area-inset-right, 0)
    env(safe-area-inset-bottom, 0) env(safe-area-inset-left, 0);
  box-sizing: border-box;
  background: rgba(0, 0, 0, 0.92);
  backdrop-filter: blur(10px);
  display: flex;
  align-items: center;
  justify-content: center;
}

.frame-preview-modal {
  width: min(96vw, 1100px);
  height: min(92vh, 900px);
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  box-sizing: border-box;
}

.frame-preview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-shrink: 0;
}

.frame-preview-title {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.frame-index {
  font-size: 1rem;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.95);
}

.frame-timestamp {
  font-size: 0.85rem;
  color: rgba(255, 255, 255, 0.55);
  font-variant-numeric: tabular-nums;
}

.frame-preview-close {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.15);
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.85);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s ease, border-color 0.2s ease;
}

.frame-preview-close:hover {
  background: rgba(239, 68, 68, 0.25);
  border-color: rgba(239, 68, 68, 0.5);
}

.frame-preview-body {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  gap: 12px;
}

.frame-preview-image-wrap {
  flex: 1;
  min-width: 0;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.35);
  border-radius: 12px;
  overflow: hidden;
}

.frame-preview-image {
  max-width: 100%;
  max-height: 100%;
  width: auto;
  height: auto;
  object-fit: contain;
  user-select: none;
  -webkit-user-drag: none;
}

.nav-btn {
  flex-shrink: 0;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.15);
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.9);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s ease, opacity 0.2s ease;
}

.nav-btn:hover:not(:disabled) {
  background: rgba(212, 175, 55, 0.25);
  border-color: rgba(212, 175, 55, 0.45);
}

.nav-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.frame-preview-footer {
  flex-shrink: 0;
  text-align: center;
}

.nav-hint {
  font-size: 0.8rem;
  color: rgba(255, 255, 255, 0.4);
}

@media (max-width: 640px) {
  .frame-preview-modal {
    width: 100vw;
    height: 100vh;
    padding: 12px;
  }

  .nav-btn {
    position: absolute;
    bottom: 72px;
    z-index: 1;
  }

  .nav-btn-prev {
    left: 16px;
  }

  .nav-btn-next {
    right: 16px;
  }

  .frame-preview-body {
    position: relative;
  }
}
</style>
