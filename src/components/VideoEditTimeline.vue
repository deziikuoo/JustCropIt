<template>
  <div class="edit-timeline" :class="{ 'edit-timeline--selecting': selectMode }">
    <div v-if="clips.length === 0" class="edit-timeline-empty">
      <i class="fas fa-clapperboard"></i>
      <span>Upload a video to start building a timeline.</span>
    </div>
    <div v-else>
      <div class="edit-timeline-controls">
        <div class="edit-timeline-zoom">
          <button 
            type="button"
            class="edit-timeline-zoom-btn"
            :disabled="pxPerSecond <= 20"
            @click="zoomOut"
            title="Zoom out"
          >
            <i class="fas fa-minus"></i>
          </button>
          <span class="edit-timeline-zoom-label">{{ Math.round((pxPerSecond / 60) * 100) }}%</span>
          <button 
            type="button"
            class="edit-timeline-zoom-btn"
            :disabled="pxPerSecond >= 200"
            @click="zoomIn"
            title="Zoom in"
          >
            <i class="fas fa-plus"></i>
          </button>
          <button 
            type="button"
            class="edit-timeline-zoom-btn"
            @click="zoomToFit"
            title="Fit to width"
          >
            <i class="fas fa-expand"></i>
          </button>
        </div>
        <div class="edit-timeline-actions">
          <div v-if="showSelectToggle || selectMode" class="edit-timeline-select">
            <span v-if="selectMode" class="edit-timeline-select-count">
              {{ selectedClipIds.size }} selected
            </span>
            <button
              v-if="selectMode"
              type="button"
              class="edit-timeline-select-btn"
              :disabled="clips.length === 0"
              @click="emit('select-all')"
            >
              Select all
            </button>
            <button
              v-if="selectMode"
              type="button"
              class="edit-timeline-select-btn edit-timeline-select-btn--done"
              @click="emit('exit-select-mode')"
            >
              Done
            </button>
            <button
              v-else
              type="button"
              class="edit-timeline-select-btn"
              title="Select multiple clips"
              @click="emit('enter-select-mode')"
            >
              <i class="fas fa-check-double"></i>
              Select
            </button>
          </div>
          <slot name="actions"></slot>
        </div>
      </div>
      <div class="edit-timeline-scroll" ref="scrollRef">
        <div
          class="edit-timeline-ruler"
          :style="{ width: trackWidthPx + 'px', '--px-per-second': pxPerSecond + 'px' }"
          @pointerdown="onRulerPointerDown"
        >
          <div 
            class="edit-timeline-playhead" 
            :class="{ 'edit-timeline-playhead--scrubbing': isScrubbing }"
            :style="{ left: displayPlayheadPx + 'px' }"
          ></div>
        </div>
        <div
          class="edit-timeline-track"
          :class="{ 'edit-timeline-track--selecting': selectMode }"
          :style="{ width: trackWidthPx + 'px' }"
        >
          <button
            v-for="clip in clips"
            :key="clip.id"
            type="button"
            class="edit-clip-block"
            :class="{
              'edit-clip-block--selected': selectedClipIds.has(clip.id),
              'edit-clip-block--compound': isCompoundClip(clip),
            }"
            :style="{ width: clipWidthPx(clip) + 'px' }"
            :title="clipTitle(clip)"
            :aria-pressed="selectMode ? selectedClipIds.has(clip.id) : undefined"
            @pointerdown="onClipPointerDown(clip.id, $event)"
            @click="onClipClick(clip.id, $event)"
          >
            <div v-if="thumbnailsFor(clip)" class="edit-clip-filmstrip">
              <img 
                v-for="(thumbUrl, idx) in thumbnailsFor(clip)" 
                :key="idx"
                :src="thumbUrl" 
                alt=""
                class="edit-clip-thumb"
                draggable="false"
              />
            </div>
            <div v-if="isCompoundClip(clip)" class="edit-clip-compound-children" aria-hidden="true">
              <div
                v-for="child in playbackOrderedChildren(clip)"
                :key="child.id"
                class="edit-clip-compound-child"
                :style="{ flexGrow: Math.max(0.05, getClipDuration(child)) }"
              ></div>
            </div>
            <div class="edit-clip-badges">
              <span v-if="isCompoundClip(clip)" class="edit-clip-badge" :title="`${compoundChildCount(clip)} clips combined`">
                <i class="fas fa-object-group"></i>{{ compoundChildCount(clip) }}
              </span>
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
            <span v-if="selectMode" class="edit-clip-check" :class="{ 'edit-clip-check--on': selectedClipIds.has(clip.id) }">
              <i class="fas fa-check"></i>
            </span>
            <span class="edit-clip-duration">{{ formatTime(getClipDuration(clip)) }}</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onUnmounted, nextTick } from 'vue';
import type { Clip } from '../types/videoEdit';
import { getClipDuration, isCompoundClip } from '../types/videoEdit';
import { generateClipThumbnails, roundThumbTimeMs, type ClipThumbnailRequest } from '../utils/videoEdit/clipThumbnails';
import { localTimeToSourceTime } from '../utils/videoEdit/clipMath';
import { compoundChildCount, playbackOrderedChildren } from '../utils/videoEdit/compoundClip';
import {
  TIMELINE_THUMB_TARGET_WIDTH_PX,
  TIMELINE_THUMB_MIN_CLIP_WIDTH_FOR_FILMSTRIP,
  TIMELINE_THUMB_MAX_PER_CLIP,
} from '../constants/optimization';

const props = defineProps<{
  clips: Clip[];
  selectedClipIds: Set<string>;
  playheadTime: number;
  totalDuration: number;
  videoUrl: string | null;
  videoFile: File | null;
  selectMode?: boolean;
  showSelectToggle?: boolean;
}>();

const emit = defineEmits<{
  (e: 'select-clip', id: string, additive: boolean): void;
  (e: 'select-range', id: string, additive?: boolean): void;
  (e: 'seek', time: number, scrubbing?: boolean): void;
  (e: 'enter-select-mode', id?: string): void;
  (e: 'exit-select-mode'): void;
  (e: 'select-all'): void;
}>();

// Reactive zoom scale
const pxPerSecond = ref(60);
const MIN_BLOCK_PX = 32;
const MIN_ZOOM = 20;
const MAX_ZOOM = 200;
const ZOOM_STEP = 10;

const scrollRef = ref<HTMLElement | null>(null);

const trackWidthPx = computed(() => Math.max(200, props.totalDuration * pxPerSecond.value));
const playheadPx = computed(() => props.playheadTime * pxPerSecond.value);

// Local playhead for immediate visual feedback during scrubbing
const localPlayheadPx = ref<number | null>(null);
const displayPlayheadPx = computed(() => localPlayheadPx.value ?? playheadPx.value);

function clipWidthPx(clip: Clip): number {
  return Math.max(MIN_BLOCK_PX, getClipDuration(clip) * pxPerSecond.value);
}

function clipTitle(clip: Clip): string {
  const parts = [`${getClipDuration(clip).toFixed(2)}s`];
  if (isCompoundClip(clip)) parts.push(`${compoundChildCount(clip)} clips combined`);
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

const CLIP_HOLD_MS = 500;
const CLIP_HOLD_MOVE_PX = 12;

let suppressClipClick = false;
let clipHoldTimer: number | null = null;
let clipHold:
  | { id: string; x: number; y: number; pointerId: number; target: Element | null }
  | null = null;

function isModifierSelect(event: PointerEvent | MouseEvent): boolean {
  return event.shiftKey || event.ctrlKey || event.metaKey;
}

function isTouchLikePointer(event: PointerEvent): boolean {
  return event.pointerType === 'touch' || event.pointerType === 'pen';
}

function clearClipHoldWatchers(): void {
  if (clipHoldTimer !== null) {
    clearTimeout(clipHoldTimer);
    clipHoldTimer = null;
  }
  window.removeEventListener('pointermove', onClipHoldPointerMove);
  window.removeEventListener('pointerup', onClipHoldPointerUp);
  window.removeEventListener('pointercancel', onClipHoldPointerUp);
  clipHold = null;
}

function vibrateSelectMode(): void {
  try {
    navigator.vibrate?.(12);
  } catch {
    // ignore
  }
}

function onClipClick(id: string, event: MouseEvent): void {
  if (suppressClipClick) {
    suppressClipClick = false;
    event.preventDefault();
    return;
  }
  if (props.selectMode) {
    emit('select-clip', id, true);
    return;
  }
  if (event.shiftKey) {
    emit('select-range', id, event.ctrlKey || event.metaKey);
    return;
  }
  emit('select-clip', id, event.ctrlKey || event.metaKey);
}

function onClipPointerDown(id: string, event: PointerEvent): void {
  if (event.button !== 0) return;

  if (isModifierSelect(event)) {
    event.preventDefault();
    suppressClipClick = true;
    if (event.shiftKey) {
      emit('select-range', id, event.ctrlKey || event.metaKey);
    } else {
      emit('select-clip', id, true);
    }
    return;
  }

  if (props.selectMode) {
    event.preventDefault();
    suppressClipClick = true;
    emit('select-clip', id, true);
    return;
  }

  if (isTouchLikePointer(event) || props.showSelectToggle) {
    event.preventDefault();
    clearClipHoldWatchers();
    clipHold = {
      id,
      x: event.clientX,
      y: event.clientY,
      pointerId: event.pointerId,
      target: event.currentTarget instanceof Element ? event.currentTarget : null,
    };
    if (clipHold.target) {
      try {
        clipHold.target.setPointerCapture(event.pointerId);
      } catch {
        // setPointerCapture may fail
      }
    }
    clipHoldTimer = window.setTimeout(() => {
      clipHoldTimer = null;
      const held = clipHold;
      clearClipHoldWatchers();
      if (!held) return;
      suppressClipClick = true;
      if (held.target) {
        try {
          held.target.releasePointerCapture(held.pointerId);
        } catch {
          // ignore
        }
      }
      vibrateSelectMode();
      emit('enter-select-mode', held.id);
    }, CLIP_HOLD_MS);
    window.addEventListener('pointermove', onClipHoldPointerMove);
    window.addEventListener('pointerup', onClipHoldPointerUp);
    window.addEventListener('pointercancel', onClipHoldPointerUp);
    return;
  }

  suppressClipClick = true;
  emit('select-clip', id, false);
  onRulerPointerDown(event);
}

function onClipHoldPointerMove(event: PointerEvent): void {
  if (!clipHold || event.pointerId !== clipHold.pointerId) return;
  const dx = event.clientX - clipHold.x;
  const dy = event.clientY - clipHold.y;
  if (Math.hypot(dx, dy) < CLIP_HOLD_MOVE_PX) return;

  const id = clipHold.id;
  const target = clipHold.target;
  const pointerId = clipHold.pointerId;
  clearClipHoldWatchers();
  suppressClipClick = true;
  emit('select-clip', id, false);
  if (target) {
    try {
      target.releasePointerCapture(pointerId);
    } catch {
      // ignore
    }
  }
  onRulerPointerDown(event);
}

function onClipHoldPointerUp(event: PointerEvent): void {
  if (!clipHold || event.pointerId !== clipHold.pointerId) return;
  const id = clipHold.id;
  const target = clipHold.target;
  const stillHolding = clipHoldTimer !== null;
  clearClipHoldWatchers();
  if (target) {
    try {
      target.releasePointerCapture(event.pointerId);
    } catch {
      // ignore
    }
  }
  if (!stillHolding || event.type === 'pointercancel') return;
  suppressClipClick = true;
  emit('select-clip', id, false);
  emit('seek', timeFromClientX(event.clientX), false);
}

function timeFromClientX(clientX: number): number {
  const el = scrollRef.value;
  if (!el) return 0;
  const rect = el.getBoundingClientRect();
  const x = clientX - rect.left + el.scrollLeft;
  return Math.max(0, Math.min(props.totalDuration, x / pxPerSecond.value));
}

// --- Zoom controls ---
function zoomIn(): void {
  const oldScale = pxPerSecond.value;
  const newScale = Math.min(MAX_ZOOM, oldScale + ZOOM_STEP);
  if (newScale === oldScale) return;
  
  const el = scrollRef.value;
  if (el) {
    // Preserve scroll position relative to playhead
    const oldScrollCenter = (el.scrollLeft + el.clientWidth / 2) / oldScale;
    pxPerSecond.value = newScale;
    void nextTick(() => {
      if (el) {
        el.scrollLeft = oldScrollCenter * newScale - el.clientWidth / 2;
      }
    });
  } else {
    pxPerSecond.value = newScale;
  }
}

function zoomOut(): void {
  const oldScale = pxPerSecond.value;
  const newScale = Math.max(MIN_ZOOM, oldScale - ZOOM_STEP);
  if (newScale === oldScale) return;
  
  const el = scrollRef.value;
  if (el) {
    // Preserve scroll position relative to playhead
    const oldScrollCenter = (el.scrollLeft + el.clientWidth / 2) / oldScale;
    pxPerSecond.value = newScale;
    void nextTick(() => {
      if (el) {
        el.scrollLeft = oldScrollCenter * newScale - el.clientWidth / 2;
      }
    });
  } else {
    pxPerSecond.value = newScale;
  }
}

function zoomToFit(): void {
  const el = scrollRef.value;
  if (!el || props.totalDuration <= 0) return;
  
  const availableWidth = el.clientWidth - 16; // Account for padding
  const fitScale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, availableWidth / props.totalDuration));
  pxPerSecond.value = fitScale;
}

// Auto-expand on clip delete
let lastClipCount = props.clips.length;
watch(() => props.clips.length, (newCount) => {
  if (newCount < lastClipCount && newCount > 0) {
    // Clips were deleted, check if we should auto-expand
    const el = scrollRef.value;
    if (el && props.totalDuration > 0) {
      const currentTrackWidth = props.totalDuration * pxPerSecond.value;
      const availableWidth = el.clientWidth - 16;
      
      // Only auto-expand if timeline is narrower than viewport
      if (currentTrackWidth < availableWidth) {
        const fitScale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, availableWidth / props.totalDuration));
        // Only zoom in, never out
        if (fitScale > pxPerSecond.value) {
          pxPerSecond.value = fitScale;
        }
      }
    }
  }
  lastClipCount = newCount;
});

// --- Smooth scrubbing with RAF batching and mobile gesture support ---
let isScrubbing = false;
let pendingSeekTime: number | null = null;
let rafId: number | null = null;
let capturedPointerId: number | null = null;

function emitSeekThrottled(): void {
  if (pendingSeekTime !== null) {
    emit('seek', pendingSeekTime, true);
    pendingSeekTime = null;
  }
  rafId = null;
}

function scheduleSeek(time: number): void {
  pendingSeekTime = time;
  localPlayheadPx.value = time * pxPerSecond.value;
  if (rafId === null) {
    rafId = requestAnimationFrame(emitSeekThrottled);
  }
}

function onRulerPointerMove(event: PointerEvent): void {
  if (!isScrubbing) return;
  scheduleSeek(timeFromClientX(event.clientX));
}

function onRulerPointerUp(event: PointerEvent): void {
  if (!isScrubbing) return;
  isScrubbing = false;
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  pendingSeekTime = null;
  const time = timeFromClientX(event.clientX);
  localPlayheadPx.value = null;
  emit('seek', time, false);
  
  if (capturedPointerId !== null && event.target instanceof Element) {
    try {
      event.target.releasePointerCapture(capturedPointerId);
    } catch {
      // Ignore errors if capture already released
    }
    capturedPointerId = null;
  }
  
  window.removeEventListener('pointermove', onRulerPointerMove);
  window.removeEventListener('pointerup', onRulerPointerUp);
  window.removeEventListener('pointercancel', onRulerPointerCancel);
}

function onRulerPointerCancel(event: PointerEvent): void {
  onRulerPointerUp(event);
}

function onRulerPointerDown(event: PointerEvent): void {
  event.preventDefault(); // Prevent scrolling on mobile
  isScrubbing = true;
  
  // Capture pointer for better mobile gesture handling
  if (event.target instanceof Element) {
    try {
      event.target.setPointerCapture(event.pointerId);
      capturedPointerId = event.pointerId;
    } catch {
      // setPointerCapture may fail in some contexts
    }
  }
  
  scheduleSeek(timeFromClientX(event.clientX));
  window.addEventListener('pointermove', onRulerPointerMove);
  window.addEventListener('pointerup', onRulerPointerUp);
  window.addEventListener('pointercancel', onRulerPointerCancel);
}

// --- Thumbnails (multi-keyframe filmstrip per clip) ---
const frameByMs = new Map<number, string>();
const thumbVersion = ref(0);
let thumbRefreshRunning = false;
let thumbRefreshQueued = false;
let cachedVideoUrl: string | null = null;
let thumbBumpRaf: number | null = null;

function bumpThumbnails(): void {
  if (thumbBumpRaf !== null) return;
  thumbBumpRaf = requestAnimationFrame(() => {
    thumbBumpRaf = null;
    thumbVersion.value++;
  });
}

function clipIdentityKey(clip: Clip): string {
  const freezeTime = clip.freeze ? clip.freeze.sourceTime : '';
  const childPart = clip.children?.length ? `[${clip.children.map(clipIdentityKey).join(';')}]` : '';
  return `${clip.id}|${clip.sourceStart}|${clip.sourceEnd}|${clip.reversed}|${clip.speed}|${freezeTime}|${childPart}`;
}

function getClipThumbnailCount(widthPx: number): number {
  if (widthPx < TIMELINE_THUMB_MIN_CLIP_WIDTH_FOR_FILMSTRIP) return 1;
  return Math.min(
    TIMELINE_THUMB_MAX_PER_CLIP,
    Math.max(1, Math.floor(widthPx / TIMELINE_THUMB_TARGET_WIDTH_PX))
  );
}

function clipThumbTimes(clip: Clip): number[] {
  const widthPx = clipWidthPx(clip);
  const thumbCount = getClipThumbnailCount(widthPx);
  const duration = getClipDuration(clip);
  if (clip.freeze && !isCompoundClip(clip)) {
    return [clip.freeze.sourceTime];
  }
  const times: number[] = [];
  for (let i = 0; i < thumbCount; i++) {
    const localTime = (duration * (i + 0.5)) / thumbCount;
    times.push(localTimeToSourceTime(clip, localTime));
  }
  return times;
}

function thumbnailsFor(clip: Clip): string[] | undefined {
  void thumbVersion.value;
  const urls: string[] = [];
  for (const time of clipThumbTimes(clip)) {
    const url = frameByMs.get(roundThumbTimeMs(time));
    if (url) urls.push(url);
  }
  return urls.length > 0 ? urls : undefined;
}

function clearFrameCache(): void {
  for (const url of frameByMs.values()) URL.revokeObjectURL(url);
  frameByMs.clear();
  thumbVersion.value++;
}

function scheduleThumbnailRefresh(): void {
  thumbRefreshQueued = true;
  if (!thumbRefreshRunning) void runThumbnailRefresh();
}

async function runThumbnailRefresh(): Promise<void> {
  thumbRefreshRunning = true;
  try {
    while (thumbRefreshQueued) {
      thumbRefreshQueued = false;
      await refreshThumbnails();
    }
  } finally {
    thumbRefreshRunning = false;
    if (thumbRefreshQueued) void runThumbnailRefresh();
  }
}

async function refreshThumbnails(): Promise<void> {
  const url = props.videoUrl;
  if (url !== cachedVideoUrl) {
    clearFrameCache();
    cachedVideoUrl = url;
  }
  if (!url) return;

  const requests: ClipThumbnailRequest[] = [];
  const seenMs = new Set<number>();

  for (const clip of props.clips) {
    const times = clipThumbTimes(clip);
    times.forEach((time, i) => {
      const ms = roundThumbTimeMs(time);
      if (frameByMs.has(ms) || seenMs.has(ms)) return;
      seenMs.add(ms);
      requests.push({ key: `${clip.id}@${i}@${ms}`, sourceTime: time });
    });
  }

  if (requests.length === 0) {
    bumpThumbnails();
    return;
  }

  await generateClipThumbnails(props.videoFile, url, requests, (sourceTime, objectUrl) => {
    const ms = roundThumbTimeMs(sourceTime);
    const previous = frameByMs.get(ms);
    if (previous && previous !== objectUrl) URL.revokeObjectURL(previous);
    frameByMs.set(ms, objectUrl);
    bumpThumbnails();
  });
}

watch(
  () => [props.clips.map(clipIdentityKey).join(','), props.videoUrl, pxPerSecond.value] as const,
  () => {
    scheduleThumbnailRefresh();
  },
  { immediate: true }
);

onUnmounted(() => {
  clearClipHoldWatchers();
  if (thumbBumpRaf !== null) cancelAnimationFrame(thumbBumpRaf);
  clearFrameCache();
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
  }
  window.removeEventListener('pointermove', onRulerPointerMove);
  window.removeEventListener('pointerup', onRulerPointerUp);
  window.removeEventListener('pointercancel', onRulerPointerCancel);
});
</script>

<style scoped>
.edit-timeline {
  width: 100%;
}

.edit-timeline--selecting .edit-timeline-scroll {
  box-shadow: inset 0 0 0 1px rgba(255, 215, 0, 0.25);
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

.edit-timeline-controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 0 8px 0;
  flex-wrap: wrap;
}

.edit-timeline-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}

.edit-timeline-select {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-right: 4px;
}

.edit-timeline-select-count {
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.7);
  white-space: nowrap;
}

.edit-timeline-select-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 32px;
  padding: 4px 10px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.9);
  font-size: 0.75rem;
  cursor: pointer;
}

.edit-timeline-select-btn--done {
  background: rgba(212, 175, 55, 0.2);
  border-color: rgba(212, 175, 55, 0.45);
  color: #ffd700;
}

.edit-timeline-zoom {
  display: flex;
  align-items: center;
  gap: 6px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  padding: 4px 8px;
}

.edit-timeline-zoom-label {
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.7);
  min-width: 40px;
  text-align: center;
}

.edit-timeline-zoom-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.8);
  border-radius: 4px;
  cursor: pointer;
  padding: 0;
  transition: background 0.15s ease, color 0.15s ease;
  font-size: 0.7rem;
}

.edit-timeline-zoom-btn:hover:not(:disabled) {
  background: rgba(255, 215, 0, 0.15);
  color: #ffd700;
}

.edit-timeline-zoom-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
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
  height: 32px;
  cursor: pointer;
  touch-action: pan-y;
  background: repeating-linear-gradient(
    90deg,
    rgba(255, 255, 255, 0.12) 0,
    rgba(255, 255, 255, 0.12) 1px,
    transparent 1px,
    transparent var(--px-per-second, 60px)
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

.edit-timeline-playhead--scrubbing {
  transition: left 0.05s linear;
}

.edit-timeline-track {
  display: flex;
  gap: 3px;
  padding: 6px 0 4px;
  min-height: 76px;
  touch-action: pan-y;
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
  touch-action: pan-y;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  transition: border-color 0.15s ease, transform 0.15s ease;
}

.edit-clip-block:hover {
  border-color: rgba(212, 175, 55, 0.5);
}

.edit-clip-block--selected {
  border-color: #ffd700;
  box-shadow: 0 0 0 2px rgba(255, 215, 0, 0.35);
}

.edit-clip-block--compound {
  border-color: rgba(255, 215, 0, 0.45);
}

.edit-clip-compound-children {
  position: absolute;
  inset: 0;
  display: flex;
  pointer-events: none;
  z-index: 1;
}

.edit-clip-compound-child {
  min-width: 0;
  border-right: 1px solid rgba(255, 215, 0, 0.4);
}

.edit-clip-compound-child:last-child {
  border-right: none;
}

.edit-clip-filmstrip {
  position: absolute;
  inset: 0;
  display: flex;
  height: 100%;
  gap: 1px;
  overflow: hidden;
}

.edit-clip-thumb {
  flex: 1;
  height: 100%;
  object-fit: cover;
  pointer-events: none;
  min-width: 0;
}

.edit-clip-badges {
  position: absolute;
  top: 3px;
  left: 3px;
  display: flex;
  gap: 3px;
  z-index: 2;
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
  z-index: 2;
}

.edit-clip-check {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 18px;
  height: 18px;
  border-radius: 5px;
  border: 1.5px solid rgba(255, 255, 255, 0.55);
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  color: transparent;
  font-size: 0.6rem;
  z-index: 2;
  pointer-events: none;
}

.edit-clip-check--on {
  background: rgba(212, 175, 55, 0.95);
  border-color: rgba(212, 175, 55, 1);
  color: #1a1a1a;
}

@media (max-width: 599px) {
  .edit-timeline-controls {
    gap: 8px;
  }

  .edit-timeline-zoom {
    padding: 4px 6px;
    gap: 4px;
  }

  .edit-timeline-zoom-btn {
    width: 32px;
    height: 32px;
    font-size: 0.75rem;
  }

  .edit-timeline-zoom-label {
    min-width: 36px;
    font-size: 0.7rem;
  }

  .edit-timeline-select {
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .edit-timeline-select-btn {
    min-height: 40px;
    padding: 6px 12px;
    font-size: 0.78rem;
  }

  .edit-clip-check {
    width: 22px;
    height: 22px;
    font-size: 0.7rem;
  }
}
</style>
