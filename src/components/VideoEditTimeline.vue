<template>
  <div class="edit-timeline">
    <div v-if="clips.length === 0" class="edit-timeline-empty">
      <i class="fas fa-clapperboard"></i>
      <span>Upload a video to start building a timeline.</span>
    </div>
    <div v-else class="edit-timeline-scroll" ref="scrollRef">
      <div
        class="edit-timeline-ruler"
        :style="{ width: trackWidthPx + 'px' }"
        @pointerdown="onRulerPointerDown"
      >
        <div class="edit-timeline-playhead" :style="{ left: playheadPx + 'px' }"></div>
      </div>
      <div class="edit-timeline-track" :style="{ width: trackWidthPx + 'px' }">
        <button
          v-for="clip in clips"
          :key="clip.id"
          type="button"
          class="edit-clip-block"
          :class="{ 'edit-clip-block--selected': selectedClipIds.has(clip.id) }"
          :style="{ width: clipWidthPx(clip) + 'px' }"
          :title="clipTitle(clip)"
          @click="onClipClick(clip.id, $event)"
        >
          <img
            v-if="thumbnailFor(clip)"
            :src="thumbnailFor(clip)"
            alt=""
            class="edit-clip-thumb"
            draggable="false"
          />
          <div class="edit-clip-badges">
            <span v-if="clip.freeze" class="edit-clip-badge" title="Freeze frame">
              <i class="fas fa-snowflake"></i>
            </span>
            <span v-if="clip.reversed" class="edit-clip-badge" title="Reversed">
              <i class="fas fa-backward"></i>
            </span>
            <span v-if="clip.speed !== 1" class="edit-clip-badge" title="Speed">
              {{ clip.speed }}x
            </span>
            <span v-if="clip.crop" class="edit-clip-badge" title="Cropped">
              <i class="fas fa-crop-simple"></i>
            </span>
            <span v-if="clip.autoBuilt" class="edit-clip-badge" title="Auto Built">
              <i class="fas fa-wand-magic-sparkles"></i>
            </span>
          </div>
          <span class="edit-clip-duration">{{ formatTime(getClipDuration(clip)) }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue';
import type { Clip } from '../types/videoEdit';
import { getClipDuration } from '../types/videoEdit';
import { generateClipThumbnails, type ClipThumbnailRequest } from '../utils/videoEdit/clipThumbnails';
import { localTimeToSourceTime } from '../utils/videoEdit/clipMath';

const props = defineProps<{
  clips: Clip[];
  selectedClipIds: Set<string>;
  playheadTime: number;
  totalDuration: number;
  videoUrl: string | null;
  videoFile: File | null;
}>();

const emit = defineEmits<{
  (e: 'select-clip', id: string, additive: boolean): void;
  (e: 'select-range', id: string): void;
  (e: 'seek', time: number): void;
}>();

const PX_PER_SECOND = 60;
const MIN_BLOCK_PX = 32;

const scrollRef = ref<HTMLElement | null>(null);

const trackWidthPx = computed(() => Math.max(200, props.totalDuration * PX_PER_SECOND));
const playheadPx = computed(() => props.playheadTime * PX_PER_SECOND);

function clipWidthPx(clip: Clip): number {
  return Math.max(MIN_BLOCK_PX, getClipDuration(clip) * PX_PER_SECOND);
}

function clipTitle(clip: Clip): string {
  const parts = [`${getClipDuration(clip).toFixed(2)}s`];
  if (clip.speed !== 1) parts.push(`${clip.speed}x speed`);
  if (clip.reversed) parts.push('reversed');
  if (clip.freeze) parts.push('freeze frame');
  if (clip.crop) parts.push('cropped');
  return parts.join(' · ');
}

function formatTime(seconds: number): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const rem = (s % 60).toFixed(1);
  return m > 0 ? `${m}:${rem.padStart(4, '0')}` : `${rem}s`;
}

function onClipClick(id: string, event: MouseEvent): void {
  if (event.shiftKey) {
    emit('select-range', id);
    return;
  }
  emit('select-clip', id, event.ctrlKey || event.metaKey);
}

function timeFromClientX(clientX: number): number {
  const el = scrollRef.value;
  if (!el) return 0;
  const rect = el.getBoundingClientRect();
  const x = clientX - rect.left + el.scrollLeft;
  return Math.max(0, Math.min(props.totalDuration, x / PX_PER_SECOND));
}

let isScrubbing = false;

function onRulerPointerMove(event: PointerEvent): void {
  if (!isScrubbing) return;
  emit('seek', timeFromClientX(event.clientX));
}

function onRulerPointerUp(): void {
  isScrubbing = false;
  window.removeEventListener('pointermove', onRulerPointerMove);
  window.removeEventListener('pointerup', onRulerPointerUp);
}

function onRulerPointerDown(event: PointerEvent): void {
  isScrubbing = true;
  emit('seek', timeFromClientX(event.clientX));
  window.addEventListener('pointermove', onRulerPointerMove);
  window.addEventListener('pointerup', onRulerPointerUp);
}

// --- Thumbnails (captured lazily per clip, cached by a content-aware key so
// toggling reverse/freeze on the same clip id invalidates the stale thumbnail) ---
const thumbnails = ref<Map<string, string>>(new Map());

function clipThumbKey(clip: Clip): string {
  const freezeTime = clip.freeze ? clip.freeze.sourceTime : '';
  return `${clip.id}|${clip.sourceStart}|${clip.sourceEnd}|${clip.reversed}|${freezeTime}`;
}

function thumbnailFor(clip: Clip): string | undefined {
  return thumbnails.value.get(clipThumbKey(clip));
}

async function refreshThumbnails(): Promise<void> {
  const url = props.videoUrl;
  const nextKeys = new Set(props.clips.map(clipThumbKey));

  for (const key of Array.from(thumbnails.value.keys())) {
    if (!nextKeys.has(key)) {
      const stale = thumbnails.value.get(key);
      if (stale) URL.revokeObjectURL(stale);
      thumbnails.value.delete(key);
    }
  }
  if (!url) return;

  const requests: ClipThumbnailRequest[] = [];
  for (const clip of props.clips) {
    const key = clipThumbKey(clip);
    if (thumbnails.value.has(key)) continue;
    const sourceTime = clip.freeze ? clip.freeze.sourceTime : localTimeToSourceTime(clip, 0);
    requests.push({ key, sourceTime });
  }
  if (requests.length === 0) return;

  // Single hardware-decode pass for every missing thumbnail (falls back to
  // per-clip capture internally when WebCodecs is unavailable/fails).
  const results = await generateClipThumbnails(props.videoFile, url, requests);
  for (const [key, thumbUrl] of results) {
    thumbnails.value.set(key, thumbUrl);
  }
}

watch(
  () => [props.clips.map(clipThumbKey).join(','), props.videoUrl],
  () => {
    void refreshThumbnails();
  },
  { immediate: true }
);

onUnmounted(() => {
  for (const url of thumbnails.value.values()) URL.revokeObjectURL(url);
  window.removeEventListener('pointermove', onRulerPointerMove);
  window.removeEventListener('pointerup', onRulerPointerUp);
});
</script>

<style scoped>
.edit-timeline {
  width: 100%;
}

.edit-timeline-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 48px 24px;
  color: rgba(255, 255, 255, 0.45);
  border: 2px dashed rgba(255, 255, 255, 0.15);
  border-radius: 14px;
}

.edit-timeline-empty i {
  font-size: 28px;
}

.edit-timeline-scroll {
  overflow-x: auto;
  overflow-y: hidden;
  padding-bottom: 8px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.edit-timeline-ruler {
  position: relative;
  height: 16px;
  cursor: pointer;
  background: repeating-linear-gradient(
    90deg,
    rgba(255, 255, 255, 0.12) 0,
    rgba(255, 255, 255, 0.12) 1px,
    transparent 1px,
    transparent 60px
  );
}

.edit-timeline-playhead {
  position: absolute;
  top: 0;
  bottom: -200px;
  width: 2px;
  background: #ffd700;
  box-shadow: 0 0 6px rgba(255, 215, 0, 0.7);
  pointer-events: none;
  z-index: 2;
}

.edit-timeline-track {
  display: flex;
  gap: 3px;
  padding: 6px 0 4px;
  min-height: 76px;
}

.edit-clip-block {
  position: relative;
  height: 72px;
  border-radius: 8px;
  overflow: hidden;
  border: 2px solid rgba(255, 255, 255, 0.12);
  background: rgba(0, 0, 0, 0.4);
  cursor: pointer;
  padding: 0;
  flex-shrink: 0;
  transition: border-color 0.15s ease, transform 0.15s ease;
}

.edit-clip-block:hover {
  border-color: rgba(212, 175, 55, 0.5);
}

.edit-clip-block--selected {
  border-color: #ffd700;
  box-shadow: 0 0 0 2px rgba(255, 215, 0, 0.35);
}

.edit-clip-thumb {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  pointer-events: none;
}

.edit-clip-badges {
  position: absolute;
  top: 3px;
  left: 3px;
  display: flex;
  gap: 3px;
  z-index: 1;
}

.edit-clip-badge {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 1px 4px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.65);
  color: #ffd700;
  font-size: 0.6rem;
  font-weight: 700;
}

.edit-clip-duration {
  position: absolute;
  bottom: 3px;
  right: 4px;
  padding: 1px 4px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.65);
  color: rgba(255, 255, 255, 0.9);
  font-size: 0.65rem;
  z-index: 1;
}
</style>
