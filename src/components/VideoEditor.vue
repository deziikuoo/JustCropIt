<template>
  <div class="video-editor" ref="editorRootRef">
    <div
      class="edit-dropzone"
      :class="{ 'has-video': videoFile, 'drag-over': isDragOver }"
      @dragover.prevent="isDragOver = true"
      @dragleave.prevent="isDragOver = false"
      @drop.prevent="handleDrop"
    >
      <template v-if="!videoFile">
        <div class="edit-dropzone-content" @click="fileInputRef?.click()">
          <i class="fas fa-clapperboard"></i>
          <h3>Drop a video to start editing</h3>
          <p>Split, trim, combine, speed, crop, reverse, freeze, and auto-build boomerang loops</p>
          <input
            ref="fileInputRef"
            type="file"
            accept="video/*"
            class="edit-file-input"
            @change="handleFileSelect"
          />
        </div>
      </template>

      <template v-else>
        <div class="edit-preview">
          <div
            class="edit-preview-video-wrap"
            :class="{ 'edit-preview-video-wrap--cropped': isCroppedPreview }"
            :style="cropPreviewStyle"
          >
            <video
              ref="previewVideoRef"
              class="edit-preview-video"
              :class="{ 'edit-preview-video--hidden': !!freezeFrameUrl || reversePreviewActive }"
              playsinline
              preload="metadata"
              @loadedmetadata="syncVideoMetadata"
              @durationchange="syncVideoMetadata"
              @loadeddata="syncVideoMetadata"
            ></video>
            <canvas
              v-show="reversePreviewActive"
              ref="reverseCanvasRef"
              class="edit-preview-layer edit-preview-layer--canvas"
            ></canvas>
            <img
              v-if="freezeFrameUrl"
              :src="freezeFrameUrl"
              alt="Frozen frame"
              class="edit-preview-layer"
            />
          </div>
          <div v-if="isBuffering" class="edit-preview-buffering">
            <i class="fas fa-spinner fa-spin"></i> Preparing reverse preview...
          </div>
        </div>

        <div class="edit-transport">
          <button
            type="button"
            class="edit-icon-btn"
            :disabled="clips.length === 0 || isExporting"
            title="Previous frame (←)"
            @click="nudgePlayhead(-1)"
          >
            <i class="fas fa-caret-left"></i>
          </button>
          <button type="button" class="edit-icon-btn" @click="togglePlay" :disabled="clips.length === 0 || isExporting">
            <i :class="isPlaying ? 'fas fa-pause' : 'fas fa-play'"></i>
          </button>
          <button
            type="button"
            class="edit-icon-btn"
            :disabled="clips.length === 0 || isExporting"
            title="Next frame (→)"
            @click="nudgePlayhead(1)"
          >
            <i class="fas fa-caret-right"></i>
          </button>
          <span class="edit-time">{{ formatTime(playheadTime) }} / {{ formatTime(totalDuration) }}</span>
          <span class="edit-frame-hint">← → frame · Shift+← → 1s · Ctrl/Shift-click clips</span>
          <div class="edit-transport-spacer"></div>
          <button type="button" class="edit-text-btn" @click="clearVideoPage">
            <i class="fas fa-xmark"></i> Clear video
          </button>
        </div>

        <div class="edit-toolbar">
          <div class="edit-toolbar-group">
            <button type="button" class="edit-tool-btn" :disabled="clips.length === 0 || isExporting" @click="handleSplit">
              <i class="fas fa-scissors"></i><span>Split</span>
            </button>
            <button type="button" class="edit-tool-btn" :disabled="!hasSelection || isExporting" @click="handleDelete">
              <i class="fas fa-trash"></i><span>Delete</span>
            </button>
            <button type="button" class="edit-tool-btn" :disabled="!hasSelection || isExporting" @click="handleDuplicate">
              <i class="fas fa-clone"></i><span>Duplicate</span>
            </button>
            <button
              type="button"
              class="edit-tool-btn"
              :disabled="!canCombineSelection || isExporting"
              title="Combine into a compound clip (Ctrl+G)"
              @click="handleCombine"
            >
              <i class="fas fa-object-group"></i><span>Combine</span>
            </button>
            <button
              type="button"
              class="edit-tool-btn"
              :disabled="!canUngroupSelection || isExporting"
              title="Ungroup compound clip (Ctrl+Shift+G)"
              @click="handleUngroup"
            >
              <i class="fas fa-object-ungroup"></i><span>Ungroup</span>
            </button>
          </div>

          <div class="edit-toolbar-group">
            <button type="button" class="edit-tool-btn" :disabled="!hasSelection || isExporting" @click="handleReverse">
              <i class="fas fa-backward"></i><span>Reverse</span>
            </button>
            <button type="button" class="edit-tool-btn" :disabled="clips.length === 0 || isExporting" @click="handleFreeze">
              <i class="fas fa-snowflake"></i><span>Freeze</span>
            </button>
            <button
              type="button"
              class="edit-tool-btn"
              :disabled="selectedClipIds.size !== 1 || isExporting"
              @click="openCropTool"
            >
              <i class="fas fa-crop-simple"></i><span>Crop</span>
            </button>
          </div>

          <div class="edit-toolbar-group edit-toolbar-group--actions">
            <div class="edit-speed-control" :class="{ 'edit-speed-control--disabled': !hasSelection }">
              <i class="fas fa-gauge"></i>
              <select :disabled="!hasSelection || isExporting" @change="onSpeedSelect" :value="currentSpeedValue">
                <option v-for="s in speedOptions" :key="s" :value="s">{{ s }}x</option>
              </select>
            </div>
            <button
              type="button"
              class="edit-tool-btn edit-tool-btn--accent"
              :disabled="clips.length === 0 || isExporting"
              @click="handleAutoBuild"
            >
              <i class="fas fa-wand-magic-sparkles"></i><span>Auto Build</span>
            </button>
          </div>

          <div class="edit-toolbar-group edit-toolbar-group--history">
            <button type="button" class="edit-tool-btn" :disabled="!canUndo || isExporting" @click="handleUndo" title="Undo (Ctrl+Z)">
              <i class="fas fa-rotate-left"></i><span>Undo</span>
            </button>
            <button type="button" class="edit-tool-btn" :disabled="!canRedo || isExporting" @click="handleRedo" title="Redo (Ctrl+Y)">
              <i class="fas fa-rotate-right"></i><span>Redo</span>
            </button>
          </div>
        </div>

        <p v-if="error" class="edit-error">{{ error }}</p>

        <VideoEditTimeline
          :clips="clips"
          :selected-clip-ids="selectedClipIds"
          :playhead-time="playheadTime"
          :total-duration="totalDuration"
          :video-url="videoPreviewUrl"
          :video-file="videoFile"
          :select-mode="clipSelectMode"
          :show-select-toggle="useTouchClipSelect"
          @select-clip="onSelectClip"
          @select-range="onSelectRange"
          @seek="handleSeek"
          @enter-select-mode="enterClipSelectMode"
          @exit-select-mode="exitClipSelectMode"
          @select-all="selectAll"
        >
          <template #actions>
            <div v-if="isExporting && exportProgress" class="edit-export-progress">
              <div class="edit-export-progress-bar">
                <div class="edit-export-progress-fill" :style="{ width: exportProgress.percent + '%' }"></div>
              </div>
              <span>{{ exportProgress.message || 'Exporting...' }}</span>
            </div>
            <button
              type="button"
              class="edit-tool-btn edit-tool-btn--primary"
              :disabled="clips.length === 0 || isExporting || isBuffering"
              @click="handleExport"
            >
              <i class="fas fa-download"></i><span>{{ isExporting ? 'Exporting...' : 'Export' }}</span>
            </button>
          </template>
        </VideoEditTimeline>
      </template>
    </div>

    <CropModal
      v-if="showCropTool && cropSourceUrl"
      :show="showCropTool"
      :image-src="cropSourceUrl"
      :detection-supported="false"
      @cropped="handleCropped"
      @close="closeCropTool"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';
import { useVideoTimelineEditor } from '../composables/useVideoTimelineEditor';
import VideoEditTimeline from './VideoEditTimeline.vue';
import CropModal from './CropModal.vue';
import {
  createTimelinePreviewController,
  type TimelinePreviewController,
} from '../utils/videoEdit/timelinePreviewController';
import { captureVideoFrameAsUrl } from '../utils/videoEdit/captureFrame';
import { localTimeToSourceTime, findClipAtTime } from '../utils/videoEdit/clipMath';
import { flattenClipsForRender } from '../utils/videoEdit/compoundClip';
import type { CropBox } from '../types/videoEdit';
import { useLayoutMode } from '../composables/useLayoutMode';

const {
  videoFile,
  videoInfo,
  videoPreviewUrl,
  error,
  clips,
  selectedClipIds,
  playheadTime,
  totalDuration,
  hasSelection,
  selectedClips,
  canCombineSelection,
  canUngroupSelection,
  canUndo,
  canRedo,
  isExporting,
  exportProgress,
  toggleClipSelection,
  selectRangeTo,
  clearSelection,
  selectAll,
  loadVideo,
  applyVideoMetadataFallback,
  restoreSession,
  reset,
  undo,
  redo,
  splitAtPlayhead,
  deleteSelected,
  duplicateSelected,
  combineSelected,
  ungroupSelected,
  setSpeedForSelected,
  reverseSelected,
  applyCropToSelected,
  freezeAtPlayhead,
  runAutoBuild,
  exportEditedVideo,
} = useVideoTimelineEditor();

const fileInputRef = ref<HTMLInputElement | null>(null);
const editorRootRef = ref<HTMLElement | null>(null);
const isDragOver = ref(false);
const previewVideoRef = ref<HTMLVideoElement | null>(null);
const reverseCanvasRef = ref<HTMLCanvasElement | null>(null);
const freezeFrameUrl = ref<string | null>(null);
const reversePreviewActive = ref(false);
const isBuffering = ref(false);
const isPlaying = ref(false);
const clipSelectMode = ref(false);
const { isPhone, isCoarsePointer } = useLayoutMode();
const useTouchClipSelect = computed(() => isPhone.value || isCoarsePointer.value);

let previewController: TimelinePreviewController | null = null;

function ensurePreviewController(): TimelinePreviewController {
  if (!previewController) {
    previewController = createTimelinePreviewController(
      previewVideoRef,
      videoFile,
      videoPreviewUrl,
      () => flattenClipsForRender(clips.value),
      reverseCanvasRef,
      {
        onTimeUpdate: (t) => {
          playheadTime.value = t;
        },
        onFreezeFrame: (url) => {
          freezeFrameUrl.value = url;
        },
        onReversePreview: (active) => {
          reversePreviewActive.value = active;
        },
        onBuffering: (b) => {
          isBuffering.value = b;
        },
        onEnded: () => {
          isPlaying.value = false;
        },
      }
    );
  }
  return previewController;
}

function resetPreviewController(): void {
  previewController?.dispose();
  previewController = null;
  isPlaying.value = false;
  freezeFrameUrl.value = null;
  reversePreviewActive.value = false;
}

function handleFileSelect(event: Event): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file && file.type.startsWith('video/')) {
    void loadSelectedVideo(file);
  }
  input.value = '';
}

function handleDrop(event: DragEvent): void {
  isDragOver.value = false;
  const file = event.dataTransfer?.files?.[0];
  if (file && file.type.startsWith('video/')) {
    void loadSelectedVideo(file);
  }
}

async function loadSelectedVideo(file: File): Promise<void> {
  resetPreviewController();
  await loadVideo(file);
  
  // Ensure video element gets the source URL immediately for metadata loading
  const video = previewVideoRef.value;
  if (video && videoPreviewUrl.value) {
    video.src = videoPreviewUrl.value;
    // Wait for metadata to load, then sync
    await new Promise<void>((resolve) => {
      const checkMetadata = () => {
        if (video.duration > 0 && Number.isFinite(video.duration)) {
          syncVideoMetadata();
          resolve();
        } else {
          // Retry after a short delay if metadata not ready
          setTimeout(checkMetadata, 50);
        }
      };
      checkMetadata();
    });
  }
}

function syncVideoMetadata(): void {
  const video = previewVideoRef.value;
  if (!video) return;
  applyVideoMetadataFallback({
    duration: video.duration,
    width: video.videoWidth,
    height: video.videoHeight,
  });
}

async function togglePlay(): Promise<void> {
  const controller = ensurePreviewController();
  if (controller.isPlaying()) {
    controller.pause();
    isPlaying.value = false;
    return;
  }
  isPlaying.value = true;
  const restart = playheadTime.value >= totalDuration.value - 0.05;
  await controller.play(restart ? 0 : undefined);
}

async function handleSeek(time: number, scrubbing = false): Promise<void> {
  if (isExporting.value) return;
  const controller = ensurePreviewController();
  if (scrubbing) {
    isPlaying.value = false;
    void controller.seekTo(time, { scrub: true });
    return;
  }
  await controller.seekTo(time);
}

function onSelectClip(id: string, additive: boolean): void {
  toggleClipSelection(id, additive);
}

function onSelectRange(id: string, additive = false): void {
  selectRangeTo(id, additive);
}

function enterClipSelectMode(id?: string): void {
  clipSelectMode.value = true;
  if (id) toggleClipSelection(id, false);
}

function exitClipSelectMode(): void {
  clipSelectMode.value = false;
}

watch(useTouchClipSelect, (touch) => {
  if (!touch) clipSelectMode.value = false;
});

watch(
  () => clips.value.length,
  (count) => {
    if (count === 0) clipSelectMode.value = false;
  }
);

async function handleSplit(): Promise<void> {
  previewController?.pause();
  isPlaying.value = false;
  await splitAtPlayhead();
}

async function handleFreeze(): Promise<void> {
  previewController?.pause();
  isPlaying.value = false;
  await freezeAtPlayhead();
}

async function handleDelete(): Promise<void> {
  previewController?.pause();
  isPlaying.value = false;
  await deleteSelected();
}

async function handleDuplicate(): Promise<void> {
  previewController?.pause();
  isPlaying.value = false;
  await duplicateSelected();
}

async function handleCombine(): Promise<void> {
  previewController?.pause();
  isPlaying.value = false;
  await combineSelected();
}

async function handleUngroup(): Promise<void> {
  previewController?.pause();
  isPlaying.value = false;
  await ungroupSelected();
  void ensurePreviewController().prefetchReversedClips(clips.value);
}

async function handleReverse(): Promise<void> {
  previewController?.pause();
  isPlaying.value = false;
  await reverseSelected();
  void ensurePreviewController().prefetchReversedClips(clips.value);
}

async function handleUndo(): Promise<void> {
  previewController?.pause();
  isPlaying.value = false;
  await undo();
}

async function handleRedo(): Promise<void> {
  previewController?.pause();
  isPlaying.value = false;
  await redo();
}

// Ctrl+Z / Ctrl+Y (or Ctrl+Shift+Z) undo/redo — only while this editor is visible
// (App.vue mounts VideoEditor on the Video tab once unlocked; guard on real visibility)
// and a video is loaded, and not while the crop tool overlay is open.
function isEditorVisible(): boolean {
  return !!editorRootRef.value && editorRootRef.value.offsetParent !== null;
}

function onKeyDown(event: KeyboardEvent): void {
  if (!videoFile.value || showCropTool.value || isExporting.value || !isEditorVisible()) return;
  const target = event.target as HTMLElement | null;
  if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
    return;
  }

  const isModifierPressed = event.ctrlKey || event.metaKey;
  if (isModifierPressed) {
    const key = event.key.toLowerCase();
    if (key === 'z' && !event.shiftKey) {
      event.preventDefault();
      void handleUndo();
    } else if (key === 'y' || (key === 'z' && event.shiftKey)) {
      event.preventDefault();
      void handleRedo();
    } else if (key === 'a') {
      event.preventDefault();
      selectAll();
      if (useTouchClipSelect.value) clipSelectMode.value = true;
    } else if (key === 'g' && event.shiftKey) {
      event.preventDefault();
      void handleUngroup();
    } else if (key === 'g') {
      event.preventDefault();
      void handleCombine();
    }
    return;
  }

  if (event.key === 'Escape') {
    event.preventDefault();
    if (clipSelectMode.value) {
      exitClipSelectMode();
      return;
    }
    clearSelection();
    return;
  }

  if (event.key === 'ArrowLeft' || event.key === ',') {
    event.preventDefault();
    if (event.shiftKey) nudgePlayhead(0, -1);
    else nudgePlayhead(-1);
    return;
  }
  if (event.key === 'ArrowRight' || event.key === '.') {
    event.preventDefault();
    if (event.shiftKey) nudgePlayhead(0, 1);
    else nudgePlayhead(1);
  }
}

onMounted(async () => {
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('justcropit:video-edit-session-expired', onEditSessionExpiredExternally);

  const restored = await restoreSession();
  if (!restored) return;

  await nextTick();
  const video = previewVideoRef.value;
  if (video && videoPreviewUrl.value) {
    video.src = videoPreviewUrl.value;
  }
  void handleSeek(playheadTime.value);
  void ensurePreviewController().prefetchReversedClips(clips.value);
});

async function onEditSessionExpiredExternally(): Promise<void> {
  if (!videoFile.value && clips.value.length === 0) return;
  resetPreviewController();
  clipSelectMode.value = false;
  await reset();
  error.value =
    'Edit session expired after 24 hours and was cleared. Photos are unaffected.';
}

const speedOptions = [0.25, 0.5, 1, 1.5, 2, 4];
const currentSpeedValue = computed(() => selectedClips.value[0]?.speed ?? 1);

async function onSpeedSelect(event: Event): Promise<void> {
  previewController?.pause();
  isPlaying.value = false;
  const value = Number((event.target as HTMLSelectElement).value);
  await setSpeedForSelected(value);
}

async function handleAutoBuild(): Promise<void> {
  previewController?.pause();
  isPlaying.value = false;
  await runAutoBuild();
  void ensurePreviewController().prefetchReversedClips(clips.value);
}

async function handleExport(): Promise<void> {
  previewController?.pause();
  isPlaying.value = false;
  await exportEditedVideo();
}

// --- Crop tool integration (reuses CropModal / vue-advanced-cropper) ---
const showCropTool = ref(false);
const cropSourceUrl = ref<string | null>(null);
let cropSourceUrlObj: string | null = null;

async function openCropTool(): Promise<void> {
  if (selectedClipIds.value.size !== 1 || !videoPreviewUrl.value) return;
  const clip = selectedClips.value[0];
  if (!clip) return;
  const sourceTime = clip.freeze ? clip.freeze.sourceTime : localTimeToSourceTime(clip, 0);
  try {
    const url = await captureVideoFrameAsUrl(videoPreviewUrl.value, sourceTime);
    if (cropSourceUrlObj) URL.revokeObjectURL(cropSourceUrlObj);
    cropSourceUrlObj = url;
    cropSourceUrl.value = url;
    showCropTool.value = true;
  } catch {
    error.value = 'Failed to capture a frame from this clip for cropping.';
  }
}

function closeCropTool(): void {
  showCropTool.value = false;
}

async function handleCropped(_blob: Blob, crop: CropBox, rotation: number): Promise<void> {
  showCropTool.value = false;
  if (rotation) {
    error.value = 'Rotation isn\u2019t supported for clip cropping yet \u2014 reset rotation to 0 and crop again.';
    return;
  }
  previewController?.pause();
  isPlaying.value = false;
  await applyCropToSelected(crop);
}

// --- Live crop preview approximation for non-reversed clips (CSS transform) ---
// When the active clip has no crop, the wrap's aspect-ratio must still match the
// SOURCE video's natural dimensions (not an arbitrary fallback) or the video would
// be clipped/distorted by the wrap's overflow:hidden for any non-16:9 video.
// Live crop preview: size the frame to the source (or crop) aspect, then
// contain it in both width and height so portrait clips don't overflow.
const cropPreviewStyle = computed(() => {
  const clip = activePreviewClip.value;
  const video = previewVideoRef.value;
  const naturalWidth = video?.videoWidth || videoInfo.value?.width || 0;
  const naturalHeight = video?.videoHeight || videoInfo.value?.height || 0;
  const crop = clip?.crop;
  const hasCrop = !!(crop && crop.width > 0 && crop.height > 0);
  const arW = hasCrop ? crop!.width : naturalWidth || 16;
  const arH = hasCrop ? crop!.height : naturalHeight || 9;

  const style: Record<string, string> = {
    '--crop-aspect': `${arW} / ${arH}`,
    '--ar-w': String(arW),
    '--ar-h': String(arH),
  };

  if (hasCrop && naturalWidth > 0 && naturalHeight > 0) {
    style['--crop-scale-x'] = `${(naturalWidth / crop!.width) * 100}%`;
    style['--crop-scale-y'] = `${(naturalHeight / crop!.height) * 100}%`;
    style['--crop-offset-x'] = `${(-crop!.x / crop!.width) * 100}%`;
    style['--crop-offset-y'] = `${(-crop!.y / crop!.height) * 100}%`;
  }

  return style;
});

const isCroppedPreview = computed(() => {
  const clip = activePreviewClip.value;
  return !!(clip?.crop && clip.crop.width > 0 && clip.crop.height > 0);
});

const activePreviewClip = computed(() => {
  const pos = findClipAtTime(flattenClipsForRender(clips.value), playheadTime.value);
  return pos?.clip ?? null;
});

function clearVideoPage(): void {
  resetPreviewController();
  clipSelectMode.value = false;
  if (cropSourceUrlObj) {
    URL.revokeObjectURL(cropSourceUrlObj);
    cropSourceUrlObj = null;
    cropSourceUrl.value = null;
  }
  void reset();
}

function formatTime(seconds: number): string {
  const s = Math.max(0, seconds);
  const fpsInt = Math.max(1, Math.round(previewFps.value));
  const totalFrames = Math.round(s * previewFps.value);
  const m = Math.floor(totalFrames / (fpsInt * 60));
  const afterMin = totalFrames - m * fpsInt * 60;
  const sec = Math.floor(afterMin / fpsInt);
  const frame = afterMin - sec * fpsInt;
  return `${m}:${String(sec).padStart(2, '0')}:${String(Math.max(0, frame)).padStart(2, '0')}`;
}

const previewFps = computed(() => {
  const fps = videoInfo.value?.frameRate;
  if (typeof fps === 'number' && Number.isFinite(fps) && fps >= 1 && fps <= 240) {
    return fps;
  }
  return 30;
});

function nudgePlayhead(frameDelta: number, secondsOverride?: number): void {
  if (clips.value.length === 0 || isExporting.value) return;
  isPlaying.value = false;
  previewController?.pause();
  const delta = secondsOverride ?? frameDelta / previewFps.value;
  const next = Math.max(0, Math.min(totalDuration.value, playheadTime.value + delta));
  void handleSeek(next);
}

onUnmounted(() => {
  window.removeEventListener('keydown', onKeyDown);
  window.removeEventListener('justcropit:video-edit-session-expired', onEditSessionExpiredExternally);
  previewController?.dispose();
  if (cropSourceUrlObj) URL.revokeObjectURL(cropSourceUrlObj);
});
</script>

<style scoped>
.video-editor {
  width: 100%;
  max-width: 1100px;
  margin: 0 auto;
  padding: 0 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.edit-dropzone {
  position: relative;
  min-height: 200px;
  border: 2px dashed rgba(255, 255, 255, 0.2);
  border-radius: 16px;
  transition: border-color 0.2s ease, background 0.2s ease;
}

.edit-dropzone:not(.has-video):hover {
  border-color: rgba(212, 175, 55, 0.4);
  background: rgba(212, 175, 55, 0.05);
}

.edit-dropzone.drag-over {
  border-color: rgba(212, 175, 55, 0.6);
  background: rgba(212, 175, 55, 0.1);
}

.edit-dropzone.has-video {
  border-style: solid;
  border-color: rgba(255, 255, 255, 0.1);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.edit-dropzone-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: 200px;
  padding: 32px;
  cursor: pointer;
  text-align: center;
}

.edit-dropzone-content i {
  font-size: 44px;
  color: rgba(212, 175, 55, 0.6);
}

.edit-dropzone-content h3 {
  margin: 0;
  color: rgba(255, 255, 255, 0.9);
}

.edit-dropzone-content p {
  margin: 0;
  color: rgba(255, 255, 255, 0.5);
  font-size: 0.9rem;
}

.edit-file-input {
  display: none;
}

.edit-preview {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  gap: 8px;
}

.edit-preview-video-wrap {
  position: relative;
  overflow: hidden;
  border-radius: 12px;
  background: #000;
  /* Contain in both axes: width is the smaller of 100%, 480px, and the
     width that would make height equal the max preview height. */
  width: min(
    100%,
    480px,
    calc(min(55vh, 720px) * var(--ar-w, 16) / var(--ar-h, 9))
  );
  aspect-ratio: var(--crop-aspect, 16 / 9);
  max-height: min(55vh, 720px);
  isolation: isolate;
  transform: translateZ(0);
}

.edit-preview-video,
.edit-preview-layer {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  object-position: center;
  max-width: none;
  background: #000;
}

.edit-preview-video-wrap--cropped .edit-preview-video,
.edit-preview-video-wrap--cropped img.edit-preview-layer {
  inset: auto;
  top: var(--crop-offset-y, 0);
  left: var(--crop-offset-x, 0);
  width: var(--crop-scale-x, 100%);
  height: var(--crop-scale-y, 100%);
  object-fit: fill;
}

.edit-preview-video--hidden {
  visibility: hidden;
}

.edit-preview-buffering {
  font-size: 0.85rem;
  color: rgba(255, 215, 0, 0.85);
}

.edit-transport {
  display: flex;
  align-items: center;
  gap: 12px;
}

.edit-transport-spacer {
  flex: 1;
}

.edit-icon-btn {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.2);
  background: rgba(255, 255, 255, 0.06);
  color: #fff;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.edit-icon-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.edit-time {
  font-family: monospace;
  color: rgba(255, 255, 255, 0.75);
  font-size: 0.9rem;
}

.edit-frame-hint {
  font-size: 0.7rem;
  color: rgba(255, 255, 255, 0.35);
  white-space: nowrap;
}

@media (max-width: 599px) {
  .edit-frame-hint {
    display: none;
  }
}

.edit-text-btn {
  background: none;
  border: none;
  color: rgba(255, 255, 255, 0.5);
  cursor: pointer;
  font-size: 0.85rem;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.edit-text-btn:hover {
  color: rgba(255, 255, 255, 0.85);
}

.edit-toolbar {
  display: flex;
  align-items: stretch;
  gap: 10px;
  flex-wrap: wrap;
  padding: 10px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.04);
}

.edit-toolbar-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.edit-toolbar-group + .edit-toolbar-group {
  padding-left: 10px;
  border-left: 1px solid rgba(255, 255, 255, 0.1);
}

.edit-toolbar-group--history {
  margin-left: auto;
}

.edit-tool-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.85);
  font-size: 0.82rem;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
}

.edit-tool-btn:hover:not(:disabled) {
  background: rgba(212, 175, 55, 0.15);
  border-color: rgba(212, 175, 55, 0.4);
}

.edit-tool-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.edit-tool-btn--accent {
  border-color: rgba(212, 175, 55, 0.5);
  color: #ffd700;
}

.edit-tool-btn--primary {
  background: rgba(212, 175, 55, 0.85);
  border-color: rgba(212, 175, 55, 0.85);
  color: #1a1a1a;
  font-weight: 600;
}

.edit-tool-btn--primary:hover:not(:disabled) {
  background: rgba(212, 175, 55, 1);
}

.edit-speed-control {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.85);
}

.edit-speed-control--disabled {
  opacity: 0.35;
}

.edit-speed-control select {
  background: transparent;
  color: inherit;
  border: none;
  font-size: 0.82rem;
}

.edit-export-progress {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 160px;
  font-size: 0.8rem;
  color: rgba(255, 255, 255, 0.7);
}

.edit-export-progress-bar {
  height: 6px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.1);
  overflow: hidden;
}

.edit-export-progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #d4af37, #ffd700);
  transition: width 0.2s ease;
}

.edit-error {
  color: #ff6b6b;
  font-size: 0.85rem;
  margin: 0;
}

@media (max-width: 1023px) {
  .video-editor {
    padding: 0 8px;
    max-width: none;
  }

  .edit-dropzone.has-video {
    padding: 12px;
    gap: 12px;
  }
}

@media (max-width: 599px) {
  .edit-toolbar {
    flex-direction: column;
    gap: 8px;
    padding: 8px;
  }

  .edit-toolbar-group {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 6px;
    width: 100%;
    padding-left: 0;
    border-left: none;
  }

  .edit-toolbar-group + .edit-toolbar-group {
    padding-left: 0;
    border-left: none;
  }

  .edit-toolbar-group--actions {
    grid-template-columns: minmax(0, 1fr) minmax(0, 2fr);
  }

  .edit-toolbar-group--history {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    margin-left: 0;
  }

  .edit-toolbar .edit-tool-btn,
  .edit-toolbar .edit-speed-control {
    width: 100%;
    min-height: 52px;
    flex-direction: column;
    gap: 4px;
    padding: 8px 4px;
    font-size: 0.72rem;
    box-sizing: border-box;
  }

  .edit-speed-control {
    justify-content: center;
  }

  .edit-speed-control select {
    text-align: center;
    font-size: 0.72rem;
  }

  .edit-transport {
    gap: 8px;
  }

  .edit-time {
    font-size: 0.8rem;
  }

  .edit-export-progress {
    min-width: 0;
    max-width: 110px;
    font-size: 0.7rem;
  }
}
</style>
