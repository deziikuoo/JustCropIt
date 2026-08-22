<template>
  <div class="video-extractor">
    <!-- Unsupported Browser Warning -->
    <div v-if="!isSupported" class="unsupported-warning">
      <i class="fas fa-exclamation-triangle"></i>
      <h3>Browser Not Supported</h3>
      <p>
        Video frame extraction requires WebCodecs (hardware decode) and Web Workers.
        Please use a modern browser like Chrome, Edge, or Firefox.
      </p>
    </div>

    <template v-else>
      <header class="video-extractor-header">
        <p class="video-extractor-subtitle">Extract high-quality frames from video</p>
      </header>

      <!-- Video Input Area -->
      <div 
        class="video-dropzone"
        :class="{ 
          'has-video': videoFile,
          'drag-over': isDragOver,
          'extracting': isExtracting
        }"
        @dragover.prevent="isDragOver = true"
        @dragleave.prevent="isDragOver = false"
        @drop.prevent="handleDrop"
      >
        <template v-if="!videoFile">
          <div class="dropzone-content">
            <i class="fas fa-film"></i>
            <h3>Drop Video Here</h3>
            <p>or click to select a video file</p>
            <input
              ref="fileInputRef"
              type="file"
              accept="video/*"
              class="file-input"
              @change="handleFileSelect"
            />
          </div>
        </template>

        <template v-else>
          <!-- Video Preview -->
          <div class="video-preview-container">
            <video
              v-if="videoPreviewUrl"
              ref="videoRef"
              :src="videoPreviewUrl"
              class="video-preview"
              controls
              controlslist="nodownload noremoteplayback"
              playsinline
              preload="metadata"
              @loadedmetadata="syncVideoMetadata"
              @durationchange="syncVideoMetadata"
              @loadeddata="syncVideoMetadata"
              @timeupdate="onVideoTimeUpdate"
              @play="onVideoPlay"
            ></video>
            
            <div class="video-info-overlay">
              <div class="video-name">{{ videoFile.name }}</div>
              <div class="video-meta" v-if="displayVideoInfo">
                <span class="meta-item">
                  <i class="fas fa-clock"></i>
                  {{ formatDuration(displayVideoInfo.duration) }}
                </span>
                <span class="meta-item" v-if="displayVideoInfo.width && displayVideoInfo.height">
                  <i class="fas fa-expand"></i>
                  {{ displayVideoInfo.width }}x{{ displayVideoInfo.height }}
                </span>
              </div>
              <div class="video-meta loading-meta" v-else-if="videoFile && !displayVideoInfo">
                <span class="meta-item">
                  <i class="fas fa-spinner fa-spin"></i>
                  Reading video info...
                </span>
              </div>
            </div>

            <button 
              class="clear-video-btn"
              @click.stop="clearVideoPage"
              :disabled="isExtracting || isExportingTrim || isDownloading || isAddingToPhotos"
              title="Clear the entire video page"
            >
              <i class="fas fa-times"></i>
            </button>
          </div>

          <!-- Trim + live preview (seek-on-drag, keeps preload=metadata) -->
          <div class="trim-section" v-if="displayVideoInfo">
            <VideoTrimmer
              :duration="displayVideoInfo.duration"
              v-model:trim-start="trimStart"
              v-model:trim-end="trimEnd"
              :disabled="isExtracting || isExportingTrim"
              :is-previewing-clip="isPreviewingClip"
              :is-exporting-trim="isExportingTrim"
              :format-time="formatTimestamp"
              @preview-at="seekVideoPreview"
              @toggle-preview-clip="toggleClipPreview"
              @download-trim="handleDownloadTrim"
            />
            <div class="trim-export-progress" v-if="trimExportProgress && isExportingTrim">
              <div class="progress-bar-container compact">
                <div
                  class="progress-bar-fill"
                  :style="{ width: `${trimExportProgress.percent}%` }"
                ></div>
              </div>
              <span class="trim-export-message">{{ trimExportProgress.message }}</span>
            </div>
          </div>
        </template>
      </div>

      <!-- Extraction Options -->
      <div class="extraction-options" v-if="videoFile">
        <h3>Extraction Settings</h3>

        <!-- Interval Selector -->
        <div class="option-group">
          <label class="option-label">
            <i class="fas fa-stopwatch"></i>
            Frame Interval
          </label>
          <div class="interval-controls">
            <div class="interval-presets">
              <button
                v-for="preset in intervalPresets"
                :key="preset.value"
                class="preset-btn"
                :class="{ active: intervalMs === preset.value }"
                @click="intervalMs = preset.value"
                :disabled="isExtracting"
              >
                {{ preset.label }}
              </button>
            </div>
            <div class="interval-slider-row">
              <input
                type="range"
                :min="50"
                :max="3000"
                :step="50"
                v-model.number="intervalMs"
                class="interval-slider"
                :disabled="isExtracting"
              />
              <span class="interval-value">{{ (intervalMs / 1000).toFixed(2) }}s</span>
            </div>
          </div>
        </div>

        <!-- Quality Selector -->
        <div class="option-group">
          <label class="option-label">
            <i class="fas fa-image"></i>
            Output Quality
          </label>
          <div class="quality-options">
            <div class="quality-option-row">
              <button
                class="quality-btn"
                :class="{ active: outputFormat === 'jpeg' }"
                @click="outputFormat = 'jpeg'"
                :disabled="isExtracting"
              >
                <i class="fas fa-bolt"></i>
                High Quality (JPEG)
              </button>
              <span
                class="quality-help"
                tabindex="0"
                role="button"
                aria-label="JPEG format details"
              >
                <i class="fas fa-circle-question" aria-hidden="true"></i>
                <span class="quality-help-tooltip">
                  Smaller and faster — safer for long clips and large imports.
                  Recommended default. Slight compression is fine for cropping.
                </span>
              </span>
            </div>
            <div class="quality-option-row">
              <button
                class="quality-btn"
                :class="{ active: outputFormat === 'png' }"
                @click="outputFormat = 'png'"
                :disabled="isExtracting"
              >
                <i class="fas fa-gem"></i>
                Maximum quality (PNG)
              </button>
              <span
                class="quality-help"
                tabindex="0"
                role="button"
                aria-label="PNG format details"
              >
                <i class="fas fa-circle-question" aria-hidden="true"></i>
                <span class="quality-help-tooltip">
                  Lossless quality, but files are huge and slow to import.
                  Higher risk of hitting browser storage limits on long clips.
                </span>
              </span>
            </div>
          </div>
        </div>

        <!-- Estimated Frames -->
        <div class="estimated-frames">
          <template v-if="displayVideoInfo && clipDuration > 0">
            <span class="estimated-frames-left">
              <i class="fas fa-clock"></i>
              {{ formatTimestamp(trimStart) }}–{{ formatTimestamp(trimEnd) }}
            </span>
            <span class="estimated-frames-right">
              <i class="fas fa-layer-group"></i>
              <strong>{{ estimatedFrameCount }}</strong> frames
            </span>
          </template>
          <span v-else-if="displayVideoInfo" class="estimated-frames-message">
            Adjust clip range to extract frames
          </span>
          <span v-else class="estimated-frames-message">
            Loading video info to estimate frame count...
          </span>
        </div>
      </div>

      <!-- Progress Section -->
      <div class="progress-section" v-if="progress && isExtracting">
        <div class="progress-header">
          <span class="progress-phase">{{ getPhaseLabel(progress.phase) }}</span>
          <div class="progress-header-right">
            <span class="progress-eta">
              <i class="fas fa-hourglass-half"></i>
              {{ extractionEtaLabel }}
            </span>
            <span class="progress-percent">{{ progress.percent }}%</span>
          </div>
        </div>
        <div class="progress-bar-container">
          <div 
            class="progress-bar-fill" 
            :style="{ width: `${progress.percent}%` }"
          ></div>
        </div>
        <div class="progress-details" v-if="progress.message">
          {{ progress.message }}
        </div>
      </div>

      <!-- Error Display -->
      <div class="error-message" v-if="error">
        <i class="fas fa-exclamation-circle"></i>
        {{ error }}
      </div>

      <!-- Action Buttons -->
      <div class="action-buttons" v-if="videoFile">
        <button
          v-if="!isExtracting"
          class="extract-btn"
          @click="handleExtract"
          :disabled="!canGenerate || isExportingTrim"
        >
          <i class="fas fa-wand-magic-sparkles"></i>
          Generate Frames
        </button>
        <button
          v-else
          class="cancel-btn"
          @click="cancelExtraction"
        >
          <i class="fas fa-stop"></i>
          Cancel
        </button>
      </div>

      <!-- Extracted Frames Preview -->
      <div class="extracted-preview" v-if="extractedFrames.length > 0 && !isExtracting">
        <div class="extracted-header">
          <h3>
            <i class="fas fa-check-circle"></i>
            Extracted
            <span v-if="isSelectMode && displaySelectedCount > 0" class="selection-count">
              · {{ displaySelectedCount }} selected
            </span>
          </h3>
        </div>

        <div class="download-progress" v-if="isDownloading && downloadProgress">
          <div class="download-progress-row">
            <div class="progress-bar-container compact">
              <div
                class="progress-bar-fill"
                :style="{ width: `${downloadProgress.percent}%` }"
              ></div>
            </div>
            <button
              type="button"
              class="cancel-download-btn"
              title="Cancel download"
              @click="cancelDownload"
            >
              <i class="fas fa-stop"></i>
              Cancel
            </button>
          </div>
          <span class="download-progress-message">{{ downloadProgress.message }}</span>
        </div>

        <div class="extracted-body">
          <div
            ref="framesGridRef"
            class="frames-preview-grid frames-preview-grid--expanded"
            :class="{
              'frames-preview-grid--selecting': isSelectMode,
              'frames-preview-grid--drag-selecting': isDragSelecting,
            }"
          >
            <button
              v-for="(frame, arrayIdx) in extractedFrames"
              :key="frame.index"
              type="button"
              class="preview-frame"
              :data-frame-array-index="arrayIdx"
              :data-frame-file-index="frame.index"
              :ref="(el) => bindFramePreviewObserver(el, frame.index)"
              :class="{
                'preview-frame--selected': selectedFrameIndices.has(frame.index),
                'preview-frame--dragging-over': draggedOverArrayIndices.has(arrayIdx),
              }"
              :tabindex="isDragSelecting ? -1 : 0"
              :aria-label="isSelectMode
                ? `${selectedFrameIndices.has(frame.index) ? 'Deselect' : 'Select'} frame at ${formatTimestamp(frame.timestamp)}`
                : `Preview frame at ${formatTimestamp(frame.timestamp)}`"
              :aria-pressed="isSelectMode ? selectedFrameIndices.has(frame.index) : undefined"
              @click="handleFrameClick(frame.index, arrayIdx, $event)"
              @mousedown="handleFrameMouseDown(arrayIdx, $event)"
              @touchstart.passive="handleFrameTouchStart(arrayIdx, $event)"
            >
              <img
                :src="framePreviewUrls.get(frame.index)"
                :alt="`Frame ${frame.index + 1}`"
                loading="lazy"
                decoding="async"
                draggable="false"
              />
              <span
                v-if="isSelectMode"
                class="frame-check"
                :class="{ 'frame-check--on': selectedFrameIndices.has(frame.index) }"
                aria-hidden="true"
              >
                <i class="fas fa-check"></i>
              </span>
              <span class="frame-time">{{ formatTimestamp(frame.timestamp) }}</span>
            </button>
          </div>

          <div class="extracted-side-actions">
            <template v-if="!isSelectMode">
              <button
                class="frame-action-btn"
                type="button"
                :disabled="isDownloading || isAddingToPhotos"
                title="Select frames to download or delete"
                @click="enterSelectMode"
              >
                <i class="fas fa-check-double"></i>
                Select
              </button>
              <button
                class="frame-action-btn"
                type="button"
                :disabled="isDownloading || isAddingToPhotos || isAutoSelectingFrames || extractedFrames.length === 0"
                title="Enter select mode with the first 100 frames selected"
                @click="selectFirstFrames(100)"
              >
                <i class="fas fa-list-ol"></i>
                First 100
              </button>
              <button
                class="frame-action-btn"
                type="button"
                :disabled="isDownloading || isAddingToPhotos || isAutoSelectingFrames || extractedFrames.length === 0"
                title="Enter select mode with the first 300 frames selected"
                @click="selectFirstFrames(300)"
              >
                <i class="fas fa-list-ol"></i>
                First 300
              </button>
              <button
                class="frame-action-btn"
                type="button"
                :disabled="isDownloading || isAddingToPhotos || isAutoSelectingFrames || extractedFrames.length === 0"
                title="Enter select mode with the first 500 frames selected"
                @click="selectFirstFrames(500)"
              >
                <i class="fas fa-list-ol"></i>
                First 500
              </button>
              <button
                class="add-to-grid-btn"
                type="button"
                :disabled="isDownloading || isAddingToPhotos"
                @click="handleAddToGrid"
              >
                <i :class="isAddingToPhotos ? 'fas fa-spinner fa-spin' : 'fas fa-plus'"></i>
                {{ isAddingToPhotos ? 'Adding to Images…' : 'Add to Images' }}
              </button>
              <button
                class="frame-action-btn"
                type="button"
                :disabled="isDownloading || isAddingToPhotos"
                title="Download all extracted frames as a ZIP"
                @click="handleDownloadAll"
              >
                <i :class="isDownloading ? 'fas fa-spinner fa-spin' : 'fas fa-download'"></i>
                Download All
              </button>
              <button
                class="frame-action-btn frame-action-btn--danger"
                type="button"
                :disabled="isDownloading || isAddingToPhotos"
                title="Delete all extracted frames (keeps the video)"
                @click="handleDeleteAllFrames"
              >
                <i class="fas fa-trash"></i>
                Delete All
              </button>
            </template>
            <template v-else>
              <button
                class="frame-action-btn"
                type="button"
                :disabled="isDownloading || isAddingToPhotos || selectedCount === extractedFrames.length"
                @click="selectAllFrames"
              >
                <i class="fas fa-check-square"></i>
                Select All
              </button>
              <button
                class="frame-action-btn"
                type="button"
                :disabled="isDownloading || isAddingToPhotos || selectedCount === 0"
                title="Deselect all frames"
                @click="clearFrameSelection"
              >
                <i class="fas fa-square"></i>
                Deselect
              </button>
              <button
                class="add-to-grid-btn"
                type="button"
                :disabled="isDownloading || isAddingToPhotos || selectedCount === 0"
                :title="selectedCount === 0 ? 'Select frames first' : `Add ${selectedCount} frame(s) to Images`"
                @click="handleAddSelectedToGrid"
              >
                <i :class="isAddingToPhotos ? 'fas fa-spinner fa-spin' : 'fas fa-plus'"></i>
                {{
                  isAddingToPhotos
                    ? 'Adding to Images…'
                    : selectedCount > 0
                      ? `Add to Images (${selectedCount})`
                      : 'Add to Images'
                }}
              </button>
              <button
                class="frame-action-btn frame-action-btn--primary"
                type="button"
                :disabled="isDownloading || isAddingToPhotos || selectedCount === 0"
                :title="selectedCount === 0 ? 'Select frames first' : `Download ${selectedCount} frame(s)`"
                @click="handleDownloadSelected"
              >
                <i :class="isDownloading ? 'fas fa-spinner fa-spin' : 'fas fa-download'"></i>
                Download{{ selectedCount > 0 ? ` (${selectedCount})` : '' }}
              </button>
              <button
                class="frame-action-btn frame-action-btn--danger"
                type="button"
                :disabled="isDownloading || isAddingToPhotos || selectedCount === 0"
                :title="selectedCount === 0 ? 'Select frames first' : `Delete ${selectedCount} frame(s)`"
                @click="handleDeleteSelectedFrames"
              >
                <i class="fas fa-trash"></i>
                Delete{{ selectedCount > 0 ? ` (${selectedCount})` : '' }}
              </button>
              <button
                class="frame-action-btn"
                type="button"
                :disabled="isDownloading || isAddingToPhotos"
                @click="exitSelectMode"
              >
                <i class="fas fa-times"></i>
                Done
              </button>
            </template>
          </div>
        </div>
      </div>

      <ConfirmDialog
        :show="confirmState.show"
        :title="confirmState.title"
        :message="confirmState.message"
        :confirm-label="confirmState.confirmLabel"
        :cancel-label="confirmState.cancelLabel"
        :variant="confirmState.variant"
        @confirm="resolveConfirm(true)"
        @cancel="resolveConfirm(false)"
      />

      <ExtractedFramePreviewModal
        :show="previewFrameIndex !== null"
        :frames="extractedFrames"
        :current-index="previewFrameIndex ?? 0"
        :get-frame-url="getFramePreviewUrl"
        :format-timestamp="formatTimestamp"
        @close="closeFramePreview"
        @navigate="previewFrameIndex = $event"
        @delete="handleDeletePreviewFrame"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';
import { useVideoExtraction, type ExtractedFrameFile } from '../composables/useVideoExtraction';
import ConfirmDialog from './ConfirmDialog.vue';
import ExtractedFramePreviewModal from './ExtractedFramePreviewModal.vue';
import VideoTrimmer from './VideoTrimmer.vue';
import { createStreamingZip } from '../utils/export/streamingZip';
import {
  createDownloadStamp,
  stampDownloadFileName,
  stampDownloadZipName,
} from '../utils/downloadFileNames';

const props = defineProps<{
  addToPhotos: (files: File[]) => Promise<void>;
}>();

const {
  videoFile,
  videoInfo,
  videoPreviewUrl,
  trimStart,
  trimEnd,
  clipDuration,
  intervalMs,
  outputFormat,
  isExtracting,
  isExportingTrim,
  progress,
  trimExportProgress,
  extractedFrames,
  error,
  isSupported,
  estimatedFrameCount,
  loadVideo,
  applyVideoMetadata,
  startExtraction,
  cancelExtraction,
  downloadTrimmedVideo,
  reset,
  restoreSession,
  prepareForPhotoImport,
  finishPhotoImport,
  removeFramesByIndices,
  clearExtractedFrames,
  formatDuration,
  extractionEtaLabel,
} = useVideoExtraction();

const fileInputRef = ref<HTMLInputElement | null>(null);
const videoRef = ref<HTMLVideoElement | null>(null);
const isDragOver = ref(false);
const framePreviewUrls = ref<Map<number, string>>(new Map());
/** Pause new object-URL creation (e.g. during programmatic scroll). */
const framePreviewLoadsPaused = ref(false);
const isAutoSelectingFrames = ref(false);
let framePreviewObserver: IntersectionObserver | null = null;
const previewFrameIndex = ref<number | null>(null);
const isPreviewingClip = ref(false);

const isSelectMode = ref(false);
const selectedFrameIndices = ref<Set<number>>(new Set());
/** Array index of last non-shift click — used for Shift+click range select. */
const selectionAnchorArrayIdx = ref<number | null>(null);
const isDownloading = ref(false);
const downloadCancelled = ref(false);
const downloadProgress = ref<{ percent: number; message: string } | null>(null);
const isAddingToPhotos = ref(false);

type ConfirmVariant = 'danger' | 'default';

const confirmState = ref({
  show: false,
  title: '',
  message: '',
  confirmLabel: 'Confirm',
  cancelLabel: 'Cancel',
  variant: 'danger' as ConfirmVariant,
});

let confirmResolver: ((value: boolean) => void) | null = null;

function askConfirm(options: {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: ConfirmVariant;
}): Promise<boolean> {
  if (confirmResolver) {
    confirmResolver(false);
    confirmResolver = null;
  }

  confirmState.value = {
    show: true,
    title: options.title,
    message: options.message,
    confirmLabel: options.confirmLabel ?? 'Confirm',
    cancelLabel: options.cancelLabel ?? 'Cancel',
    variant: options.variant ?? 'danger',
  };

  return new Promise((resolve) => {
    confirmResolver = resolve;
  });
}

function resolveConfirm(confirmed: boolean) {
  confirmState.value = { ...confirmState.value, show: false };
  const resolve = confirmResolver;
  confirmResolver = null;
  resolve?.(confirmed);
}

// Drag-to-select (mirrors Images tab PhotoGrid behavior while in select mode)
const framesGridRef = ref<HTMLElement | null>(null);
const isDragSelecting = ref(false);
const isDeselecting = ref(false);
const dragStartArrayIndex = ref<number | null>(null);
const draggedOverArrayIndices = ref<Set<number>>(new Set());
const hasDragMoved = ref(false);
const dragStartedFromTouch = ref(false);
const dragIntent = ref<'undetermined' | 'scroll' | 'select'>('undetermined');
const touchStartPosition = ref<{ x: number; y: number } | null>(null);
const suppressNextFrameClick = ref(false);
const dragSelectionCount = ref<number | null>(null);
const autoScrollInterval = ref<number | null>(null);
const autoScrollDirection = ref<'up' | 'down' | null>(null);

const displayVideoInfo = computed(() => {
  if (videoInfo.value && videoInfo.value.duration > 0) {
    return videoInfo.value;
  }
  return null;
});

const canGenerate = computed(() => {
  return Boolean(displayVideoInfo.value && estimatedFrameCount.value > 0);
});

const intervalPresets = [
  { label: '0.05s', value: 50 },
  { label: '0.1s', value: 100 },
  { label: '0.5s', value: 500 },
  { label: '1s', value: 1000 },
  { label: '2s', value: 2000 },
  { label: '3s', value: 3000 }
];

const selectedCount = computed(() => selectedFrameIndices.value.size);

const displaySelectedCount = computed(() =>
  dragSelectionCount.value !== null ? dragSelectionCount.value : selectedCount.value
);

watch(extractedFrames, () => {
  // New extraction / restore — drop stale selection
  cleanupFrameDragSelection();
  selectedFrameIndices.value = new Set();
  selectionAnchorArrayIdx.value = null;
  if (extractedFrames.value.length === 0) {
    isSelectMode.value = false;
    teardownFramePreviewObserver();
  }
});

async function loadSelectedVideo(file: File) {
  await loadVideo(file);
  await nextTick();
  syncVideoMetadata();
}

function syncVideoMetadata() {
  const video = videoRef.value;
  if (!video) return;

  applyVideoMetadata({
    duration: video.duration,
    width: video.videoWidth,
    height: video.videoHeight,
  });

  // Some codecs report duration after loadedmetadata
  if (!Number.isFinite(video.duration) || video.duration <= 0) {
    scheduleMetadataRetry();
  }
}

let metadataRetryTimer: ReturnType<typeof setTimeout> | null = null;
let metadataRetryCount = 0;

function scheduleMetadataRetry() {
  if (metadataRetryTimer || metadataRetryCount >= 10) return;
  metadataRetryCount += 1;
  metadataRetryTimer = setTimeout(() => {
    metadataRetryTimer = null;
    syncVideoMetadata();
  }, 200);
}

watch(videoPreviewUrl, async (url) => {
  metadataRetryCount = 0;
  if (metadataRetryTimer) {
    clearTimeout(metadataRetryTimer);
    metadataRetryTimer = null;
  }
  if (!url) return;
  await nextTick();
  syncVideoMetadata();
});

function handleFileSelect(event: Event) {
  const input = event.target as HTMLInputElement;
  if (input.files && input.files.length > 0) {
    const file = input.files[0];
    if (file.type.startsWith('video/')) {
      loadSelectedVideo(file);
    }
  }
}

function handleDrop(event: DragEvent) {
  isDragOver.value = false;
  const files = event.dataTransfer?.files;
  if (files && files.length > 0) {
    const file = files[0];
    if (file.type.startsWith('video/')) {
      loadSelectedVideo(file);
    }
  }
}

function clearFramePreviewUrls() {
  for (const url of framePreviewUrls.value.values()) {
    URL.revokeObjectURL(url);
  }
  framePreviewUrls.value = new Map();
}

function createPreviewUrlForIndex(
  frameIndex: number,
  options?: { force?: boolean; frame?: ExtractedFrameFile }
): void {
  if (framePreviewUrls.value.has(frameIndex)) return;
  if (framePreviewLoadsPaused.value && !options?.force) return;

  const frame =
    options?.frame ??
    extractedFrames.value.find((entry) => entry.index === frameIndex);
  if (!frame) return;

  const url = URL.createObjectURL(frame.file);
  const next = new Map(framePreviewUrls.value);
  next.set(frameIndex, url);
  framePreviewUrls.value = next;
}

function ensureFramePreviewObserver(): void {
  if (framePreviewObserver || typeof IntersectionObserver === 'undefined') {
    return;
  }
  const root = framesGridRef.value;
  if (!root) return;

  framePreviewObserver = new IntersectionObserver(
    (entries) => {
      if (framePreviewLoadsPaused.value) return;
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const raw = (entry.target as HTMLElement).dataset.frameFileIndex;
        if (raw == null) continue;
        const frameIndex = Number(raw);
        if (!Number.isFinite(frameIndex)) continue;
        createPreviewUrlForIndex(frameIndex);
      }
    },
    {
      root,
      rootMargin: '120px 0px',
      threshold: 0.01,
    }
  );
}

function bindFramePreviewObserver(el: unknown, frameIndex: number): void {
  if (!el || !(el instanceof HTMLElement)) return;
  el.dataset.frameFileIndex = String(frameIndex);
  ensureFramePreviewObserver();
  if (!framePreviewObserver) {
    // No IntersectionObserver / grid not ready — fall back to eager create.
    createPreviewUrlForIndex(frameIndex);
    return;
  }
  framePreviewObserver.observe(el);
}

function teardownFramePreviewObserver(): void {
  framePreviewObserver?.disconnect();
  framePreviewObserver = null;
}

/** After unpausing, create URLs only for frames currently near the viewport. */
function flushVisibleFramePreviews(): void {
  const grid = framesGridRef.value;
  if (!grid) return;

  const rootRect = grid.getBoundingClientRect();
  const margin = 120;
  const buttons = grid.querySelectorAll<HTMLElement>(
    '.preview-frame[data-frame-file-index]'
  );
  for (const btn of buttons) {
    const rect = btn.getBoundingClientRect();
    const nearViewport =
      rect.bottom >= rootRect.top - margin &&
      rect.top <= rootRect.bottom + margin;
    if (!nearViewport) continue;
    const frameIndex = Number(btn.dataset.frameFileIndex);
    if (Number.isFinite(frameIndex)) {
      createPreviewUrlForIndex(frameIndex);
    }
  }
}

function scrollFrameArrayIndexIntoView(arrayIdx: number): Promise<void> {
  return new Promise((resolve) => {
    const grid = framesGridRef.value;
    if (!grid) {
      resolve();
      return;
    }

    const el = grid.querySelector(
      `[data-frame-array-index="${arrayIdx}"]`
    ) as HTMLElement | null;
    if (!el) {
      resolve();
      return;
    }

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      grid.removeEventListener('scrollend', onScrollEnd);
      window.clearTimeout(fallbackTimer);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => resolve());
      });
    };

    const onScrollEnd = () => finish();

    const gridRect = grid.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const alreadyVisible =
      elRect.top >= gridRect.top && elRect.bottom <= gridRect.bottom;

    if (alreadyVisible) {
      finish();
      return;
    }

    grid.addEventListener('scrollend', onScrollEnd, { once: true });
    // Instant jump — avoids decoding every thumbnail along a smooth scroll path.
    el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });
    const fallbackTimer = window.setTimeout(finish, 150);
  });
}

function openFramePreview(index: number) {
  if (index < 0 || index >= extractedFrames.value.length) return;
  previewFrameIndex.value = index;
}

function closeFramePreview() {
  previewFrameIndex.value = null;
}

function stopClipPreview(pauseVideo = false): void {
  isPreviewingClip.value = false;
  const video = videoRef.value;
  if (pauseVideo && video && !video.paused) {
    video.pause();
  }
}

function seekVideoPreview(time: number): void {
  stopClipPreview(true);
  const video = videoRef.value;
  if (!video) return;
  video.currentTime = Math.max(0, Math.min(time, video.duration || time));
}

async function toggleClipPreview(): Promise<void> {
  const video = videoRef.value;
  if (!video || clipDuration.value <= 0) return;

  if (isPreviewingClip.value) {
    // Leave clip-loop mode but keep playing from this moment in the full video.
    stopClipPreview(false);
    return;
  }

  isPreviewingClip.value = true;
  const withinClip =
    video.currentTime >= trimStart.value && video.currentTime < trimEnd.value - 0.05;
  if (!withinClip) {
    video.currentTime = trimStart.value;
  }
  try {
    await video.play();
  } catch {
    stopClipPreview(true);
  }
}

function onVideoPlay(): void {
  // Native controls can start playback; that is not clip-preview looping.
}

function onVideoTimeUpdate(): void {
  if (!isPreviewingClip.value) return;
  const video = videoRef.value;
  if (!video || video.currentTime < trimEnd.value) return;

  if (video.currentTime >= trimEnd.value - 0.05) {
    video.currentTime = trimStart.value;
    void video.play();
  }
}

async function clearVideoPage() {
  if (isExtracting.value || isExportingTrim.value || isDownloading.value || isAddingToPhotos.value) {
    return;
  }
  const confirmed = await askConfirm({
    title: 'Clear video page?',
    message:
      'This removes the video, all extracted frames, and the saved video session. Photos are not affected.',
    confirmLabel: 'Clear page',
    variant: 'danger',
  });
  if (!confirmed) return;

  stopClipPreview();
  closeFramePreview();
  clearFramePreviewUrls();
  exitSelectMode();
  void reset();
}

function revokeFramePreviewUrls(indices: Iterable<number>): void {
  let changed = false;
  const next = new Map(framePreviewUrls.value);
  for (const index of indices) {
    const url = next.get(index);
    if (url) {
      URL.revokeObjectURL(url);
      next.delete(index);
      changed = true;
    }
  }
  if (changed) {
    framePreviewUrls.value = next;
  }
}

async function handleDeleteSelectedFrames() {
  if (isDownloading.value || selectedCount.value === 0) return;
  const count = selectedCount.value;
  const confirmed = await askConfirm({
    title: `Delete ${count} selected frame${count === 1 ? '' : 's'}?`,
    message: 'This cannot be undone.',
    confirmLabel: 'Delete',
    variant: 'danger',
  });
  if (!confirmed) return;

  const indices = [...selectedFrameIndices.value];
  const previewFrame =
    previewFrameIndex.value !== null
      ? extractedFrames.value[previewFrameIndex.value]
      : undefined;
  if (previewFrame && indices.includes(previewFrame.index)) {
    closeFramePreview();
  }
  revokeFramePreviewUrls(indices);
  removeFramesByIndices(indices);
  clearFrameSelection();
  if (extractedFrames.value.length === 0) {
    exitSelectMode();
  }
}

async function handleDeletePreviewFrame() {
  if (isDownloading.value || previewFrameIndex.value === null) return;
  const arrayIdx = previewFrameIndex.value;
  const frame = extractedFrames.value[arrayIdx];
  if (!frame) return;

  const confirmed = await askConfirm({
    title: 'Delete this frame?',
    message: 'This cannot be undone.',
    confirmLabel: 'Delete',
    variant: 'danger',
  });
  if (!confirmed) return;

  const frameId = frame.index;
  revokeFramePreviewUrls([frameId]);
  if (selectedFrameIndices.value.has(frameId)) {
    const next = new Set(selectedFrameIndices.value);
    next.delete(frameId);
    selectedFrameIndices.value = next;
  }
  removeFramesByIndices([frameId]);

  if (extractedFrames.value.length === 0) {
    closeFramePreview();
    exitSelectMode();
    return;
  }

  previewFrameIndex.value = Math.min(arrayIdx, extractedFrames.value.length - 1);
}

async function handleDeleteAllFrames() {
  if (isDownloading.value || isAddingToPhotos.value || extractedFrames.value.length === 0) {
    return;
  }
  const count = extractedFrames.value.length;
  const confirmed = await askConfirm({
    title: `Delete all ${count} extracted frame${count === 1 ? '' : 's'}?`,
    message: 'The video stays loaded. This cannot be undone.',
    confirmLabel: 'Delete all',
    variant: 'danger',
  });
  if (!confirmed) return;

  closeFramePreview();
  clearFramePreviewUrls();
  clearExtractedFrames();
  exitSelectMode();
}

async function handleDownloadTrim(): Promise<void> {
  stopClipPreview();
  await downloadTrimmedVideo();
}

async function handleExtract() {
  stopClipPreview();
  closeFramePreview();
  clearFramePreviewUrls();

  await startExtraction();
}

function getFramePreviewUrl(frame: ExtractedFrameFile): string {
  createPreviewUrlForIndex(frame.index, { force: true, frame });
  return framePreviewUrls.value.get(frame.index)!;
}

function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 100);
  return `${m}:${String(s).padStart(2, '0')}.${String(ms).padStart(2, '0')}`;
}

function getPhaseLabel(phase: string): string {
  switch (phase) {
    case 'loading': return 'Preparing Decoder...';
    case 'extracting': return 'Decoding Frames...';
    case 'processing': return 'Capturing Frames...';
    case 'complete': return 'Complete';
    case 'error': return 'Error';
    default: return phase;
  }
}

function handleFrameClick(index: number, arrayIdx: number, event: MouseEvent) {
  if (suppressNextFrameClick.value) {
    suppressNextFrameClick.value = false;
    return;
  }
  if (isSelectMode.value) {
    if (event.shiftKey && selectionAnchorArrayIdx.value !== null) {
      selectFrameRange(selectionAnchorArrayIdx.value, arrayIdx);
    } else {
      toggleFrameSelection(index);
      selectionAnchorArrayIdx.value = arrayIdx;
    }
    return;
  }
  const foundIdx = extractedFrames.value.findIndex((frame) => frame.index === index);
  if (foundIdx >= 0) {
    openFramePreview(foundIdx);
  }
}

function getFrameArrayIndexFromElement(element: Element | null): number | null {
  if (!element) return null;
  const frameEl = element.closest('.preview-frame');
  if (!frameEl) return null;
  const indexAttr = frameEl.getAttribute('data-frame-array-index');
  if (indexAttr === null) return null;
  const index = parseInt(indexAttr, 10);
  return Number.isNaN(index) ? null : index;
}

function stopFrameAutoScroll() {
  if (autoScrollInterval.value !== null) {
    clearInterval(autoScrollInterval.value);
    autoScrollInterval.value = null;
  }
  autoScrollDirection.value = null;
}

function startFrameAutoScroll(direction: 'up' | 'down') {
  if (autoScrollDirection.value === direction) return;
  stopFrameAutoScroll();
  autoScrollDirection.value = direction;
  autoScrollInterval.value = window.setInterval(() => {
    const grid = framesGridRef.value;
    if (!grid) return;
    grid.scrollTop += direction === 'down' ? 20 : -20;
  }, 16);
}

function updateDragSelectionCount() {
  const selected = selectedFrameIndices.value;
  const dragged = draggedOverArrayIndices.value;
  if (isDeselecting.value) {
    let removing = 0;
    for (const arrayIdx of dragged) {
      const frame = extractedFrames.value[arrayIdx];
      if (frame && selected.has(frame.index)) removing += 1;
    }
    dragSelectionCount.value = Math.max(0, selected.size - removing);
  } else {
    let adding = 0;
    for (const arrayIdx of dragged) {
      const frame = extractedFrames.value[arrayIdx];
      if (frame && !selected.has(frame.index)) adding += 1;
    }
    dragSelectionCount.value = selected.size + adding;
  }
}

function handleFrameDragStart(arrayIdx: number, event: MouseEvent | TouchEvent) {
  if (!isSelectMode.value) return;
  if (isDownloading.value) return;

  hasDragMoved.value = false;
  dragStartedFromTouch.value = event.type === 'touchstart';
  isDragSelecting.value = true;
  dragStartArrayIndex.value = arrayIdx;
  draggedOverArrayIndices.value = new Set([arrayIdx]);
  dragIntent.value = 'undetermined';

  const frame = extractedFrames.value[arrayIdx];
  isDeselecting.value = frame ? selectedFrameIndices.value.has(frame.index) : false;

  if ('touches' in event && event.touches.length > 0) {
    touchStartPosition.value = {
      x: event.touches[0].clientX,
      y: event.touches[0].clientY,
    };
  } else {
    const mouseEvent = event as MouseEvent;
    touchStartPosition.value = { x: mouseEvent.clientX, y: mouseEvent.clientY };
  }

  updateDragSelectionCount();
  document.body.classList.add('drag-selecting');

  if (event.type === 'mousedown') {
    document.addEventListener('mousemove', handleFrameDragMove);
    document.addEventListener('mouseup', handleFrameDragEnd);
  } else if (event.type === 'touchstart') {
    document.addEventListener('touchmove', handleFrameDragMove, { passive: false });
    document.addEventListener('touchend', handleFrameDragEnd, { passive: true });
    document.addEventListener('touchcancel', handleFrameDragEnd, { passive: true });
  }
}

function handleFrameDragMove(event: MouseEvent | TouchEvent) {
  if (!isDragSelecting.value) return;

  if ('touches' in event && event.touches.length === 2) {
    return;
  }

  let clientX: number;
  let clientY: number;

  if ('touches' in event && event.touches.length > 0) {
    clientX = event.touches[0].clientX;
    clientY = event.touches[0].clientY;
  } else if ('clientX' in event) {
    clientX = event.clientX;
    clientY = event.clientY;
    event.preventDefault();
  } else {
    return;
  }

  if (
    'touches' in event &&
    dragIntent.value === 'undetermined' &&
    touchStartPosition.value
  ) {
    const deltaX = Math.abs(clientX - touchStartPosition.value.x);
    const deltaY = Math.abs(clientY - touchStartPosition.value.y);
    const threshold = 10;
    if (deltaX > threshold || deltaY > threshold) {
      dragIntent.value = deltaX >= deltaY ? 'select' : 'scroll';
    }
  }

  const grid = framesGridRef.value;
  const edgeThreshold = 48;

  if ('touches' in event && dragIntent.value === 'scroll') {
    if (grid) {
      const rect = grid.getBoundingClientRect();
      if (clientY >= rect.bottom - edgeThreshold) {
        startFrameAutoScroll('down');
      } else if (clientY <= rect.top + edgeThreshold) {
        startFrameAutoScroll('up');
      } else {
        stopFrameAutoScroll();
      }
    }
    return;
  }

  if ('touches' in event && dragIntent.value === 'undetermined') {
    return;
  }

  hasDragMoved.value = true;

  const checkPoints = [
    { x: clientX, y: clientY },
    { x: clientX - 12, y: clientY },
    { x: clientX + 12, y: clientY },
    { x: clientX, y: clientY - 12 },
    { x: clientX, y: clientY + 12 },
  ];

  const foundIndices = new Set<number>();
  let primaryIndex: number | null = null;

  for (const point of checkPoints) {
    const element = document.elementFromPoint(point.x, point.y);
    const index = getFrameArrayIndexFromElement(element);
    if (index !== null) {
      if (primaryIndex === null) primaryIndex = index;
      foundIndices.add(index);
    }
  }

  if (primaryIndex !== null && dragStartArrayIndex.value !== null) {
    const start = Math.min(dragStartArrayIndex.value, primaryIndex);
    const end = Math.max(dragStartArrayIndex.value, primaryIndex);
    for (let i = start; i <= end; i += 1) {
      foundIndices.add(i);
    }
  }

  if (foundIndices.size > 0) {
    draggedOverArrayIndices.value = new Set([
      ...draggedOverArrayIndices.value,
      ...foundIndices,
    ]);
    updateDragSelectionCount();
  }

  if ('touches' in event && dragIntent.value === 'select') {
    if (foundIndices.size > 0) {
      event.preventDefault();
    }
    if (grid) {
      const rect = grid.getBoundingClientRect();
      if (clientY >= rect.bottom - edgeThreshold) {
        startFrameAutoScroll('down');
      } else if (clientY <= rect.top + edgeThreshold) {
        startFrameAutoScroll('up');
      } else {
        stopFrameAutoScroll();
      }
    }
  } else if (!('touches' in event) && grid) {
    const rect = grid.getBoundingClientRect();
    if (clientY >= rect.bottom - edgeThreshold) {
      startFrameAutoScroll('down');
    } else if (clientY <= rect.top + edgeThreshold) {
      startFrameAutoScroll('up');
    } else {
      stopFrameAutoScroll();
    }
  }
}

function cleanupFrameDragSelection() {
  isDragSelecting.value = false;
  isDeselecting.value = false;
  dragStartArrayIndex.value = null;
  draggedOverArrayIndices.value = new Set();
  dragIntent.value = 'undetermined';
  touchStartPosition.value = null;
  hasDragMoved.value = false;
  dragStartedFromTouch.value = false;
  dragSelectionCount.value = null;
  suppressNextFrameClick.value = false;
  stopFrameAutoScroll();
  document.body.classList.remove('drag-selecting');
  document.removeEventListener('mousemove', handleFrameDragMove);
  document.removeEventListener('mouseup', handleFrameDragEnd);
  document.removeEventListener('touchmove', handleFrameDragMove);
  document.removeEventListener('touchend', handleFrameDragEnd);
  document.removeEventListener('touchcancel', handleFrameDragEnd);
}

function handleFrameDragEnd() {
  if (!isDragSelecting.value) return;

  const arrayIndices = Array.from(draggedOverArrayIndices.value).sort((a, b) => a - b);
  const performedDragSelection =
    hasDragMoved.value || draggedOverArrayIndices.value.size > 1;
  const startedFromTouch = dragStartedFromTouch.value;
  const intent = dragIntent.value;
  const startIdx = dragStartArrayIndex.value;
  const deselecting = isDeselecting.value;

  cleanupFrameDragSelection();

  if (performedDragSelection && arrayIndices.length > 0) {
    suppressNextFrameClick.value = true;
    const next = new Set(selectedFrameIndices.value);
    for (const arrayIdx of arrayIndices) {
      const frame = extractedFrames.value[arrayIdx];
      if (!frame) continue;
      if (deselecting) {
        next.delete(frame.index);
      } else {
        next.add(frame.index);
      }
    }
    selectedFrameIndices.value = next;
    // Anchor at the end of the drag so Shift+click continues from there.
    selectionAnchorArrayIdx.value = arrayIndices[arrayIndices.length - 1] ?? startIdx;
  } else if (
    !performedDragSelection &&
    startedFromTouch &&
    intent !== 'scroll'
  ) {
    if (startIdx !== null) {
      const frame = extractedFrames.value[startIdx];
      if (frame) {
        suppressNextFrameClick.value = true;
        toggleFrameSelection(frame.index);
        selectionAnchorArrayIdx.value = startIdx;
      }
    }
  }
}

function handleFrameMouseDown(arrayIdx: number, event: MouseEvent) {
  if (!isSelectMode.value || event.button !== 0) return;
  // Shift+click is range-select via click handler; don't start a drag.
  if (event.shiftKey) return;
  handleFrameDragStart(arrayIdx, event);
}

function handleFrameTouchStart(arrayIdx: number, event: TouchEvent) {
  if (!isSelectMode.value || event.touches.length !== 1) return;
  handleFrameDragStart(arrayIdx, event);
}

function enterSelectMode() {
  isSelectMode.value = true;
  closeFramePreview();
}

/** Enter select mode and select the first N frames (or all if fewer exist). */
async function selectFirstFrames(count: number) {
  if (extractedFrames.value.length === 0 || isAutoSelectingFrames.value) return;

  const n = Math.min(count, extractedFrames.value.length);
  const lastArrayIdx = n - 1;

  isAutoSelectingFrames.value = true;
  framePreviewLoadsPaused.value = true;
  try {
    selectedFrameIndices.value = new Set(
      extractedFrames.value.slice(0, n).map((frame) => frame.index)
    );
    selectionAnchorArrayIdx.value = lastArrayIdx;
    enterSelectMode();
    await nextTick();
    await scrollFrameArrayIndexIntoView(lastArrayIdx);
  } finally {
    framePreviewLoadsPaused.value = false;
    await nextTick();
    flushVisibleFramePreviews();
    isAutoSelectingFrames.value = false;
  }
}

function exitSelectMode() {
  cleanupFrameDragSelection();
  isSelectMode.value = false;
  selectedFrameIndices.value = new Set();
  selectionAnchorArrayIdx.value = null;
}

function toggleFrameSelection(index: number) {
  const next = new Set(selectedFrameIndices.value);
  if (next.has(index)) {
    next.delete(index);
  } else {
    next.add(index);
  }
  selectedFrameIndices.value = next;
}

/** Select every frame between two grid positions (inclusive), Explorer-style. */
function selectFrameRange(fromArrayIdx: number, toArrayIdx: number) {
  const start = Math.min(fromArrayIdx, toArrayIdx);
  const end = Math.max(fromArrayIdx, toArrayIdx);
  const next = new Set<number>();
  for (let i = start; i <= end; i += 1) {
    const frame = extractedFrames.value[i];
    if (frame) next.add(frame.index);
  }
  selectedFrameIndices.value = next;
}

function selectAllFrames() {
  selectedFrameIndices.value = new Set(
    extractedFrames.value.map((frame) => frame.index)
  );
  selectionAnchorArrayIdx.value =
    extractedFrames.value.length > 0 ? 0 : null;
}

function clearFrameSelection() {
  selectedFrameIndices.value = new Set();
  selectionAnchorArrayIdx.value = null;
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  // Large archives can still be streaming when the click returns; revoking
  // immediately makes Chrome fail the download.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function buildZipBaseName(): string {
  const raw = videoFile.value?.name?.replace(/\.[^.]+$/, '') || 'video';
  const safe = raw.replace(/[^\w\-]+/g, '_').slice(0, 40) || 'video';
  return `${safe}-frames`;
}

async function downloadFramesAsZip(
  frames: ExtractedFrameFile[],
  zipName: string
): Promise<void> {
  if (frames.length === 0 || isDownloading.value) return;

  isDownloading.value = true;
  downloadCancelled.value = false;
  downloadProgress.value = {
    percent: 0,
    message: 'Preparing download...',
  };

  const stamp = createDownloadStamp();

  try {
    if (frames.length === 1) {
      if (downloadCancelled.value) {
        downloadProgress.value = { percent: 0, message: 'Download cancelled' };
        return;
      }
      downloadBlob(
        frames[0].file,
        stampDownloadFileName(frames[0].file.name, stamp)
      );
      downloadProgress.value = {
        percent: 100,
        message: 'Download started',
      };
      return;
    }

    const zip = createStreamingZip();
    const total = frames.length;

    // One frame is read at a time so the archive never lives in the JS heap.
    for (let i = 0; i < frames.length; i++) {
      if (downloadCancelled.value) {
        downloadProgress.value = { percent: 0, message: 'Download cancelled' };
        return;
      }

      const frame = frames[i];
      zip.add(
        stampDownloadFileName(frame.file.name, stamp),
        await frame.file.arrayBuffer()
      );

      const done = i + 1;
      downloadProgress.value = {
        percent: Math.round((done / total) * 90),
        message: `Packing frame ${done} of ${total}...`,
      };
    }

    if (downloadCancelled.value) {
      downloadProgress.value = { percent: 0, message: 'Download cancelled' };
      return;
    }

    downloadProgress.value = {
      percent: 95,
      message: 'Building ZIP file...',
    };

    const blob = await zip.finish();

    if (downloadCancelled.value) {
      downloadProgress.value = { percent: 0, message: 'Download cancelled' };
      return;
    }

    downloadBlob(blob, stampDownloadZipName(zipName, stamp));
    downloadProgress.value = {
      percent: 100,
      message: `Downloaded ${total} frames`,
    };
  } catch (err) {
    if (downloadCancelled.value) {
      downloadProgress.value = { percent: 0, message: 'Download cancelled' };
      return;
    }
    console.error('Frame download failed:', err);
    error.value = `Download failed: ${err instanceof Error ? err.message : String(err)}`;
  } finally {
    isDownloading.value = false;
    downloadCancelled.value = false;
    window.setTimeout(() => {
      if (!isDownloading.value) {
        downloadProgress.value = null;
      }
    }, 2000);
  }
}

function cancelDownload() {
  if (!isDownloading.value) return;
  downloadCancelled.value = true;
  downloadProgress.value = {
    percent: downloadProgress.value?.percent ?? 0,
    message: 'Cancelling…',
  };
}

async function handleDownloadAll() {
  await downloadFramesAsZip(
    extractedFrames.value,
    `${buildZipBaseName()}-${extractedFrames.value.length}.zip`
  );
}

async function handleDownloadSelected() {
  if (selectedCount.value === 0) return;

  const selected = extractedFrames.value.filter((frame) =>
    selectedFrameIndices.value.has(frame.index)
  );

  await downloadFramesAsZip(
    selected,
    `${buildZipBaseName()}-selected-${selected.length}.zip`
  );
}

async function handleAddToGrid() {
  if (isDownloading.value || isAddingToPhotos.value) return;
  if (extractedFrames.value.length === 0) return;

  await addFramesToPhotos(
    extractedFrames.value.map((frame) => frame.file)
  );
}

async function handleAddSelectedToGrid() {
  if (isDownloading.value || isAddingToPhotos.value) return;
  if (selectedCount.value === 0) return;

  const files = extractedFrames.value
    .filter((frame) => selectedFrameIndices.value.has(frame.index))
    .map((frame) => frame.file);

  if (files.length === 0) return;
  await addFramesToPhotos(files);
}

async function addFramesToPhotos(files: File[]) {
  if (files.length === 0) return;

  isAddingToPhotos.value = true;
  closeFramePreview();
  exitSelectMode();

  console.warn('[Import] Add to Photos started', {
    frameCount: files.length,
    totalBytes: files.reduce((sum, f) => sum + f.size, 0),
  });

  try {
    prepareForPhotoImport();
    await props.addToPhotos(files);
    console.warn('[Import] Add to Photos completed — video gallery kept');
  } catch (err) {
    console.error('[Import] Add to Photos failed — keeping video frames', err);
    error.value =
      err instanceof Error
        ? err.message
        : 'Failed to add frames to Images. Your extracted frames are still here.';
  } finally {
    await finishPhotoImport();
    isAddingToPhotos.value = false;
  }
}

async function onVideoSessionExpiredExternally(): Promise<void> {
  if (!videoFile.value && extractedFrames.value.length === 0) return;
  stopClipPreview();
  closeFramePreview();
  clearFramePreviewUrls();
  exitSelectMode();
  await reset();
  error.value =
    'Video session expired after 24 hours and was cleared. Photos are unaffected.';
}

onMounted(async () => {
  window.addEventListener(
    'justcropit:video-session-expired',
    onVideoSessionExpiredExternally
  );

  const restored = await restoreSession();
  if (restored) {
    await nextTick();
    syncVideoMetadata();
  }
});

onUnmounted(() => {
  window.removeEventListener(
    'justcropit:video-session-expired',
    onVideoSessionExpiredExternally
  );
  stopClipPreview();
  if (metadataRetryTimer) {
    clearTimeout(metadataRetryTimer);
    metadataRetryTimer = null;
  }
  cleanupFrameDragSelection();
  if (confirmResolver) {
    resolveConfirm(false);
  }
  closeFramePreview();
  teardownFramePreviewObserver();
  clearFramePreviewUrls();
});
</script>

<style scoped>
.video-extractor {
  display: flex;
  flex-direction: column;
  gap: 40px;
  width: 100%;
  max-width: 820px;
  margin: 0 auto;
  padding: 0 28px 64px;
  box-sizing: border-box;
}

.video-extractor-header {
  margin-top: 28px;
  margin-bottom: 8px;
  text-align: center;
}

.video-extractor-subtitle {
  margin: 0;
  color: rgba(255, 255, 255, 0.55);
  font-size: 0.95rem;
}

/* Unsupported Warning */
.unsupported-warning {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 48px 24px;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: 12px;
  text-align: center;
}

.unsupported-warning i {
  font-size: 48px;
  color: #f87171;
}

.unsupported-warning h3 {
  margin: 0;
  color: #f87171;
}

.unsupported-warning p {
  margin: 0;
  color: rgba(255, 255, 255, 0.7);
  max-width: 400px;
}

/* Video Dropzone */
.video-dropzone {
  position: relative;
  min-height: 200px;
  border: 2px dashed rgba(255, 255, 255, 0.2);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.02);
  transition: all 0.2s ease;
  cursor: pointer;
}

.video-dropzone:hover {
  border-color: rgba(212, 175, 55, 0.4);
  background: rgba(212, 175, 55, 0.05);
}

.video-dropzone.drag-over {
  border-color: rgba(212, 175, 55, 0.6);
  background: rgba(212, 175, 55, 0.1);
  transform: scale(1.01);
}

.video-dropzone.has-video {
  border-style: solid;
  border-color: rgba(255, 255, 255, 0.1);
  cursor: default;
  display: flex;
  flex-direction: column;
  gap: 0;
}

.video-dropzone.extracting {
  pointer-events: none;
  opacity: 0.7;
}

.dropzone-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 20px;
  padding: 56px 32px;
  text-align: center;
}

.dropzone-content i {
  font-size: 48px;
  color: rgba(212, 175, 55, 0.6);
}

.dropzone-content h3 {
  margin: 0;
  font-size: 1.25rem;
  color: rgba(255, 255, 255, 0.9);
}

.dropzone-content p {
  margin: 0;
  color: rgba(255, 255, 255, 0.5);
  font-size: 0.9rem;
}

.file-input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
}

.trim-section {
  padding: 28px 24px 12px;
  margin-top: 8px;
  background: rgba(0, 0, 0, 0.35);
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.trim-export-progress {
  padding: 16px 0 8px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.trim-export-message {
  font-size: 0.8rem;
  color: rgba(255, 255, 255, 0.65);
}

.progress-bar-container.compact {
  height: 4px;
}

/* Video Preview */
.video-preview-container {
  position: relative;
  width: 100%;
  padding: 20px 20px 0;
  border-radius: 14px;
  overflow: hidden;
  box-sizing: border-box;
}

.video-preview {
  width: 100%;
  max-height: 400px;
  object-fit: contain;
  background: #000;
  display: block;
}

.video-info-overlay {
  position: absolute;
  top: 20px;
  left: 20px;
  right: 20px;
  z-index: 2;
  padding: 8px 44px 8px 12px;
  pointer-events: none;
  background: linear-gradient(to bottom, rgba(0, 0, 0, 0.72), transparent);
  border-radius: 8px 8px 0 0;
}

.video-name {
  font-size: 0.9rem;
  font-weight: 500;
  color: #fff;
  margin-bottom: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.video-meta {
  display: flex;
  gap: 12px;
}

.meta-item {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 0.68rem;
  font-style: italic;
  font-weight: 400;
  line-height: 1.2;
  color: rgba(255, 255, 255, 0.55);
}

.meta-item i {
  font-size: 0.62rem;
  opacity: 0.7;
}

.clear-video-btn {
  position: absolute;
  top: 28px;
  right: 28px;
  z-index: 3;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.6);
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: rgba(255, 255, 255, 0.8);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}

.clear-video-btn:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.8);
  border-color: transparent;
}

.clear-video-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Extraction Options */
.extraction-options {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 16px;
  padding: 32px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.extraction-options h3 {
  margin: 0 0 28px 0;
  font-size: 1rem;
  color: rgba(255, 255, 255, 0.9);
  display: flex;
  align-items: center;
  gap: 8px;
}

.option-group {
  margin-bottom: 32px;
}

.option-group:last-of-type {
  margin-bottom: 16px;
}

.option-label {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 0.9rem;
  color: rgba(255, 255, 255, 0.7);
  margin-bottom: 18px;
}

.option-label i {
  font-size: 0.85rem;
  opacity: 0.7;
}

/* Interval Controls */
.interval-controls {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.interval-presets {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.preset-btn {
  padding: 10px 18px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.8);
  cursor: pointer;
  transition: all 0.2s ease;
  font-size: 0.85rem;
}

.preset-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.25);
}

.preset-btn.active {
  background: rgba(212, 175, 55, 0.2);
  border-color: rgba(212, 175, 55, 0.4);
  color: #ffd700;
}

.preset-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.interval-slider-row {
  display: flex;
  align-items: center;
  gap: 20px;
  padding-top: 4px;
}

.interval-slider {
  flex: 1;
  height: 6px;
  -webkit-appearance: none;
  appearance: none;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 3px;
  cursor: pointer;
}

.interval-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #d4af37;
  cursor: pointer;
  border: 2px solid #fff;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
}

.interval-slider:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.interval-value {
  min-width: 60px;
  text-align: right;
  font-size: 0.9rem;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.9);
}

/* Quality Options */
.quality-options {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding-top: 4px;
}

.quality-option-row {
  display: flex;
  align-items: flex-start;
  justify-content: center;
  gap: 10px;
}

.quality-btn {
  width: 220px;
  height: 44px;
  padding: 0 12px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.8);
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-size: 0.9rem;
  text-align: center;
  box-sizing: border-box;
}

.quality-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.25);
}

.quality-btn.active {
  background: rgba(212, 175, 55, 0.2);
  border-color: rgba(212, 175, 55, 0.4);
  color: #ffd700;
}

.quality-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.quality-help {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  margin-top: 4px;
  flex-shrink: 0;
  border: none;
  background: transparent;
  color: rgba(255, 255, 255, 0.45);
  cursor: help;
  transition: color 0.2s ease;
  outline: none;
}

.quality-help i {
  font-size: 0.65rem;
}

.quality-help:hover,
.quality-help:focus-visible {
  color: rgba(255, 255, 255, 0.9);
}

.quality-help-tooltip {
  position: absolute;
  right: 0;
  top: calc(100% + 6px);
  width: 240px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(18, 18, 26, 0.98);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
  font-size: 0.78rem;
  line-height: 1.45;
  color: rgba(255, 255, 255, 0.85);
  text-align: left;
  pointer-events: none;
  opacity: 0;
  visibility: hidden;
  transform: translateY(-4px);
  transition: opacity 0.2s ease, transform 0.2s ease, visibility 0.2s ease;
  z-index: 20;
}

.quality-help:hover .quality-help-tooltip,
.quality-help:focus-visible .quality-help-tooltip,
.quality-help:focus-within .quality-help-tooltip {
  opacity: 1;
  visibility: visible;
  transform: translateY(0);
}

.batch-hint {
  margin-left: 4px;
  color: rgba(255, 255, 255, 0.5);
  font-size: 0.85rem;
}

/* Estimated Frames */
.estimated-frames {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 20px;
  margin-top: 8px;
  padding: 16px 20px;
  background: rgba(249, 115, 22, 0.12);
  border: 1px solid rgba(249, 115, 22, 0.35);
  border-radius: 10px;
  color: #fdba74;
  font-size: 0.9rem;
}

.estimated-frames-left,
.estimated-frames-right {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-variant-numeric: tabular-nums;
}

.estimated-frames-right {
  text-align: right;
  flex-shrink: 0;
}

.estimated-frames-message {
  width: 100%;
  text-align: center;
}

.estimated-frames i {
  font-size: 1rem;
  color: #fb923c;
}

.estimated-frames strong {
  color: #fb923c;
  font-size: 1.1rem;
}

/* Progress Section */
.progress-section {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 16px;
  padding: 28px;
}

.progress-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  margin-bottom: 18px;
}

.progress-header-right {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
  flex-shrink: 0;
}

.progress-eta {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.8rem;
  color: rgba(255, 255, 255, 0.55);
  font-variant-numeric: tabular-nums;
  text-align: right;
  max-width: 220px;
  line-height: 1.3;
}

.progress-eta i {
  font-size: 0.75rem;
  opacity: 0.8;
  flex-shrink: 0;
}

.progress-phase {
  font-size: 0.9rem;
  color: rgba(255, 255, 255, 0.8);
}

.progress-percent {
  font-size: 1rem;
  font-weight: 600;
  color: #ffd700;
}

.progress-bar-container {
  height: 8px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  overflow: hidden;
}

.progress-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, #d4af37, #ffd700);
  border-radius: 4px;
  transition: width 0.3s ease;
}

.progress-details {
  margin-top: 16px;
  font-size: 0.85rem;
  color: rgba(255, 255, 255, 0.6);
}

/* Error Message */
.error-message {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 18px 22px;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: 10px;
  color: #f87171;
  font-size: 0.9rem;
}

.error-message i {
  font-size: 1rem;
}

.loading-meta {
  color: rgba(255, 255, 255, 0.75);
}

/* Action Buttons */
.action-buttons {
  display: flex;
  justify-content: center;
  gap: 20px;
  position: relative;
  z-index: 1;
  padding-top: 16px;
  margin-top: 8px;
}

.extract-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 16px 40px;
  border-radius: 12px;
  font-size: 1.05rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  min-width: 220px;
}

.extract-btn {
  background: linear-gradient(135deg, #d4af37, #b8963a);
  border: none;
  color: #000;
}

.extract-btn:hover:not(:disabled) {
  background: linear-gradient(135deg, #e4bf47, #c8a64a);
  transform: translateY(-1px);
  box-shadow: 0 4px 20px rgba(212, 175, 55, 0.4);
}

.extract-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.cancel-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 14px 32px;
  border-radius: 12px;
  font-size: 1rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.cancel-btn {
  background: rgba(239, 68, 68, 0.15);
  border: 1px solid rgba(239, 68, 68, 0.4);
  color: #f87171;
}

.cancel-btn:hover {
  background: rgba(239, 68, 68, 0.25);
  border-color: rgba(239, 68, 68, 0.6);
}

/* Extracted Preview */
.extracted-preview {
  background: rgba(34, 197, 94, 0.05);
  border: 1px solid rgba(34, 197, 94, 0.2);
  border-radius: 16px;
  padding: 28px;
}

.extracted-header {
  display: flex;
  align-items: center;
  margin-bottom: 24px;
}

.extracted-header h3 {
  margin: 0;
  font-size: 1rem;
  color: #4ade80;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.selection-count {
  color: rgba(212, 175, 55, 0.95);
  font-weight: 500;
}

.extracted-body {
  display: flex;
  align-items: flex-start;
  gap: 16px;
}

.extracted-body .frames-preview-grid {
  flex: 1;
  min-width: 0;
}

.extracted-side-actions {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
  width: min(200px, 100%);
}

.extracted-side-actions .frame-action-btn,
.extracted-side-actions .add-to-grid-btn {
  width: 100%;
  justify-content: center;
}

.frame-action-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.14);
  color: rgba(255, 255, 255, 0.85);
  cursor: pointer;
  font-size: 0.9rem;
  font-weight: 500;
  transition: background 0.2s ease, border-color 0.2s ease, transform 0.2s ease;
}

.frame-action-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.25);
  transform: translateY(-1px);
}

.frame-action-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
  transform: none;
}

.frame-action-btn--primary {
  background: rgba(212, 175, 55, 0.18);
  border-color: rgba(212, 175, 55, 0.4);
  color: #e8c96a;
}

.frame-action-btn--primary:hover:not(:disabled) {
  background: rgba(212, 175, 55, 0.28);
  border-color: rgba(212, 175, 55, 0.55);
}

.frame-action-btn--danger {
  background: rgba(239, 68, 68, 0.14);
  border-color: rgba(239, 68, 68, 0.4);
  color: #f87171;
}

.frame-action-btn--danger:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.24);
  border-color: rgba(239, 68, 68, 0.55);
}

.add-to-grid-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 20px;
  border-radius: 10px;
  background: rgba(34, 197, 94, 0.2);
  border: 1px solid rgba(34, 197, 94, 0.4);
  color: #4ade80;
  cursor: pointer;
  font-size: 0.9rem;
  font-weight: 500;
  transition: all 0.2s ease;
}

.add-to-grid-btn:hover:not(:disabled) {
  background: rgba(34, 197, 94, 0.3);
  border-color: rgba(34, 197, 94, 0.6);
  transform: translateY(-1px);
}

.add-to-grid-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
  transform: none;
}

.download-progress {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 16px;
}

.download-progress-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.download-progress-row .progress-bar-container {
  flex: 1;
  min-width: 0;
}

.cancel-download-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  padding: 6px 12px;
  border-radius: 8px;
  border: 1px solid rgba(239, 68, 68, 0.45);
  background: rgba(239, 68, 68, 0.15);
  color: #f87171;
  font-size: 0.8rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s ease, border-color 0.2s ease;
}

.cancel-download-btn:hover {
  background: rgba(239, 68, 68, 0.25);
  border-color: rgba(239, 68, 68, 0.65);
}

.download-progress-message {
  font-size: 0.85rem;
  color: rgba(255, 255, 255, 0.65);
}

.frames-preview-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
  gap: 16px;
}

.frames-preview-grid--expanded {
  max-height: min(60vh, 640px);
  overflow-y: auto;
  padding-right: 4px;
  scrollbar-gutter: stable;
}

.frames-preview-grid--selecting .preview-frame {
  cursor: pointer;
}

.frames-preview-grid--drag-selecting {
  touch-action: none;
  user-select: none;
}

.frames-preview-grid--drag-selecting .preview-frame {
  cursor: grabbing;
}

.frames-preview-grid--expanded::-webkit-scrollbar {
  width: 8px;
}

.frames-preview-grid--expanded::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.15);
  border-radius: 4px;
}

.preview-frame {
  position: relative;
  aspect-ratio: 16/9;
  border-radius: 8px;
  overflow: hidden;
  background: rgba(0, 0, 0, 0.3);
  border: none;
  padding: 0;
  cursor: pointer;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.preview-frame:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
}

.preview-frame:focus-visible {
  outline: 2px solid rgba(212, 175, 55, 0.8);
  outline-offset: 2px;
}

.preview-frame--selected {
  box-shadow: 0 0 0 2px rgba(212, 175, 55, 0.85), 0 6px 20px rgba(0, 0, 0, 0.35);
}

.preview-frame--selected img {
  opacity: 0.92;
}

.preview-frame--dragging-over {
  box-shadow:
    0 0 0 2px rgba(255, 255, 255, 0.85),
    0 0 0 4px rgba(212, 175, 55, 0.35),
    0 6px 20px rgba(0, 0, 0, 0.35);
}

.preview-frame--dragging-over.preview-frame--selected {
  box-shadow:
    0 0 0 2px rgba(255, 255, 255, 0.9),
    0 0 0 5px rgba(212, 175, 55, 0.55),
    0 6px 20px rgba(0, 0, 0, 0.35);
}

.frame-check {
  position: absolute;
  top: 6px;
  left: 6px;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  border: 1.5px solid rgba(255, 255, 255, 0.55);
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  color: transparent;
  font-size: 0.7rem;
  z-index: 1;
}

.frame-check--on {
  background: rgba(212, 175, 55, 0.95);
  border-color: rgba(212, 175, 55, 1);
  color: #1a1a1a;
}

.preview-frame img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  pointer-events: none;
}

.frame-time {
  position: absolute;
  bottom: 4px;
  right: 4px;
  padding: 2px 6px;
  background: rgba(0, 0, 0, 0.7);
  border-radius: 4px;
  font-size: 0.7rem;
  color: rgba(255, 255, 255, 0.9);
}

/* Responsive */
@media (max-width: 1023px) {
  .video-extractor {
    padding: 0 20px 48px;
    gap: 32px;
  }

  .extraction-options {
    padding: 24px;
  }

  .trim-section {
    padding: 24px 20px 12px;
  }

  .video-preview-container {
    padding: 16px 16px 0;
  }

  .interval-presets {
    justify-content: center;
  }

  .extracted-body {
    flex-direction: column;
  }

  .extracted-side-actions {
    width: 100%;
  }

  .extract-btn {
    min-width: 0;
    width: 100%;
  }

  .frame-action-btn,
  .add-to-grid-btn {
    justify-content: center;
  }
}

@media (max-width: 599px) {
  .video-extractor {
    padding: 0 16px 40px;
    gap: 28px;
  }

  .video-extractor-subtitle {
    font-size: 0.85rem;
  }

  .dropzone-content {
    padding: 32px 16px;
  }

  .dropzone-content i {
    font-size: 36px;
  }

  .extraction-options {
    padding: 20px;
  }

  .trim-section {
    padding: 20px 16px 12px;
  }

  .preset-btn {
    padding: 6px 12px;
    font-size: 0.8rem;
  }

  .action-buttons {
    flex-direction: column;
    align-items: center;
  }

  .estimated-frames {
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
  }

  .estimated-frames-right {
    justify-content: flex-end;
  }
}
</style>
