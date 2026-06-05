<template>
  <div class="video-extractor">
    <!-- Unsupported Browser Warning -->
    <div v-if="!isSupported" class="unsupported-warning">
      <i class="fas fa-exclamation-triangle"></i>
      <h3>Browser Not Supported</h3>
      <p>
        Video frame extraction requires Web Workers, which are not available in this environment.
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
              muted
              playsinline
              preload="metadata"
              @loadedmetadata="syncVideoMetadata"
              @durationchange="syncVideoMetadata"
              @loadeddata="syncVideoMetadata"
              @timeupdate="onVideoTimeUpdate"
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
              @click.stop="clearVideo"
              :disabled="isExtracting"
              title="Remove video"
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
                  Smaller files and faster extraction. Best for long clips with many frames.
                  Slight compression artifacts are possible.
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
                Lossless (PNG)
              </button>
              <span
                class="quality-help"
                tabindex="0"
                role="button"
                aria-label="PNG format details"
              >
                <i class="fas fa-circle-question" aria-hidden="true"></i>
                <span class="quality-help-tooltip">
                  Maximum fidelity with no compression loss. Larger files and slower.
                  Best when every frame needs pixel-perfect quality.
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
              <span class="batch-hint">· {{ estimatedBatchCount }} batches</span>
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
        <div class="progress-frames" v-if="progress.currentFrame > 0">
          Frame {{ progress.currentFrame }} of {{ progress.totalFrames || '?' }}
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
            {{ extractedFrames.length }} Frames Extracted
          </h3>
          <button class="add-to-grid-btn" @click="handleAddToGrid">
            <i class="fas fa-plus"></i>
            Add to Photos
          </button>
        </div>
        <div
          class="frames-preview-grid"
          :class="{ 'frames-preview-grid--expanded': showAllPreviewFrames }"
        >
          <button
            v-for="frame in previewFrames"
            :key="frame.index"
            type="button"
            class="preview-frame"
            :aria-label="`Preview frame at ${formatTimestamp(frame.timestamp)}`"
            @click="openFramePreview(frame.index)"
          >
            <img
              :src="getFramePreviewUrl(frame)"
              :alt="`Frame ${frame.index + 1}`"
              loading="lazy"
              decoding="async"
              draggable="false"
            />
            <span class="frame-time">{{ formatTimestamp(frame.timestamp) }}</span>
          </button>
          <button
            v-if="hiddenPreviewCount > 0 && !showAllPreviewFrames"
            type="button"
            class="more-frames"
            :aria-label="`Show ${hiddenPreviewCount} more frames`"
            @click="showAllPreviewFrames = true"
          >
            +{{ hiddenPreviewCount }} more
          </button>
        </div>
        <button
          v-if="showAllPreviewFrames && hiddenPreviewCount > 0"
          type="button"
          class="show-less-frames"
          @click="showAllPreviewFrames = false"
        >
          Show less
        </button>
      </div>

      <ExtractedFramePreviewModal
        :show="previewFrameIndex !== null"
        :frames="extractedFrames"
        :current-index="previewFrameIndex ?? 0"
        :get-frame-url="getFramePreviewUrl"
        :format-timestamp="formatTimestamp"
        @close="closeFramePreview"
        @navigate="previewFrameIndex = $event"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';
import { useVideoExtraction, type ExtractedFrameFile } from '../composables/useVideoExtraction';
import ExtractedFramePreviewModal from './ExtractedFramePreviewModal.vue';
import VideoTrimmer from './VideoTrimmer.vue';
import {
  VIDEO_EXTRACTION_CHUNK_SIZE,
  VIDEO_EXTRACTION_CHUNK_SIZE_PNG,
} from '../constants/optimization';

const emit = defineEmits<{
  (e: 'frames-extracted', frames: File[]): void;
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
  formatDuration,
  extractionEtaLabel,
} = useVideoExtraction();

const fileInputRef = ref<HTMLInputElement | null>(null);
const videoRef = ref<HTMLVideoElement | null>(null);
const isDragOver = ref(false);
const framePreviewUrls = ref<Map<number, string>>(new Map());
const previewFrameIndex = ref<number | null>(null);
const showAllPreviewFrames = ref(false);
const isPreviewingClip = ref(false);

const displayVideoInfo = computed(() => {
  if (videoInfo.value && videoInfo.value.duration > 0) {
    return videoInfo.value;
  }
  return null;
});

const canGenerate = computed(() => {
  return Boolean(displayVideoInfo.value && estimatedFrameCount.value > 0);
});

const estimatedBatchCount = computed(() => {
  if (estimatedFrameCount.value <= 0) return 0;
  const chunkSize = outputFormat.value === 'jpeg'
    ? VIDEO_EXTRACTION_CHUNK_SIZE
    : VIDEO_EXTRACTION_CHUNK_SIZE_PNG;
  return Math.ceil(estimatedFrameCount.value / chunkSize);
});

const PREVIEW_FRAME_LIMIT = 6;

const intervalPresets = [
  { label: '0.05s', value: 50 },
  { label: '0.1s', value: 100 },
  { label: '0.5s', value: 500 },
  { label: '1s', value: 1000 },
  { label: '2s', value: 2000 },
  { label: '3s', value: 3000 }
];

const previewFrames = computed(() => {
  if (showAllPreviewFrames.value) {
    return extractedFrames.value;
  }
  return extractedFrames.value.slice(0, PREVIEW_FRAME_LIMIT);
});

const hiddenPreviewCount = computed(() => {
  return Math.max(0, extractedFrames.value.length - PREVIEW_FRAME_LIMIT);
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
  framePreviewUrls.value.clear();
}

function openFramePreview(index: number) {
  if (index < 0 || index >= extractedFrames.value.length) return;
  previewFrameIndex.value = index;
}

function closeFramePreview() {
  previewFrameIndex.value = null;
}

function stopClipPreview(): void {
  isPreviewingClip.value = false;
  const video = videoRef.value;
  if (video && !video.paused) {
    video.pause();
  }
}

function seekVideoPreview(time: number): void {
  stopClipPreview();
  const video = videoRef.value;
  if (!video) return;
  video.currentTime = Math.max(0, Math.min(time, video.duration || time));
}

async function toggleClipPreview(): Promise<void> {
  const video = videoRef.value;
  if (!video || clipDuration.value <= 0) return;

  if (isPreviewingClip.value) {
    stopClipPreview();
    return;
  }

  isPreviewingClip.value = true;
  video.currentTime = trimStart.value;
  try {
    await video.play();
  } catch {
    stopClipPreview();
  }
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

function clearVideo() {
  stopClipPreview();
  closeFramePreview();
  clearFramePreviewUrls();
  showAllPreviewFrames.value = false;
  void reset();
}

async function handleDownloadTrim(): Promise<void> {
  stopClipPreview();
  await downloadTrimmedVideo();
}

async function handleExtract() {
  stopClipPreview();
  closeFramePreview();
  clearFramePreviewUrls();
  showAllPreviewFrames.value = false;

  await startExtraction();
}

function getFramePreviewUrl(frame: ExtractedFrameFile): string {
  if (!framePreviewUrls.value.has(frame.index)) {
    const url = URL.createObjectURL(frame.file);
    framePreviewUrls.value.set(frame.index, url);
  }
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
    case 'loading': return 'Loading FFmpeg...';
    case 'extracting': return 'Extracting Frames...';
    case 'processing': return 'Processing...';
    case 'complete': return 'Complete';
    case 'error': return 'Error';
    default: return phase;
  }
}

function handleAddToGrid() {
  const files = extractedFrames.value.map(frame => frame.file);
  emit('frames-extracted', files);

  closeFramePreview();
  clearFramePreviewUrls();
  showAllPreviewFrames.value = false;

  void reset();
}

onMounted(async () => {
  const restored = await restoreSession();
  if (restored) {
    await nextTick();
    syncVideoMetadata();
  }
});

onUnmounted(() => {
  stopClipPreview();
  if (metadataRetryTimer) {
    clearTimeout(metadataRetryTimer);
    metadataRetryTimer = null;
  }
  closeFramePreview();
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
  text-align: center;
  margin-top: 28px;
  margin-bottom: 8px;
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
  bottom: 0;
  left: 0;
  right: 0;
  padding: 20px;
  background: linear-gradient(transparent, rgba(0, 0, 0, 0.8));
}

.video-name {
  font-size: 1rem;
  font-weight: 500;
  color: #fff;
  margin-bottom: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.video-meta {
  display: flex;
  gap: 20px;
}

.meta-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.85rem;
  color: rgba(255, 255, 255, 0.7);
}

.meta-item i {
  font-size: 0.8rem;
  opacity: 0.7;
}

.clear-video-btn {
  position: absolute;
  top: 12px;
  right: 12px;
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
  background: rgba(99, 102, 241, 0.1);
  border: 1px solid rgba(99, 102, 241, 0.2);
  border-radius: 10px;
  color: #a5b4fc;
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
}

.estimated-frames strong {
  color: #fff;
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

.progress-frames {
  margin-top: 10px;
  font-size: 0.85rem;
  color: rgba(255, 255, 255, 0.5);
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
  position: sticky;
  bottom: 24px;
  z-index: 2;
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
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
  flex-wrap: wrap;
  gap: 16px;
}

.extracted-header h3 {
  margin: 0;
  font-size: 1rem;
  color: #4ade80;
  display: flex;
  align-items: center;
  gap: 8px;
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

.add-to-grid-btn:hover {
  background: rgba(34, 197, 94, 0.3);
  border-color: rgba(34, 197, 94, 0.6);
  transform: translateY(-1px);
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

.frames-preview-grid--expanded::-webkit-scrollbar {
  width: 8px;
}

.frames-preview-grid--expanded::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.15);
  border-radius: 4px;
}

.show-less-frames {
  display: block;
  width: 100%;
  margin-top: 12px;
  padding: 8px 16px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.65);
  font-size: 0.85rem;
  cursor: pointer;
  transition: background 0.2s ease, color 0.2s ease;
}

.show-less-frames:hover {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.9);
}

.show-less-frames:focus-visible {
  outline: 2px solid rgba(212, 175, 55, 0.8);
  outline-offset: 2px;
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

.more-frames {
  display: flex;
  align-items: center;
  justify-content: center;
  aspect-ratio: 16/9;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px dashed rgba(255, 255, 255, 0.2);
  color: rgba(255, 255, 255, 0.6);
  font-size: 0.9rem;
  cursor: pointer;
  transition: background 0.2s ease, border-color 0.2s ease, color 0.2s ease;
}

.more-frames:hover {
  background: rgba(212, 175, 55, 0.12);
  border-color: rgba(212, 175, 55, 0.35);
  color: rgba(255, 255, 255, 0.85);
}

.more-frames:focus-visible {
  outline: 2px solid rgba(212, 175, 55, 0.8);
  outline-offset: 2px;
}

/* Responsive */
@media (max-width: 768px) {
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

  .extracted-header {
    flex-direction: column;
    align-items: stretch;
  }

  .add-to-grid-btn {
    justify-content: center;
  }
}

@media (max-width: 480px) {
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
