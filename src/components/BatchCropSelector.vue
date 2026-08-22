<template>
  <Teleport to="body">
    <div v-if="show" class="modal-background" @click="$emit('close')">
      <div class="modal-content" @click.stop>
        <h2 class="modal-title">{{ modalTitle }}</h2>
      <p class="modal-description">
        {{ modeDescription }}
      </p>
      <div v-if="isObjectCropMode" class="object-pad-row">
        <label for="batch-object-pad">Padding around object</label>
        <input
          id="batch-object-pad"
          v-model.number="objectPadPx"
          type="number"
          min="0"
          max="500"
          step="1"
          class="object-pad-input"
          @change="onObjectPadChange"
        />
        <span>px</span>
        <button
          v-if="samModelCached"
          type="button"
          class="remove-model-btn"
          :disabled="samModelRemoving"
          title="Delete the object finder from this browser"
          @click="showRemoveSamConfirm = true"
        >
          Remove model
        </button>
      </div>
      <div class="mode-group" role="radiogroup" aria-label="Batch crop mode">
        <button
          v-for="option in modeOptions"
          :key="option.value"
          type="button"
          class="mode-btn"
          role="radio"
          :aria-checked="selectedMode === option.value"
          :class="{
            'mode-btn--active': selectedMode === option.value,
            'mode-btn--dev': option.inDevelopment,
          }"
          :disabled="
            option.inDevelopment ||
            (option.needsDetection && !detectionSupported) ||
            (option.value === 'this-person' && !identitySupportedByBrowser)
          "
          :title="option.disabledReason"
          @click="selectMode(option.value)"
        >
          {{ option.label }}
          <span v-if="option.inDevelopment" class="mode-badge">In development</span>
        </button>
      </div>
      <p v-if="!detectionSupported" class="mode-hint">
        Follow subject and This person need a browser that supports face detection.
      </p>
      <p
        v-else-if="isThisPersonMode"
        class="mode-hint mode-hint--legend"
      >
        <span class="legend legend--auto">Auto</span>
        <span class="legend legend--manual">Manual</span>
        — click images to add or remove references (max {{ maxRefs }}).
      </p>

      <div
        v-if="isThisPersonMode"
        class="ref-strip"
        role="list"
        aria-label="Selected reference images"
      >
        <div
          v-for="entry in referenceEntries"
          :key="`${entry.origin}-${entry.photoIndex}`"
          class="ref-strip__item"
          :class="
            entry.origin === 'auto'
              ? 'ref-strip__item--auto'
              : 'ref-strip__item--manual'
          "
          role="listitem"
        >
          <img
            :src="urlForPhotoIndex(entry.photoIndex)"
            :alt="`Reference ${entry.photoIndex}`"
            class="ref-strip__img"
          />
          <button
            type="button"
            class="ref-strip__remove"
            title="Remove reference"
            aria-label="Remove reference"
            @click.stop="removeReference(entry.photoIndex)"
          >
            <i class="fas fa-xmark" aria-hidden="true"></i>
          </button>
        </div>
        <p v-if="referenceEntries.length === 0" class="ref-strip__empty">
          No references yet — auto picks will appear here, or click images below.
        </p>
      </div>

      <div class="thumbnail-grid">
        <div
          v-for="(index, idx) in imageIndices"
          :key="index"
          class="thumbnail-item"
          :class="thumbnailItemClass(index)"
          @click="isTrimBarsMode || isObjectCropMode ? undefined : selectImage(index)"
        >
          <div class="thumbnail-wrapper">
            <img
              :src="thumbnailUrls[idx]"
              :alt="`Image ${idx + 1}`"
              class="thumbnail-image"
            />
            <div
              v-if="selectionOrigin(index)"
              class="selected-overlay"
              :class="
                selectionOrigin(index) === 'auto'
                  ? 'selected-overlay--auto'
                  : 'selected-overlay--manual'
              "
            >
              <i class="fas fa-check-circle"></i>
            </div>
          </div>
          <div class="thumbnail-label">Image {{ idx + 1 }}</div>
        </div>
      </div>
      <div class="modal-actions">
        <button @click="$emit('close')" class="cancel-button">Cancel</button>
        <button
          @click="confirmSelection"
          :disabled="!canConfirm"
          class="confirm-button"
        >
          {{ confirmLabel }}
        </button>
      </div>
    </div>
  </div>
  </Teleport>
  <ObjectModelConsent
    :show="showSamConsent"
    @choose="onSamConsentChoose"
    @cancel="showSamConsent = false"
  />
  <ConfirmDialog
    :show="showRemoveSamConfirm"
    title="Remove object finder?"
    message="This deletes the downloaded model from this browser. Crop to object will download it again the next time you use it."
    confirm-label="Remove"
    cancel-label="Keep"
    variant="danger"
    @confirm="onRemoveSamModel"
    @cancel="showRemoveSamConfirm = false"
  />
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted } from "vue";
import type {
  BatchCropMode,
  BatchCropSelectPayload,
  IdentityReferenceOrigin,
} from "../types/batchCrop";
import { loadBatchCropMode, saveBatchCropMode } from "../utils/batchCropMode";
import {
  isDetectionSupported,
  preloadDetectionRuntime,
  preloadIdentityRuntime,
} from "../utils/subjectDetection";
import { preloadObjectCropRuntime } from "../utils/objectCrop";
import ObjectModelConsent from "./ObjectModelConsent.vue";
import ConfirmDialog from "./ConfirmDialog.vue";
import {
  acceptSamModelConsent,
  deleteSamModelFromDevice,
  hasSamConsentThisSession,
  isSamModelCached,
  needsSamModelConsent,
  type SamRetention,
} from "../utils/samModelCache";
import { subscribeSamDownloadProgress } from "../utils/samModelDownload";
import {
  loadObjectCropPadPx,
  saveObjectCropPadPx,
} from "../utils/objectCropPad";
import { clampObjectPadPx } from "../utils/objectMaskCrop";
import { identityWorkerPool } from "../utils/identityWorkerPool";
import {
  autoReferenceSampleCount,
  sampleEvenlySpacedIndices,
} from "../utils/identityAutoMultiView";
import { IDENTITY_REF_GALLERY_MAX } from "../constants/optimization";

interface ReferenceEntry {
  photoIndex: number;
  origin: IdentityReferenceOrigin;
}

const props = defineProps<{
  show: boolean;
  imageIndices: number[];
  photos: Array<{ original: File }>;
}>();

const emit = defineEmits<{
  (e: "select", payload: BatchCropSelectPayload): void;
  (e: "close"): void;
}>();

const selectedIndex = ref<number | null>(null);
const referenceEntries = ref<ReferenceEntry[]>([]);
const thumbnailUrls = ref<string[]>([]);
const detectionSupported = isDetectionSupported();
const identitySupportedByBrowser =
  typeof Worker !== "undefined" && typeof createImageBitmap !== "undefined";
/** Optimistic until a real (non-transient) warmup failure while the modal is open. */
const identityAvailable = ref(identitySupportedByBrowser);
const identityLoading = ref(false);
const storedBatchMode = loadBatchCropMode();
const selectedMode = ref<BatchCropMode>(
  storedBatchMode === "crop-to-object" ||
    (!detectionSupported &&
      (storedBatchMode === "follow-subject" || storedBatchMode === "this-person"))
    ? "same-box"
    : storedBatchMode
);

const maxRefs = IDENTITY_REF_GALLERY_MAX;
const isThisPersonMode = computed(() => selectedMode.value === "this-person");
const isTrimBarsMode = computed(() => selectedMode.value === "trim-bars");
const isObjectCropMode = computed(() => selectedMode.value === "crop-to-object");
const objectPadPx = ref(loadObjectCropPadPx());
const showSamConsent = ref(false);
const showRemoveSamConfirm = ref(false);
const samModelCached = ref(false);
const samModelRemoving = ref(false);

const modeOptions = computed(() => [
  { value: "same-box" as const, label: "Same crop box", needsDetection: false },
  {
    value: "follow-subject" as const,
    label: "Follow subject",
    needsDetection: true,
    disabledReason: detectionSupported
      ? "Find the person in each photo"
      : "Detection is not supported in this browser",
  },
  {
    value: "this-person" as const,
    label: "This person",
    needsDetection: true,
    disabledReason: !detectionSupported
      ? "Detection is not supported in this browser"
      : !identitySupportedByBrowser
        ? "Face matching is not supported in this browser"
        : identityLoading.value
          ? "Loading face matching…"
          : !identityAvailable.value
            ? "Face matching failed to load — click to retry"
            : "Lock onto the person across frames",
  },
  {
    value: "crop-to-object" as const,
    label: "Crop to object",
    needsDetection: false,
    inDevelopment: true,
    disabledReason: "Batch crop to object is in development",
  },
  {
    value: "trim-bars" as const,
    label: "Remove Letterboxing",
    needsDetection: false,
    disabledReason: "Remove letterbox and pillarbox padding from each photo",
  },
]);

const modalTitle = computed(() => {
  if (isThisPersonMode.value) return "Select Reference Images";
  if (isTrimBarsMode.value) return "Remove Letterboxing";
  if (isObjectCropMode.value) return "Crop To Object";
  return "Select Template Image";
});

const modeDescription = computed(() => {
  const count = props.imageIndices.length;
  if (selectedMode.value === "follow-subject") {
    return `Choose a template, then pick a crop target. Each of the ${count} photos will be cropped around its own subject.`;
  }
  if (selectedMode.value === "this-person") {
    return `Auto-picks ${autoReferenceSampleCount(count)} evenly spaced frames (white). Click more frames to add manual refs (yellow), then continue to set the crop target.`;
  }
  if (selectedMode.value === "trim-bars") {
    return `Each of the ${count} selected photos will be scanned for letterbox or pillarbox padding — the black bands editors add when a photo is too small for the frame — and cropped to the real picture.`;
  }
  if (selectedMode.value === "crop-to-object") {
    return `Each of the ${count} photos is read one at a time with the Tiny object finder, then cropped around the main subject with ${objectPadPx.value}px padding. Tiny is the only size we use for batches — Base and Large are hundreds of megabytes and too slow or memory-heavy. For busy shots with many objects, crop one photo at a time and draw a box around the target.`;
  }
  return `Choose an image to use as the template for batch cropping. The crop box from this image will be applied to all ${count} selected images.`;
});

const confirmLabel = computed(() => {
  if (isThisPersonMode.value) return "Continue";
  if (isTrimBarsMode.value) return "Remove Letterboxing";
  if (isObjectCropMode.value) return "Crop To Object";
  return "Use This Image";
});

const canConfirm = computed(() => {
  if (isTrimBarsMode.value || isObjectCropMode.value) {
    return props.imageIndices.length > 0;
  }
  if (isThisPersonMode.value) {
    return referenceEntries.value.length >= 1;
  }
  return selectedIndex.value !== null;
});

const selectionOriginMap = computed(() => {
  const map = new Map<number, IdentityReferenceOrigin>();
  for (const entry of referenceEntries.value) {
    map.set(entry.photoIndex, entry.origin);
  }
  return map;
});

function selectionOrigin(
  photoIndex: number
): IdentityReferenceOrigin | null {
  if (isThisPersonMode.value) {
    return selectionOriginMap.value.get(photoIndex) ?? null;
  }
  return selectedIndex.value === photoIndex ? "manual" : null;
}

function thumbnailItemClass(photoIndex: number): Record<string, boolean> {
  const origin = selectionOrigin(photoIndex);
  return {
    selected: origin != null,
    "selected--auto": origin === "auto",
    "selected--manual": origin === "manual",
    "thumbnail-item--static": isTrimBarsMode.value || isObjectCropMode.value,
  };
}

function urlForPhotoIndex(photoIndex: number): string {
  const idx = props.imageIndices.indexOf(photoIndex);
  if (idx >= 0 && thumbnailUrls.value[idx]) {
    return thumbnailUrls.value[idx];
  }
  return "";
}

function seedAutoReferences() {
  const count = autoReferenceSampleCount(props.imageIndices.length);
  const sampled = sampleEvenlySpacedIndices(props.imageIndices, count);
  referenceEntries.value = sampled.map((photoIndex) => ({
    photoIndex,
    origin: "auto" as const,
  }));
}

function clearReferences() {
  referenceEntries.value = [];
}

async function preloadForMode(mode: BatchCropMode) {
  if (mode === "same-box" || mode === "trim-bars") return;
  if (mode === "crop-to-object") {
    if (hasSamConsentThisSession()) {
      void preloadObjectCropRuntime();
    }
    return;
  }
  void preloadDetectionRuntime();
  if (mode !== "this-person") return;

  const stillOpen = () => props.show;
  identityWorkerPool.resetLoadFailure();
  identityLoading.value = true;
  try {
    await preloadIdentityRuntime();
    if (!stillOpen()) return;
    identityAvailable.value = true;
  } catch {
    if (!stillOpen()) return;
    identityAvailable.value = false;
    if (selectedMode.value === "this-person") {
      selectedMode.value = "follow-subject";
      saveBatchCropMode("follow-subject");
      clearReferences();
    }
  } finally {
    if (stillOpen()) identityLoading.value = false;
  }
}

function selectMode(mode: BatchCropMode) {
  const option = modeOptions.value.find((item) => item.value === mode);
  if (option?.inDevelopment) return;
  if (option?.needsDetection && !detectionSupported) return;
  selectedMode.value = mode;
  saveBatchCropMode(mode);
  selectedIndex.value = null;
  if (mode === "this-person") {
    seedAutoReferences();
  } else {
    clearReferences();
  }
  void preloadForMode(mode);
}

watch(
  [() => props.show, () => props.imageIndices],
  ([newShow, newIndices]) => {
    if (newShow && newIndices.length > 0) {
      thumbnailUrls.value.forEach((url) => URL.revokeObjectURL(url));
      thumbnailUrls.value = newIndices.map((index) =>
        URL.createObjectURL(props.photos[index].original)
      );
      selectedIndex.value = null;
      identityWorkerPool.resetLoadFailure();
      identityAvailable.value = identitySupportedByBrowser;
      if (selectedMode.value === "this-person") {
        seedAutoReferences();
      } else {
        clearReferences();
      }
      if (selectedMode.value !== "same-box" && selectedMode.value !== "trim-bars") {
        void preloadForMode(selectedMode.value);
      }
      void refreshSamModelCached();
    }
  },
  { immediate: true }
);

onUnmounted(() => {
  thumbnailUrls.value.forEach((url) => URL.revokeObjectURL(url));
});

watch(
  () => props.show,
  (newShow) => {
    if (!newShow) {
      thumbnailUrls.value.forEach((url) => URL.revokeObjectURL(url));
      thumbnailUrls.value = [];
      selectedIndex.value = null;
      clearReferences();
    }
  }
);

const selectImage = (index: number) => {
  if (!isThisPersonMode.value) {
    selectedIndex.value = index;
    return;
  }

  const existing = referenceEntries.value.findIndex(
    (entry) => entry.photoIndex === index
  );
  if (existing >= 0) {
    referenceEntries.value = referenceEntries.value.filter(
      (_, i) => i !== existing
    );
    return;
  }
  if (referenceEntries.value.length >= maxRefs) {
    referenceEntries.value = [
      ...referenceEntries.value.slice(1),
      { photoIndex: index, origin: "manual" },
    ];
    return;
  }
  referenceEntries.value = [
    ...referenceEntries.value,
    { photoIndex: index, origin: "manual" },
  ];
};

const removeReference = (photoIndex: number) => {
  referenceEntries.value = referenceEntries.value.filter(
    (entry) => entry.photoIndex !== photoIndex
  );
};

function onObjectPadChange() {
  objectPadPx.value = clampObjectPadPx(objectPadPx.value);
  saveObjectCropPadPx(objectPadPx.value);
}

function emitObjectCrop() {
  const pad = clampObjectPadPx(objectPadPx.value);
  objectPadPx.value = pad;
  saveObjectCropPadPx(pad);
  emit("select", {
    mode: selectedMode.value,
    templateIndex: props.imageIndices[0] ?? 0,
    objectPadPx: pad,
  });
}

async function confirmObjectCrop() {
  if (await needsSamModelConsent()) {
    showSamConsent.value = true;
    return;
  }
  emitObjectCrop();
}

function onSamConsentChoose(retention: SamRetention) {
  acceptSamModelConsent(retention);
  showSamConsent.value = false;
  emitObjectCrop();
}

async function refreshSamModelCached() {
  samModelCached.value = await isSamModelCached();
}

async function onRemoveSamModel() {
  showRemoveSamConfirm.value = false;
  if (samModelRemoving.value) return;
  samModelRemoving.value = true;
  try {
    await deleteSamModelFromDevice();
    samModelCached.value = false;
  } finally {
    samModelRemoving.value = false;
  }
}

const confirmSelection = () => {
  saveBatchCropMode(selectedMode.value);
  if (isTrimBarsMode.value) {
    emit("select", {
      mode: selectedMode.value,
      templateIndex: props.imageIndices[0] ?? 0,
    });
    return;
  }
  if (isObjectCropMode.value) {
    void confirmObjectCrop();
    return;
  }
  if (isThisPersonMode.value) {
    if (referenceEntries.value.length < 1) return;
    const referencePhotoIndices = referenceEntries.value.map(
      (entry) => entry.photoIndex
    );
    emit("select", {
      mode: selectedMode.value,
      templateIndex: referencePhotoIndices[0],
      referencePhotoIndices,
    });
    return;
  }
  if (selectedIndex.value !== null) {
    emit("select", {
      mode: selectedMode.value,
      templateIndex: selectedIndex.value,
    });
  }
};

const handleEsc = (event: KeyboardEvent) => {
  if (event.key !== "Escape" || !props.show) return;
  if (showRemoveSamConfirm.value) {
    showRemoveSamConfirm.value = false;
    return;
  }
  if (showSamConsent.value) {
    showSamConsent.value = false;
    return;
  }
  emit("close");
};

let unsubscribeSamDownload: (() => void) | null = null;

onMounted(() => {
  window.addEventListener("keydown", handleEsc);
  unsubscribeSamDownload = subscribeSamDownloadProgress((next) => {
    if (!next) void refreshSamModelCached();
  });
  void refreshSamModelCached();
});

onUnmounted(() => {
  unsubscribeSamDownload?.();
  unsubscribeSamDownload = null;
  window.removeEventListener("keydown", handleEsc);
});
</script>

<style scoped>
.modal-background {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  padding: env(safe-area-inset-top, 0px) env(safe-area-inset-right, 0px)
    env(safe-area-inset-bottom, 0px) env(safe-area-inset-left, 0px);
  box-sizing: border-box;
  background: rgba(0, 0, 0, 0.85);
  backdrop-filter: blur(8px);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1600;
}

.modal-content {
  background: var(--surface-color);
  border: 1px solid var(--surface-border);
  border-radius: var(--border-radius);
  padding: 32px;
  width: 90vw;
  max-width: 1000px;
  max-height: 85dvh;
  display: flex;
  flex-direction: column;
  gap: 20px;
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}

.modal-title {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 600;
  color: var(--text-primary);
}

.modal-description {
  margin: 0;
  color: var(--text-secondary);
  font-size: 0.95rem;
  line-height: 1.5;
}

.object-pad-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.object-pad-row label {
  font-size: 0.95rem;
  color: var(--text-secondary);
}

.object-pad-input {
  width: 72px;
  padding: 6px 8px;
  border-radius: 8px;
  border: 1px solid var(--surface-border);
  background: var(--surface-color);
  color: var(--text-primary);
}

.remove-model-btn {
  padding: 6px 12px;
  border-radius: 8px;
  border: 1px solid rgba(239, 68, 68, 0.4);
  background: rgba(239, 68, 68, 0.12);
  color: #fca5a5;
  font-size: 0.82rem;
  font-weight: 500;
  cursor: pointer;
}

.remove-model-btn:disabled {
  opacity: 0.55;
  cursor: wait;
}

.mode-group {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.mode-btn {
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 14px;
  border-radius: var(--border-radius-sm);
  border: 1px solid var(--surface-border);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 0.8125rem;
  font-weight: 600;
}

.mode-btn--active {
  background: rgba(255, 255, 255, 0.16);
  color: var(--text-primary);
  border-color: #aaa;
}

.mode-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.mode-btn--dev:disabled {
  opacity: 1;
  color: rgba(255, 255, 255, 0.42);
}

.mode-badge {
  font-size: 0.62rem;
  font-weight: 700;
  line-height: 1;
  padding: 3px 6px;
  border-radius: 999px;
  background: rgba(234, 88, 12, 0.28);
  border: 1px solid rgba(249, 115, 22, 0.75);
  color: #fb923c;
  white-space: nowrap;
}

.mode-hint {
  margin: 0;
  font-size: 0.8rem;
  color: var(--text-secondary);
}

.mode-hint--legend {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.legend {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
  font-size: 0.75rem;
}

.legend::before {
  content: "";
  width: 10px;
  height: 10px;
  border-radius: 2px;
  border: 2px solid currentColor;
}

.legend--auto {
  color: #fff;
}

.legend--manual {
  color: #f5d76e;
}

.ref-strip {
  display: flex;
  flex-wrap: nowrap;
  gap: 10px;
  overflow-x: auto;
  padding: 4px 2px 8px;
  min-height: 72px;
  scrollbar-width: thin;
  border-bottom: 1px solid var(--surface-border);
}

.ref-strip__item {
  position: relative;
  flex: 0 0 auto;
  width: 64px;
  height: 64px;
  border-radius: 8px;
  overflow: hidden;
  border: 2px solid transparent;
}

.ref-strip__item--auto {
  border-color: #fff;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.35);
}

.ref-strip__item--manual {
  border-color: #f5d76e;
  box-shadow: 0 0 0 1px rgba(245, 215, 110, 0.45);
}

.ref-strip__img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.ref-strip__remove {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: none;
  background: rgba(0, 0, 0, 0.75);
  color: #fff;
  font-size: 10px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.ref-strip__empty {
  margin: 0;
  align-self: center;
  font-size: 0.8rem;
  color: var(--text-secondary);
  white-space: nowrap;
  padding: 0 4px;
}

.thumbnail-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 16px;
  overflow-y: auto;
  padding: 8px;
  flex: 1;
  min-height: 0;
}

.thumbnail-item {
  cursor: pointer;
  transition: transform 0.2s ease;
}

.thumbnail-item:hover {
  transform: scale(1.05);
}

.thumbnail-item--static {
  cursor: default;
}

.thumbnail-item--static:hover {
  transform: none;
}

.thumbnail-item.selected {
  transform: scale(1.05);
}

.thumbnail-wrapper {
  position: relative;
  width: 100%;
  aspect-ratio: 1;
  border-radius: var(--border-radius-sm);
  overflow: hidden;
  border: 2px solid transparent;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

.thumbnail-item.selected--auto .thumbnail-wrapper {
  border-color: #fff;
  box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.3);
}

.thumbnail-item.selected--manual .thumbnail-wrapper {
  border-color: #f5d76e;
  box-shadow: 0 0 0 2px rgba(245, 215, 110, 0.35);
}

.thumbnail-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.selected-overlay {
  position: absolute;
  top: 8px;
  right: 8px;
  background: rgba(0, 0, 0, 0.7);
  border-radius: 50%;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
}

.selected-overlay--auto {
  color: #fff;
}

.selected-overlay--manual {
  color: #f5d76e;
}

.thumbnail-label {
  margin-top: 8px;
  text-align: center;
  font-size: 0.875rem;
  color: var(--text-secondary);
  font-weight: 500;
}

.modal-actions {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
  padding-top: 16px;
  border-top: 1px solid var(--surface-border);
}

.cancel-button,
.confirm-button {
  padding: 10px 24px;
  border-radius: var(--border-radius-sm);
  border: 1px solid var(--surface-border);
  background: var(--surface-color);
  color: var(--text-primary);
  cursor: pointer;
  font-size: 0.875rem;
  font-weight: 500;
  transition: all var(--transition-fast);
}

.cancel-button:hover {
  background: rgba(255, 255, 255, 0.1);
  border-color: var(--surface-border);
}

.confirm-button {
  background: rgba(255, 255, 255, 0.15);
  border-color: #888;
}

.confirm-button:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.25);
  border-color: #aaa;
}

.confirm-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

@media (max-width: 1023px) {
  .modal-background {
    padding: 0;
    align-items: stretch;
    justify-content: stretch;
  }

  .modal-content {
    width: 100dvw;
    height: 100dvh;
    max-width: none;
    max-height: none;
    border-radius: 0;
    padding: calc(16px + env(safe-area-inset-top, 0px))
      calc(16px + env(safe-area-inset-right, 0px))
      calc(16px + env(safe-area-inset-bottom, 0px))
      calc(16px + env(safe-area-inset-left, 0px));
  }

  .thumbnail-grid {
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: 12px;
  }

  .modal-title {
    font-size: 1.25rem;
  }

  .modal-actions {
    flex-direction: column-reverse;
  }

  .cancel-button,
  .confirm-button {
    width: 100%;
    min-height: 44px;
  }
}

@media (max-width: 599px) {
  .thumbnail-grid {
    grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
    gap: 10px;
  }
}
</style>
