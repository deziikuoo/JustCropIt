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
          <p>Split, trim, speed, crop, reverse, freeze, and auto-build boomerang loops</p>
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
            :style="cropPreviewStyle"
          >
            <video
              ref="previewVideoRef"
              class="edit-preview-video"
              :class="{ 'edit-preview-video--hidden': !!freezeFrameUrl }"
              playsinline
              @loadedmetadata="syncVideoMetadata"
            ></video>
            <img
              v-if="freezeFrameUrl"
              :src="freezeFrameUrl"
              alt="Frozen frame"
              class="edit-preview-freeze"
            />
          </div>
          <div v-if="isBuffering" class="edit-preview-buffering">
            <i class="fas fa-spinner fa-spin"></i> Rendering reversed clip...
          </div>
        </div>

        <div class="edit-transport">
          <button type="button" class="edit-icon-btn" @click="togglePlay" :disabled="clips.length === 0 || isExporting">
            <i :class="isPlaying ? 'fas fa-pause' : 'fas fa-play'"></i>
          </button>
          <span class="edit-time">{{ formatTime(playheadTime) }} / {{ formatTime(totalDuration) }}</span>
          <div class="edit-transport-spacer"></div>
          <button type="button" class="edit-text-btn" @click="clearVideoPage">
            <i class="fas fa-xmark"></i> Clear video
          </button>
        </div>

        <div class="edit-toolbar">
          <button type="button" class="edit-tool-btn" :disabled="clips.length === 0 || isExporting" @click="handleSplit">
            <i class="fas fa-scissors"></i><span>Split</span>
          </button>
          <button type="button" class="edit-tool-btn" :disabled="!hasSelection || isExporting" @click="handleDelete">
            <i class="fas fa-trash"></i><span>Delete</span>
          </button>
          <button type="button" class="edit-tool-btn" :disabled="!hasSelection || isExporting" @click="handleDuplicate">
            <i class="fas fa-clone"></i><span>Duplicate</span>
          </button>
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

          <div class="edit-toolbar-spacer"></div>

          <button type="button" class="edit-tool-btn" :disabled="!canUndo || isExporting" @click="handleUndo" title="Undo (Ctrl+Z)">
            <i class="fas fa-rotate-left"></i><span>Undo</span>
          </button>
          <button type="button" class="edit-tool-btn" :disabled="!canRedo || isExporting" @click="handleRedo" title="Redo (Ctrl+Y)">
            <i class="fas fa-rotate-right"></i><span>Redo</span>
          </button>

          <button
            type="button"
            class="edit-tool-btn edit-tool-btn--primary"
            :disabled="clips.length === 0 || isExporting || isBuffering"
            @click="handleExport"
          >
            <i class="fas fa-download"></i><span>{{ isExporting ? 'Exporting...' : 'Export' }}</span>
          </button>
        </div>

        <div v-if="isExporting && exportProgress" class="edit-export-progress">
          <div class="edit-export-progress-bar">
            <div class="edit-export-progress-fill" :style="{ width: exportProgress.percent + '%' }"></div>
          </div>
          <span>{{ exportProgress.message || 'Exporting...' }}</span>
        </div>

        <p v-if="error" class="edit-error">{{ error }}</p>

        <VideoEditTimeline
          :clips="clips"
          :selected-clip-ids="selectedClipIds"
          :playhead-time="playheadTime"
          :total-duration="totalDuration"
          :video-url="videoPreviewUrl"
          :video-file="videoFile"
          @select-clip="onSelectClip"
          @select-range="onSelectRange"
          @seek="handleSeek"
        />
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
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useVideoTimelineEditor } from '../composables/useVideoTimelineEditor';
import VideoEditTimeline from './VideoEditTimeline.vue';
import CropModal from './CropModal.vue';
import {
  createTimelinePreviewController,
  type TimelinePreviewController,
} from '../utils/videoEdit/timelinePreviewController';
import { captureVideoFrameAsUrl } from '../utils/videoEdit/captureFrame';
import { localTimeToSourceTime } from '../utils/videoEdit/clipMath';
import type { CropBox } from '../types/videoEdit';

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
  canUndo,
  canRedo,
  isExporting,
  exportProgress,
  toggleClipSelection,
  selectRangeTo,
  loadVideo,
  applyVideoMetadataFallback,
  reset,
  undo,
  redo,
  splitAtPlayhead,
  deleteSelected,
  duplicateSelected,
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
const freezeFrameUrl = ref<string | null>(null);
const isBuffering = ref(false);
const isPlaying = ref(false);

let previewController: TimelinePreviewController | null = null;

function ensurePreviewController(): TimelinePreviewController {
  if (!previewController) {
    previewController = createTimelinePreviewController(
      previewVideoRef,
      videoFile,
      videoPreviewUrl,
      () => clips.value,
      {
        onTimeUpdate: (t) => {
          playheadTime.value = t;
        },
        onFreezeFrame: (url) => {
          freezeFrameUrl.value = url;
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

async function handleSeek(time: number): Promise<void> {
  if (isExporting.value) return;
  const controller = ensurePreviewController();
  await controller.seekTo(time);
}

function onSelectClip(id: string, additive: boolean): void {
  toggleClipSelection(id, additive);
}

function onSelectRange(id: string): void {
  selectRangeTo(id);
}

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

async function handleReverse(): Promise<void> {
  previewController?.pause();
  isPlaying.value = false;
  await reverseSelected();
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
  const isModifierPressed = event.ctrlKey || event.metaKey;
  if (!isModifierPressed) return;
  const key = event.key.toLowerCase();

  if (key === 'z' && !event.shiftKey) {
    event.preventDefault();
    void handleUndo();
  } else if (key === 'y' || (key === 'z' && event.shiftKey)) {
    event.preventDefault();
    void handleRedo();
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeyDown);
});

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
}

async function handleExport(): Promise<void> {
  // Avoid overlapping the export's FFmpeg work with a preview's reversed-clip
  // render on the same shared worker.
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
const cropPreviewStyle = computed(() => {
  const clip = clips.value[activeClipIndexForCrop.value];
  const video = previewVideoRef.value;
  const naturalWidth = video?.videoWidth || videoInfo.value?.width || 0;
  const naturalHeight = video?.videoHeight || videoInfo.value?.height || 0;

  if (clip?.crop && clip.crop.width > 0 && clip.crop.height > 0) {
    const { x, y, width, height } = clip.crop;
    const style: Record<string, string> = { '--crop-aspect': `${width} / ${height}` };
    if (naturalWidth > 0) {
      style['--crop-scale-x'] = `${(naturalWidth / width) * 100}%`;
      style['--crop-offset-x'] = `${(-x / width) * 100}%`;
      style['--crop-offset-y'] = `${(-y / height) * 100}%`;
    }
    return style;
  }

  if (naturalWidth > 0 && naturalHeight > 0) {
    return { '--crop-aspect': `${naturalWidth} / ${naturalHeight}` } as Record<string, string>;
  }
  return {};
});

const activeClipIndexForCrop = computed(() => {
  let cursor = 0;
  for (let i = 0; i < clips.value.length; i++) {
    const dur =
      clips.value[i].freeze?.durationSeconds ??
      (clips.value[i].sourceEnd - clips.value[i].sourceStart) / (clips.value[i].speed || 1);
    if (playheadTime.value < cursor + dur || i === clips.value.length - 1) return i;
    cursor += dur;
  }
  return 0;
});

function clearVideoPage(): void {
  resetPreviewController();
  if (cropSourceUrlObj) {
    URL.revokeObjectURL(cropSourceUrlObj);
    cropSourceUrlObj = null;
    cropSourceUrl.value = null;
  }
  reset();
}

function formatTime(seconds: number): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const rem = Math.floor(s % 60);
  return `${m}:${String(rem).padStart(2, '0')}`;
}

onUnmounted(() => {
  window.removeEventListener('keydown', onKeyDown);
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
  gap: 8px;
}

.edit-preview-video-wrap {
  position: relative;
  width: 100%;
  max-width: 480px;
  max-height: 55vh;
  aspect-ratio: var(--crop-aspect, 16 / 9);
  overflow: hidden;
  border-radius: 12px;
  background: #000;
}

.edit-preview-video {
  position: absolute;
  top: var(--crop-offset-y, 0);
  left: var(--crop-offset-x, 0);
  width: var(--crop-scale-x, 100%);
  height: auto;
  max-width: none;
}

.edit-preview-video--hidden {
  visibility: hidden;
}

.edit-preview-freeze {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  background: #000;
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
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 10px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.04);
}

.edit-toolbar-spacer {
  flex: 1;
  min-width: 8px;
}

.edit-tool-btn {
  display: inline-flex;
  align-items: center;
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
</style>
