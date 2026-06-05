<template>
  <div class="video-trimmer" :class="{ disabled }">
    <div class="trim-header">
      <label class="option-label">
        <i class="fas fa-scissors"></i>
        Clip Range
      </label>
      <div class="trim-actions">
        <button
          type="button"
          class="trim-action-btn"
          :disabled="disabled || clipDuration <= 0"
          @click="emit('togglePreviewClip')"
        >
          <i :class="isPreviewingClip ? 'fas fa-stop' : 'fas fa-play'"></i>
          {{ isPreviewingClip ? 'Stop' : 'Preview' }}
        </button>
        <button
          type="button"
          class="trim-action-btn download-btn"
          :disabled="disabled || isExportingTrim || clipDuration <= 0"
          @click="emit('downloadTrim')"
        >
          <i :class="isExportingTrim ? 'fas fa-spinner fa-spin' : 'fas fa-download'"></i>
          {{ isExportingTrim ? 'Exporting...' : 'Download clip' }}
        </button>
      </div>
    </div>

    <div class="trim-summary">
      <span>{{ formatTime(trimStart) }} – {{ formatTime(trimEnd) }}</span>
      <span class="trim-duration">({{ formatTime(clipDuration) }} selected)</span>
    </div>

    <div class="trim-track">
      <div class="trim-track-bg"></div>
      <div class="trim-selection" :style="selectionStyle"></div>
    </div>

    <div class="trim-sliders">
      <div class="trim-slider-row">
        <span class="trim-slider-label">Start</span>
        <input
          type="range"
          class="trim-slider"
          :min="0"
          :max="duration"
          :step="step"
          :value="trimStart"
          :disabled="disabled"
          @input="onStartInput"
        />
        <span class="trim-slider-value">{{ formatTime(trimStart) }}</span>
      </div>
      <div class="trim-slider-row">
        <span class="trim-slider-label">End</span>
        <input
          type="range"
          class="trim-slider"
          :min="0"
          :max="duration"
          :step="step"
          :value="trimEnd"
          :disabled="disabled"
          @input="onEndInput"
        />
        <span class="trim-slider-value">{{ formatTime(trimEnd) }}</span>
      </div>
    </div>

    <p class="trim-hint">Drag handles to seek the preview above.</p>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const MIN_CLIP_SECONDS = 0.05;

const props = defineProps<{
  duration: number;
  trimStart: number;
  trimEnd: number;
  disabled?: boolean;
  isPreviewingClip?: boolean;
  isExportingTrim?: boolean;
  formatTime: (seconds: number) => string;
}>();

const emit = defineEmits<{
  (e: 'update:trimStart', value: number): void;
  (e: 'update:trimEnd', value: number): void;
  (e: 'previewAt', time: number): void;
  (e: 'togglePreviewClip'): void;
  (e: 'downloadTrim'): void;
}>();

const step = 0.05;

const clipDuration = computed(() => Math.max(0, props.trimEnd - props.trimStart));

const selectionStyle = computed(() => {
  if (props.duration <= 0) {
    return { left: '0%', width: '100%' };
  }
  const left = (props.trimStart / props.duration) * 100;
  const width = ((props.trimEnd - props.trimStart) / props.duration) * 100;
  return {
    left: `${left}%`,
    width: `${Math.max(width, 0.5)}%`,
  };
});

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundStep(value: number): number {
  return Math.round(value / step) * step;
}

function onStartInput(event: Event) {
  const raw = parseFloat((event.target as HTMLInputElement).value);
  const maxStart = props.trimEnd - MIN_CLIP_SECONDS;
  const next = roundStep(clamp(raw, 0, maxStart));
  emit('update:trimStart', next);
  emit('previewAt', next);
}

function onEndInput(event: Event) {
  const raw = parseFloat((event.target as HTMLInputElement).value);
  const minEnd = props.trimStart + MIN_CLIP_SECONDS;
  const next = roundStep(clamp(raw, minEnd, props.duration));
  emit('update:trimEnd', next);
  emit('previewAt', next);
}
</script>

<style scoped>
.video-trimmer {
  margin-bottom: 0;
}

.video-trimmer.disabled {
  opacity: 0.55;
  pointer-events: none;
}

.trim-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 20px;
}

.option-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.9rem;
  color: rgba(255, 255, 255, 0.7);
  margin: 0;
}

.trim-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.trim-action-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.9);
  font-size: 0.8rem;
  cursor: pointer;
  transition: background 0.2s ease;
}

.trim-action-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.14);
}

.trim-action-btn.download-btn {
  border-color: rgba(212, 175, 55, 0.45);
  background: rgba(212, 175, 55, 0.12);
}

.trim-action-btn.download-btn:hover:not(:disabled) {
  background: rgba(212, 175, 55, 0.22);
}

.trim-action-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.trim-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: baseline;
  margin-bottom: 20px;
  font-size: 0.9rem;
  color: rgba(255, 255, 255, 0.9);
  font-variant-numeric: tabular-nums;
}

.trim-duration {
  color: rgba(212, 175, 55, 0.9);
  font-size: 0.85rem;
}

.trim-track {
  position: relative;
  height: 8px;
  border-radius: 4px;
  margin-bottom: 24px;
  overflow: hidden;
}

.trim-track-bg {
  position: absolute;
  inset: 0;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 4px;
}

.trim-selection {
  position: absolute;
  top: 0;
  bottom: 0;
  background: linear-gradient(90deg, rgba(212, 175, 55, 0.5), rgba(255, 215, 0, 0.7));
  border-radius: 4px;
  pointer-events: none;
}

.trim-sliders {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.trim-slider-row {
  display: flex;
  align-items: center;
  gap: 16px;
}

.trim-slider-label {
  min-width: 36px;
  font-size: 0.8rem;
  color: rgba(255, 255, 255, 0.55);
}

.trim-slider {
  flex: 1;
  height: 6px;
  -webkit-appearance: none;
  appearance: none;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 3px;
  cursor: pointer;
}

.trim-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #d4af37;
  cursor: pointer;
  border: 2px solid #fff;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
}

.trim-slider-value {
  min-width: 52px;
  text-align: right;
  font-size: 0.85rem;
  color: rgba(255, 255, 255, 0.85);
  font-variant-numeric: tabular-nums;
}

.trim-hint {
  margin: 20px 0 0;
  font-size: 0.78rem;
  color: rgba(255, 255, 255, 0.45);
}
</style>
