<template>
  <Teleport to="body">
    <div v-if="show" class="modal-background" @click="$emit('close')">
      <div class="modal-content" @click.stop>
      <div
        class="cropper-wrapper"
        ref="cropperWrapper"
        :class="{
          dragging: isDragging,
          'cropper-wrapper--mark': objectMarkMode,
        }"
      >
        <div
          v-if="suggestionLoading || trimLoading || objectCropLoading"
          class="suggestion-overlay"
          role="status"
          aria-live="polite"
        >
          <i class="fas fa-spinner fa-spin" aria-hidden="true"></i>
          <span>{{ objectCropStatusLabel }}</span>
        </div>
        <Cropper
          ref="cropper"
          :key="`cropper-${imageSrc}-${initialRotation || 0}`"
          :src="currentImageSrc"
          :default-size="fullImageDefaultSize"
          :transitions="!isRadialDragging"
          :stencil-props="{
            aspectRatio: selectedAspectRatio,
            movable: true,
            scalable: true,
          }"
          @ready="onCropperReady"
        />
        <canvas
          v-show="objectMarkMode"
          ref="objectDrawCanvas"
          class="object-draw-overlay"
          aria-hidden="true"
          @pointerdown.prevent="onObjectDrawPointerDown"
          @pointermove.prevent="onObjectDrawPointerMove"
          @pointerup.prevent="onObjectDrawPointerUp"
          @pointercancel.prevent="onObjectDrawPointerUp"
        />
        <canvas
          ref="objectOverlayCanvas"
          class="object-mask-overlay"
          :class="{ 'object-mask-overlay--hidden': !objectMaskVisible }"
          aria-hidden="true"
        />
        <div
          v-if="objectMarkerStyle"
          class="object-marker"
          :style="objectMarkerStyle"
          aria-hidden="true"
        />
        <!-- Arrow navigation (same-box batch only) -->
        <button
          v-if="showBatchNav"
          class="nav-arrow nav-arrow-left"
          @click="$emit('previous-image')"
          :disabled="currentBatchIndex === 0"
          title="Previous image"
        >
          <i class="fas fa-chevron-left"></i>
        </button>
        <button
          v-if="showBatchNav"
          class="nav-arrow nav-arrow-right"
          @click="$emit('next-image')"
          :disabled="currentBatchIndex === (totalBatchCount ?? 1) - 1"
          title="Next image"
        >
          <i class="fas fa-chevron-right"></i>
        </button>
        <p
          v-if="cropperStatusText"
          class="cropper-status"
          :class="{ 'cropper-status--error': cropperStatusIsError }"
          role="status"
        >
          {{ cropperStatusText }}
        </p>
      </div>
      <div class="controls">
        <div class="tool-categories" role="tablist" aria-label="Edit tools">
          <button
            type="button"
            role="tab"
            class="tool-category"
            :class="{ 'tool-category--active': activeToolPanel === 'crop' }"
            :aria-selected="activeToolPanel === 'crop'"
            title="Crop"
            aria-label="Crop"
            @click="setToolPanel('crop')"
          >
            <i class="fas fa-crop-simple" aria-hidden="true"></i>
          </button>
          <button
            v-if="objectCropSupported"
            type="button"
            role="tab"
            class="tool-category"
            :class="{ 'tool-category--active': activeToolPanel === 'object' }"
            :aria-selected="activeToolPanel === 'object'"
            title="Object"
            aria-label="Object"
            @click="setToolPanel('object')"
          >
            <i class="fas fa-expand" aria-hidden="true"></i>
          </button>
          <button
            type="button"
            role="tab"
            class="tool-category"
            :class="{ 'tool-category--active': activeToolPanel === 'rotate' }"
            :aria-selected="activeToolPanel === 'rotate'"
            title="Rotate"
            aria-label="Rotate"
            @click="setToolPanel('rotate')"
          >
            <i class="fas fa-rotate" aria-hidden="true"></i>
          </button>
        </div>
        <button
          v-show="showUninstallModel"
          type="button"
          class="action-uninstall"
          :disabled="objectCropLoading || samModelRemoving"
          title="Delete the object finder from this browser"
          @click="showRemoveSamConfirm = true"
        >
          Uninstall model
        </button>

        <div class="tool-stage">
          <div
            v-show="activeToolPanel === 'crop'"
            class="tool-panel tool-panel--crop"
            :class="{ 'tool-panel--crop-simple': !detectionSupported }"
            role="tabpanel"
          >
            <div class="crop-panel-slot crop-panel-slot--aspect">
              <div class="aspect-ratio-grid" role="radiogroup" aria-label="Aspect ratio">
                <button
                  v-for="option in aspectRatioOptions"
                  :key="option.label"
                  type="button"
                  class="aspect-ratio-btn"
                  role="radio"
                  :aria-checked="selectedAspectRatio === option.value"
                  :class="{ 'aspect-ratio-btn--active': selectedAspectRatio === option.value }"
                  @click="selectedAspectRatio = option.value"
                >
                  {{ option.label }}
                </button>
              </div>
            </div>
            <div
              v-if="detectionSupported"
              class="crop-panel-divider"
              aria-hidden="true"
            />
            <div
              v-if="detectionSupported"
              class="crop-panel-slot crop-panel-slot--targets"
            >
              <div
                class="crop-target-group"
                role="radiogroup"
                aria-label="Crop target"
              >
                <button
                  v-for="option in cropTargetOptions"
                  :key="option.value"
                  type="button"
                  class="crop-target-btn"
                  role="radio"
                  :aria-checked="selectedCropTarget === option.value"
                  :class="{ 'crop-target-btn--active': selectedCropTarget === option.value }"
                  :disabled="suggestionLoading"
                  :title="option.label"
                  :aria-label="option.label"
                  @click="selectCropTarget(option.value)"
                >
                  <i :class="option.icon" aria-hidden="true"></i>
                </button>
              </div>
            </div>
            <div class="crop-panel-divider" aria-hidden="true" />
            <div class="crop-panel-slot crop-panel-slot--trim">
              <button
                type="button"
                :disabled="trimLoading || suggestionLoading || objectCropLoading"
                title="Remove letterbox and pillarbox padding"
                @click="trimBlackBars"
              >
                Remove Letterboxing
              </button>
            </div>
          </div>

          <div v-show="activeToolPanel === 'object'" class="tool-panel tool-panel--object" role="tabpanel">
            <button
              type="button"
              :disabled="trimLoading || suggestionLoading || objectCropLoading || !objectCropSupported"
              title="Drag a box around an object. First use downloads a local model."
              @click="cropToObject"
            >
              Box Outline
            </button>
            <label class="object-pad-label" for="object-pad">
              Padding
              <input
                id="object-pad"
                v-model.number="objectPadPx"
                type="number"
                min="0"
                max="500"
                step="1"
                class="object-pad-input"
                :disabled="objectCropLoading"
                @change="onObjectPadChange"
              />
              px
            </label>
          </div>

          <div
            v-show="activeToolPanel === 'rotate'"
            class="tool-panel tool-panel--rotate"
            role="tabpanel"
          >
            <button
              type="button"
              class="control-icon-btn"
              title="Rotate left"
              aria-label="Rotate left"
              @click="rotate(-90)"
            >
              <i class="fas fa-rotate-left" aria-hidden="true"></i>
            </button>
            <div
              class="rotate-radial"
              role="slider"
              tabindex="0"
              aria-label="Rotate"
              :aria-valuemin="FINE_ROTATE_MIN"
              :aria-valuemax="FINE_ROTATE_MAX"
              :aria-valuenow="Math.round(fineRotation)"
              :aria-valuetext="`${fineRotationLabel} degrees`"
              @pointerdown.stop="onRadialPointerDown"
              @pointermove="onRadialPointerMove"
              @pointerup="onRadialPointerUp"
              @pointercancel="onRadialPointerUp"
              @wheel.prevent="onRadialWheel"
              @keydown="onRadialKeydown"
            >
              <div class="rotate-radial__value">{{ fineRotationLabel }}°</div>
              <svg
                class="rotate-radial__svg"
                :viewBox="`0 0 ${RADIAL_VIEW_W} ${RADIAL_VIEW_H}`"
                aria-hidden="true"
              >
                <path class="rotate-radial__arc" :d="radialArcPath" fill="none" />
                <g v-for="tick in radialTicks" :key="tick.angle">
                  <line
                    :x1="tick.x1"
                    :y1="tick.y1"
                    :x2="tick.x2"
                    :y2="tick.y2"
                    class="rotate-radial__tick"
                    :class="{ 'rotate-radial__tick--major': tick.major }"
                  />
                  <text
                    v-if="tick.major"
                    :x="tick.labelX"
                    :y="tick.labelY"
                    class="rotate-radial__label"
                    text-anchor="middle"
                    dominant-baseline="middle"
                    :opacity="tick.labelOpacity"
                  >
                    {{ tick.angle }}
                  </text>
                </g>
                <polygon
                  class="rotate-radial__indicator"
                  :points="radialIndicatorPoints"
                />
              </svg>
            </div>
            <button
              type="button"
              class="control-icon-btn"
              title="Rotate right"
              aria-label="Rotate right"
              @click="rotate(90)"
            >
              <i class="fas fa-rotate-right" aria-hidden="true"></i>
            </button>
          </div>
        </div>

        <div class="actions">
          <button type="button" class="action-crop" @click="cropImage" :disabled="!canConfirmSmartCrop">
            Crop
          </button>
          <button type="button" class="action-reset" @click="reset">Reset</button>
          <button type="button" class="action-cancel" @click="$emit('close')">Cancel</button>
        </div>
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
    title="Uninstall object finder?"
    message="This deletes the downloaded model from this browser. Box Outline will download it again the next time you use it."
    confirm-label="Uninstall"
    cancel-label="Keep"
    variant="danger"
    @confirm="onRemoveSamModel"
    @cancel="showRemoveSamConfirm = false"
  />
</template>

<script setup lang="ts">
import { Cropper } from "vue-advanced-cropper";
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from "vue";
import "vue-advanced-cropper/dist/style.css";
import type { CropTarget } from "../types/detection";
import type {
  BatchCropMode,
  BatchCropRecipe,
  IdentityReferenceFace,
} from "../types/batchCrop";
import { detectLetterboxFromUrl } from "../utils/letterboxDetect";
import {
  detectObjectFromUrl,
  isObjectCropSupported,
  preloadObjectCropImage,
  preloadObjectCropRuntime,
} from "../utils/objectCrop";
import ObjectModelConsent from "./ObjectModelConsent.vue";
import ConfirmDialog from "./ConfirmDialog.vue";
import {
  acceptSamModelConsent,
  deleteSamModelFromDevice,
  isSamModelCached,
  needsSamModelConsent,
  type SamRetention,
} from "../utils/samModelCache";
import { subscribeSamDownloadProgress } from "../utils/samModelDownload";
import {
  getSamProgressStage,
  samStatusLabel,
  subscribeSamProgress,
  type SamProgressStage,
} from "../utils/webSamSession";
import {
  clampObjectPadPx,
  padCropBox,
  buildMaskOverlayRgba,
  normalizeNormalizedBox,
  type NormalizedKeypoint,
} from "../utils/objectMaskCrop";
import {
  loadObjectCropPadPx,
  saveObjectCropPadPx,
} from "../utils/objectCropPad";
import type { SegmentMaskPayload } from "../utils/interactiveSegmenterSession";

// Type alias to extend Cropper instance with custom methods and properties
type CropperInstance = InstanceType<typeof Cropper> & {
  $el?: HTMLElement;
  getResult: () => {
    canvas: HTMLCanvasElement | undefined;
    coordinates?: { left: number; top: number; width: number; height: number };
  };
  rotate: (angle: number) => void;
  reset: () => void;
  setCoordinates: (coords: {
    left: number;
    top: number;
    width: number;
    height: number;
  }) => void;
  stencilCoordinates: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
  updateBoundaries: () => void;
  image: HTMLImageElement | null;
  visibleArea?: {
    width: number;
    height: number;
    left: number;
    top: number;
  };
  imageSize?: {
    width: number;
    height: number;
  };
};

const {
  show,
  imageSrc,
  initialCrop,
  initialRotation,
  suggestedCrop,
  suggestionLoading,
  suggestionError,
  suggestionNoSubject,
  detectionSupported,
  batchMode,
  currentBatchIndex,
  totalBatchCount,
  batchCropMode = "same-box",
  referenceFaces = [],
} = defineProps<{
  show: boolean;
  imageSrc: string;
  initialCrop?: { x: number; y: number; width: number; height: number };
  initialRotation?: number;
  suggestedCrop?: { x: number; y: number; width: number; height: number } | null;
  suggestionLoading?: boolean;
  suggestionError?: string | null;
  suggestionNoSubject?: boolean;
  detectionSupported?: boolean;
  batchMode?: boolean;
  currentBatchIndex?: number;
  totalBatchCount?: number;
  batchCropMode?: BatchCropMode;
  referenceFaces?: IdentityReferenceFace[];
}>();

const emit = defineEmits<{
  (
    e: "cropped",
    blob: Blob,
    crop: { x: number; y: number; width: number; height: number },
    rotation: number,
    recipe?: BatchCropRecipe
  ): void;
  (e: "close"): void;
  (e: "next-image"): void;
  (e: "previous-image"): void;
  (e: "request-suggest", target: CropTarget): void;
  (e: "cancel-suggest"): void;
}>();

const cropper = ref<CropperInstance | null>(null);
const cropperWrapper = ref<HTMLElement | null>(null);
type CropToolPanel = "crop" | "object" | "rotate";

const selectedAspectRatio = ref<number | null>(null);
const selectedCropTarget = ref<CropTarget | null>(null);
const activeToolPanel = ref<CropToolPanel>("crop");
const aspectRatioOptions: { value: number | null; label: string }[] = [
  { value: null, label: "Free" },
  { value: 1, label: "1:1" },
  { value: 4 / 3, label: "4:3" },
  { value: 16 / 9, label: "16:9" },
];
const cropTargetOptions: { value: CropTarget; label: string; icon: string }[] = [
  { value: 'full-body', label: 'Full body', icon: 'fas fa-person' },
  { value: 'upper-body', label: 'Upper body', icon: 'fas fa-user' },
  { value: 'lower-body', label: 'Lower body', icon: 'fas fa-shoe-prints' },
  { value: 'head-shoulders', label: 'Head and shoulders', icon: 'fas fa-portrait' },
  { value: 'head', label: 'Head', icon: 'fas fa-face-smile' },
];
const currentImageSrc = ref<string>(imageSrc);
const trimLoading = ref(false);
const trimMessage = ref<string | null>(null);
const trimFailed = ref(false);
const objectCropLoading = ref(false);
const objectCropMessage = ref<string | null>(null);
const objectCropFailed = ref(false);
const objectMarkMode = ref(false);
const objectPadPx = ref(loadObjectCropPadPx());
const objectCropSupported = isObjectCropSupported();
const lastObjectBbox = ref<{ x: number; y: number; width: number; height: number } | null>(null);
const lastObjectKeypoint = ref<NormalizedKeypoint | null>(null);
const lastObjectMask = ref<SegmentMaskPayload | null>(null);
const objectOverlayCanvas = ref<HTMLCanvasElement | null>(null);
const objectDrawCanvas = ref<HTMLCanvasElement | null>(null);
const objectMaskVisible = ref(false);
const objectMarkerStyle = ref<Record<string, string> | null>(null);
const objectStrokePoints = ref<NormalizedKeypoint[]>([]);
const objectDrawing = ref(false);
const objectOverlayThreshold = ref(0.35);
const showSamConsent = ref(false);
const showRemoveSamConfirm = ref(false);
const samModelCached = ref(false);
const samModelRemoving = ref(false);
const showUninstallModel = computed(
  () => activeToolPanel.value === "object" && samModelCached.value
);
const samProgressStage = ref<SamProgressStage>(getSamProgressStage());
const isDragging = ref(false); // Track if stencil is being dragged (for iOS-style overlay)
const isRadialDragging = ref(false);

const isSmartBatchMode = computed(
  () =>
    Boolean(batchMode) &&
    (batchCropMode === "follow-subject" || batchCropMode === "this-person")
);
const isThisPersonMode = computed(
  () => Boolean(batchMode) && batchCropMode === "this-person"
);
const showBatchNav = computed(
  () =>
    Boolean(batchMode) &&
    batchCropMode === "same-box" &&
    Boolean(totalBatchCount && totalBatchCount > 1)
);
const canConfirmSmartCrop = computed(() => {
  if (!isSmartBatchMode.value) return true;
  if (!selectedCropTarget.value) return false;
  if (isThisPersonMode.value && referenceFaces.length < 1) return false;
  return true;
});
const cropperStatusText = computed(() => {
  if (suggestionError) return suggestionError;
  if (trimMessage.value) return trimMessage.value;
  if (objectMarkMode.value && objectMarkHint.value) return objectMarkHint.value;
  if (objectCropMessage.value && !objectMarkMode.value) return objectCropMessage.value;
  if (suggestionNoSubject) return "No subject detected — adjust stencil manually.";
  return smartModeHint.value || null;
});
const cropperStatusIsError = computed(
  () => Boolean(suggestionError) || trimFailed.value || objectCropFailed.value
);

function setToolPanel(panel: CropToolPanel) {
  activeToolPanel.value = panel;
  if (panel !== "object" && objectMarkMode.value) {
    objectMarkMode.value = false;
    clearObjectDrawCanvas();
  }
}

const smartModeHint = computed(() => {
  if (!isSmartBatchMode.value) return "";
  if (!selectedCropTarget.value) {
    return "Choose a crop target before applying to the batch.";
  }
  if (isThisPersonMode.value && referenceFaces.length < 1) {
    return "No reference faces available. Go back and pick reference images.";
  }
  if (batchCropMode === "follow-subject") {
    return "Each selected photo will be cropped around its own subject.";
  }
  return `Matching ${referenceFaces.length} reference${referenceFaces.length === 1 ? "" : "s"} across the batch.`;
});

const FINE_ROTATE_MIN = -45;
const FINE_ROTATE_MAX = 45;
const RADIAL_VIEW_W = 480;
const RADIAL_VIEW_H = 44;
const RADIAL_VISIBLE_SPAN = 32;
const RADIAL_CX = RADIAL_VIEW_W / 2;
const RADIAL_SAGITTA = 11;
const RADIAL_HALF_W = RADIAL_VIEW_W / 2 - 8;
const RADIAL_R =
  (RADIAL_HALF_W * RADIAL_HALF_W + RADIAL_SAGITTA * RADIAL_SAGITTA) /
  (2 * RADIAL_SAGITTA);
const RADIAL_ARC_SPAN =
  (Math.asin(RADIAL_HALF_W / RADIAL_R) * 180) / Math.PI;
const RADIAL_VISUAL_SCALE = RADIAL_ARC_SPAN / RADIAL_VISIBLE_SPAN;
const RADIAL_CY = RADIAL_VIEW_H - 0.5 + RADIAL_R - RADIAL_SAGITTA;
const RADIAL_ARC_Y = RADIAL_CY - RADIAL_R;
const RADIAL_PX_PER_DEGREE = 6;

function radialPoint(relative: number): { x: number; y: number; sin: number; cos: number } {
  const rad = (relative * RADIAL_VISUAL_SCALE * Math.PI) / 180;
  const sin = Math.sin(rad);
  const cos = Math.cos(rad);
  return {
    x: RADIAL_CX + RADIAL_R * sin,
    y: RADIAL_CY - RADIAL_R * cos,
    sin,
    cos,
  };
}

function normalize360(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

function splitRotation(total: number): { base: number; fine: number } {
  const n = normalize360(total);
  let nearest = Math.round(n / 90) * 90;
  let fine = n - nearest;
  if (fine > 45) {
    nearest += 90;
    fine -= 90;
  } else if (fine < -45) {
    nearest -= 90;
    fine += 90;
  }
  return { base: normalize360(nearest), fine };
}

const initialSplit = splitRotation(initialRotation || 0);
const baseRotation = ref(initialSplit.base);
const fineRotation = ref(initialSplit.fine);
const currentRotation = computed(() =>
  normalize360(baseRotation.value + fineRotation.value)
);
const fineRotationLabel = computed(() => String(Math.round(fineRotation.value) || 0));

let appliedRotation = currentRotation.value;

function applySplit(total: number): void {
  const { base, fine } = splitRotation(total);
  baseRotation.value = base;
  fineRotation.value = fine;
}

function shortestAngleDelta(from: number, to: number): number {
  let delta = normalize360(to) - normalize360(from);
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  return delta;
}

function syncCropperRotation(): void {
  if (!cropper.value) return;
  const target = currentRotation.value;
  const delta = shortestAngleDelta(appliedRotation, target);
  if (Math.abs(delta) < 0.001) {
    appliedRotation = target;
    return;
  }
  cropper.value.rotate(delta);
  appliedRotation = target;
}

function setFineRotation(next: number): void {
  fineRotation.value = Math.min(FINE_ROTATE_MAX, Math.max(FINE_ROTATE_MIN, next));
  syncCropperRotation();
}

type RadialTick = {
  angle: number;
  major: boolean;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  labelX: number;
  labelY: number;
  labelOpacity: number;
};

function radialLabelOpacity(relative: number): number {
  const distance = Math.abs(relative);
  if (distance < 5) return 0;
  const fadeStart = RADIAL_VISIBLE_SPAN * 0.4;
  const fadeEnd = RADIAL_VISIBLE_SPAN * 0.95;
  if (distance <= fadeStart) return 1;
  if (distance >= fadeEnd) return 0;
  const t = (distance - fadeStart) / (fadeEnd - fadeStart);
  return 1 - t * t;
}

const radialTicks = computed<RadialTick[]>(() => {
  const ticks: RadialTick[] = [];
  for (let angle = FINE_ROTATE_MIN; angle <= FINE_ROTATE_MAX; angle += 2) {
    const relative = angle - fineRotation.value;
    if (Math.abs(relative) > RADIAL_VISIBLE_SPAN) continue;
    const { x, y, sin, cos } = radialPoint(relative);
    const major = angle % 10 === 0;
    const tickLen = major ? 8 : 4;
    ticks.push({
      angle,
      major,
      x1: x,
      y1: y,
      x2: x + sin * tickLen,
      y2: y - cos * tickLen,
      labelX: x + sin * 18,
      labelY: y - cos * 18,
      labelOpacity: major ? radialLabelOpacity(relative) : 1,
    });
  }
  return ticks;
});

const radialIndicatorPoints = `${RADIAL_CX},${RADIAL_ARC_Y + 1} ${RADIAL_CX + 6},${RADIAL_ARC_Y - 10} ${RADIAL_CX - 6},${RADIAL_ARC_Y - 10}`;

const radialArcPath = computed(() => {
  const span = RADIAL_VISIBLE_SPAN - 1;
  const start = radialPoint(-span);
  const end = radialPoint(span);
  return `M ${start.x} ${start.y} A ${RADIAL_R} ${RADIAL_R} 0 0 1 ${end.x} ${end.y}`;
});

let radialPointerId: number | null = null;
let radialDragStartX = 0;
let radialDragStartFine = 0;

function onRadialPointerDown(event: PointerEvent): void {
  radialPointerId = event.pointerId;
  radialDragStartX = event.clientX;
  radialDragStartFine = fineRotation.value;
  isRadialDragging.value = true;
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
}

function onRadialPointerMove(event: PointerEvent): void {
  if (!isRadialDragging.value || event.pointerId !== radialPointerId) return;
  const dx = event.clientX - radialDragStartX;
  setFineRotation(radialDragStartFine + dx / RADIAL_PX_PER_DEGREE);
}

function onRadialPointerUp(event: PointerEvent): void {
  if (event.pointerId !== radialPointerId) return;
  isRadialDragging.value = false;
  radialPointerId = null;
  if (Math.abs(fineRotation.value) < 0.35) {
    setFineRotation(0);
  }
}

function onRadialWheel(event: WheelEvent): void {
  const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
  setFineRotation(fineRotation.value + delta / 20);
}

function onRadialKeydown(event: KeyboardEvent): void {
  if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
    event.preventDefault();
    setFineRotation(fineRotation.value - (event.shiftKey ? 5 : 1));
  } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
    event.preventDefault();
    setFineRotation(fineRotation.value + (event.shiftKey ? 5 : 1));
  } else if (event.key === "Home" || event.key === "0") {
    event.preventDefault();
    setFineRotation(0);
  }
}

function selectCropTarget(target: CropTarget) {
  selectedCropTarget.value = target;
  selectedAspectRatio.value = null;
  trimMessage.value = null;
  trimFailed.value = false;
  emit('request-suggest', target);
}

function clearTrimStatus() {
  trimMessage.value = null;
  trimFailed.value = false;
  trimLoading.value = false;
}

function clearObjectCropUi() {
  objectCropMessage.value = null;
  objectCropFailed.value = false;
  objectCropLoading.value = false;
  objectMarkMode.value = false;
  objectDrawing.value = false;
  objectStrokePoints.value = [];
  lastObjectBbox.value = null;
  lastObjectKeypoint.value = null;
  lastObjectMask.value?.overlayBitmap?.close();
  lastObjectMask.value = null;
  objectMaskVisible.value = false;
  objectMarkerStyle.value = null;
  clearObjectDrawCanvas();
  const canvas = objectOverlayCanvas.value;
  if (canvas) {
    const ctx = canvas.getContext("2d");
    ctx?.clearRect(0, 0, canvas.width, canvas.height);
  }
}

function clearObjectDrawCanvas() {
  const canvas = objectDrawCanvas.value;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
}

const objectMarkHint = computed(() => {
  if (currentRotation.value !== 0) {
    return "Reset rotation, then draw around the object you want to crop.";
  }
  return "Drag a box around the object. Any corner works — left-to-right or right-to-left.";
});

const objectCropStatusLabel = computed(() => {
  if (objectCropLoading.value) {
    return samStatusLabel(samProgressStage.value, "Finding object...");
  }
  if (trimLoading.value) return "Finding black bars...";
  return "Finding target...";
});

interface ImageAreaMapping {
  destX: number;
  destY: number;
  destW: number;
  destH: number;
}

function resolveCropperImageElement(): HTMLImageElement | HTMLCanvasElement | null {
  const image = cropper.value?.image as unknown;
  if (image instanceof HTMLImageElement || image instanceof HTMLCanvasElement) {
    return image;
  }
  const cropperEl = (cropper.value as { $el?: HTMLElement } | null)?.$el;
  if (!cropperEl) return null;
  return (
    cropperEl.querySelector<HTMLImageElement>(".vue-advanced-cropper__image") ??
    cropperEl.querySelector<HTMLImageElement | HTMLCanvasElement>("img, canvas")
  );
}

function getImageAreaMapping(): ImageAreaMapping | null {
  const wrapper = cropperWrapper.value;
  const inst = cropper.value;
  if (!wrapper || !inst) return null;

  const wrapperRect = wrapper.getBoundingClientRect();
  const imageEl = resolveCropperImageElement();
  if (imageEl) {
    const imageRect = imageEl.getBoundingClientRect();
    if (imageRect.width > 8 && imageRect.height > 8) {
      return {
        destX: imageRect.left - wrapperRect.left,
        destY: imageRect.top - wrapperRect.top,
        destW: imageRect.width,
        destH: imageRect.height,
      };
    }
  }

  const va = inst.visibleArea;
  const imageSize = inst.imageSize;
  if (va && imageSize?.width && imageSize?.height && va.width > 0 && va.height > 0) {
    const scale = Math.min(
      wrapperRect.width / va.width,
      wrapperRect.height / va.height
    );
    const viewW = va.width * scale;
    const viewH = va.height * scale;
    return {
      destX: (wrapperRect.width - viewW) / 2 - va.left * scale,
      destY: (wrapperRect.height - viewH) / 2 - va.top * scale,
      destW: imageSize.width * scale,
      destH: imageSize.height * scale,
    };
  }

  return {
    destX: 0,
    destY: 0,
    destW: wrapperRect.width,
    destH: wrapperRect.height,
  };
}

function syncObjectDrawCanvas() {
  const canvas = objectDrawCanvas.value;
  const wrapper = cropperWrapper.value;
  if (!canvas || !wrapper) return;

  const wrapperRect = wrapper.getBoundingClientRect();
  canvas.width = Math.max(1, Math.round(wrapperRect.width));
  canvas.height = Math.max(1, Math.round(wrapperRect.height));
  canvas.style.width = `${wrapperRect.width}px`;
  canvas.style.height = `${wrapperRect.height}px`;
  redrawObjectStroke();
}

function clientToNormalized(
  clientX: number,
  clientY: number,
  clamp = false
): NormalizedKeypoint | null {
  if (!cropper.value || currentRotation.value !== 0) return null;
  const wrapper = cropperWrapper.value;
  const mapping = getImageAreaMapping();
  if (!wrapper || !mapping || mapping.destW <= 0 || mapping.destH <= 0) return null;

  const wrapperRect = wrapper.getBoundingClientRect();
  const localX = clientX - wrapperRect.left;
  const localY = clientY - wrapperRect.top;
  const relX = (localX - mapping.destX) / mapping.destW;
  const relY = (localY - mapping.destY) / mapping.destH;
  if (!clamp && (relX < 0 || relX > 1 || relY < 0 || relY > 1)) return null;

  return {
    x: Math.min(1, Math.max(0, relX)),
    y: Math.min(1, Math.max(0, relY)),
  };
}

function normalizedToCanvasPoint(point: NormalizedKeypoint): { x: number; y: number } | null {
  const mapping = getImageAreaMapping();
  if (!mapping) return null;
  return {
    x: mapping.destX + point.x * mapping.destW,
    y: mapping.destY + point.y * mapping.destH,
  };
}

function redrawObjectStroke() {
  const canvas = objectDrawCanvas.value;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const points = objectStrokePoints.value;
  if (points.length < 2) return;
  const box = normalizeNormalizedBox(points[0], points[points.length - 1]);
  if (!box) return;
  const tl = normalizedToCanvasPoint({ x: box.x, y: box.y });
  const br = normalizedToCanvasPoint({
    x: box.x + box.width,
    y: box.y + box.height,
  });
  if (!tl || !br) return;

  ctx.strokeStyle = "rgba(232, 201, 106, 0.95)";
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
  ctx.setLineDash([]);
  ctx.fillStyle = "rgba(232, 201, 106, 0.12)";
  ctx.fillRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
}

function onObjectDrawPointerDown(event: PointerEvent) {
  if (!objectMarkMode.value || objectCropLoading.value || currentRotation.value !== 0) return;
  const point = clientToNormalized(event.clientX, event.clientY, true);
  if (!point) return;

  objectDrawing.value = true;
  objectStrokePoints.value = [point];
  objectDrawCanvas.value?.setPointerCapture(event.pointerId);
  syncObjectDrawCanvas();
  redrawObjectStroke();
}

function onObjectDrawPointerMove(event: PointerEvent) {
  if (!objectDrawing.value || !objectMarkMode.value) return;
  const point = clientToNormalized(event.clientX, event.clientY, true);
  if (!point) return;

  const start = objectStrokePoints.value[0];
  if (!start) return;
  objectStrokePoints.value = [start, point];
  redrawObjectStroke();
}

async function onObjectDrawPointerUp(event: PointerEvent) {
  if (!objectDrawing.value) return;
  objectDrawing.value = false;
  objectDrawCanvas.value?.releasePointerCapture(event.pointerId);

  const points = objectStrokePoints.value;
  const box =
    points.length >= 2
      ? normalizeNormalizedBox(points[0], points[points.length - 1])
      : null;
  if (!box) {
    objectCropMessage.value = "Drag a larger box around the object and release.";
    objectCropFailed.value = true;
    return;
  }

  await runObjectDetection({ box });
}

function applyObjectPadToStencil() {
  if (!lastObjectBbox.value) return;
  const img = cropper.value?.image;
  const naturalWidth = img?.naturalWidth ?? cropper.value?.imageSize?.width;
  const naturalHeight = img?.naturalHeight ?? cropper.value?.imageSize?.height;
  if (!naturalWidth || !naturalHeight) return;
  const padded = padCropBox(
    lastObjectBbox.value,
    naturalWidth,
    naturalHeight,
    objectPadPx.value
  );
  applyCoordinatesToCropper(padded, false);
}

async function updateObjectOverlay() {
  const wrapper = cropperWrapper.value;
  const mask = lastObjectMask.value;
  if (!wrapper || !mask || !cropper.value) {
    objectMaskVisible.value = false;
    return;
  }

  objectMaskVisible.value = true;
  await nextTick();

  const canvas = objectOverlayCanvas.value;
  if (!canvas) return;

  const wrapperRect = wrapper.getBoundingClientRect();
  canvas.width = Math.max(1, Math.round(wrapperRect.width));
  canvas.height = Math.max(1, Math.round(wrapperRect.height));
  canvas.style.width = `${wrapperRect.width}px`;
  canvas.style.height = `${wrapperRect.height}px`;

  const mapping = getImageAreaMapping();
  if (!mapping) {
    objectMaskVisible.value = false;
    return;
  }

  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  const destX = mapping.destX;
  const destY = mapping.destY;
  const destW = mapping.destW;
  const destH = mapping.destH;

  const overlay = buildMaskOverlayRgba(
    mask.confidenceMask,
    mask.maskWidth,
    mask.maskHeight,
    mask.overlayThreshold ?? objectOverlayThreshold.value,
    mask.componentMask
  );
  const offscreen = document.createElement("canvas");
  offscreen.width = mask.maskWidth;
  offscreen.height = mask.maskHeight;
  const offCtx = offscreen.getContext("2d");
  if (!offCtx) return;
  offCtx.putImageData(new ImageData(overlay, mask.maskWidth, mask.maskHeight), 0, 0);

  ctx.save();
  ctx.beginPath();
  ctx.rect(destX, destY, destW, destH);
  ctx.clip();
  ctx.drawImage(offscreen, destX, destY, destW, destH);
  ctx.restore();

  if (lastObjectKeypoint.value) {
    objectMarkerStyle.value = {
      left: `${mapping.destX + lastObjectKeypoint.value.x * mapping.destW - 8}px`,
      top: `${mapping.destY + lastObjectKeypoint.value.y * mapping.destH - 8}px`,
    };
  }
}

async function runObjectDetection(options: {
  keypoint?: NormalizedKeypoint;
  scribble?: NormalizedKeypoint[];
  box?: { x: number; y: number; width: number; height: number };
} = {}) {
  if (!currentImageSrc.value || objectCropLoading.value) return;
  objectCropLoading.value = true;
  objectCropMessage.value = null;
  objectCropFailed.value = false;

  try {
    await preloadObjectCropRuntime();
    const pad = clampObjectPadPx(objectPadPx.value);
    objectPadPx.value = pad;
    saveObjectCropPadPx(pad);

    const detectOptions = {
      keypoint: options.keypoint,
      scribble: options.scribble,
      box: options.box,
      padPx: pad,
    };
    const result = await detectObjectFromUrl(currentImageSrc.value, detectOptions);
    if (!result) {
      objectCropMessage.value =
        "Could not find that object — drag a tighter box around it and try again.";
      objectCropFailed.value = true;
      objectMarkMode.value = true;
      objectMaskVisible.value = false;
      objectMarkerStyle.value = null;
      await nextTick();
      syncObjectDrawCanvas();
      return;
    }

    emit("cancel-suggest");
    selectedCropTarget.value = null;
    selectedAspectRatio.value = null;
    lastObjectBbox.value = { ...result.bbox };
    lastObjectKeypoint.value = { ...result.keypoint };
    lastObjectMask.value?.overlayBitmap?.close();
    lastObjectMask.value = result.mask;
    objectOverlayThreshold.value = result.mask?.overlayThreshold ?? 0;
    objectMarkMode.value = false;
    clearObjectDrawCanvas();
    await nextTick();
    applyCoordinatesToCropper(result.padded, false);
    await nextTick();
    await updateObjectOverlay();
    requestAnimationFrame(() => {
      void updateObjectOverlay();
    });
    objectCropMessage.value =
      pad > 0
        ? `Object found with ${pad}px padding. Click Box Outline to mark a different one.`
        : "Object found. Click Box Outline to mark a different one.";
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      objectCropMessage.value = "Object finder download cancelled.";
      objectCropFailed.value = true;
      return;
    }
    console.error("Crop to object failed:", error);
    objectCropMessage.value = "Could not detect an object in this image.";
    objectCropFailed.value = true;
    objectMarkMode.value = true;
    await nextTick();
    syncObjectDrawCanvas();
  } finally {
    objectCropLoading.value = false;
  }
}

async function enterObjectMarkMode() {
  clearTrimStatus();
  clearObjectCropUi();
  objectMarkMode.value = true;
  objectCropMessage.value = null;
  objectCropFailed.value = false;
  setFullImageCoordinates();
  void preloadObjectCropRuntime()
    .then(() => {
      if (currentImageSrc.value) {
        void preloadObjectCropImage(currentImageSrc.value);
      }
    })
    .catch((error) => {
      if (error instanceof DOMException && error.name === "AbortError") return;
      console.error("Object finder failed to load:", error);
    });
  await nextTick();
  syncObjectDrawCanvas();
}

async function cropToObject() {
  activeToolPanel.value = "object";
  if (currentRotation.value !== 0) {
    objectCropMessage.value = "Reset rotation before marking an object.";
    objectCropFailed.value = true;
    return;
  }
  if (await needsSamModelConsent()) {
    showSamConsent.value = true;
    return;
  }
  await enterObjectMarkMode();
}

function onSamConsentChoose(retention: SamRetention) {
  acceptSamModelConsent(retention);
  showSamConsent.value = false;
  void enterObjectMarkMode();
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
    objectCropMessage.value = "Object finder removed from this browser.";
    objectCropFailed.value = false;
  } catch (error) {
    console.error("Failed to remove object finder:", error);
    objectCropMessage.value = "Could not remove the object finder.";
    objectCropFailed.value = true;
  } finally {
    samModelRemoving.value = false;
  }
}

function onObjectPadChange() {
  objectPadPx.value = clampObjectPadPx(objectPadPx.value);
  saveObjectCropPadPx(objectPadPx.value);
  if (lastObjectBbox.value) {
    applyObjectPadToStencil();
    objectCropMessage.value =
      objectPadPx.value > 0
        ? `Padding set to ${objectPadPx.value}px around the object.`
        : "Padding removed — crop fits the object.";
  }
}

async function trimBlackBars() {
  if (!currentImageSrc.value || trimLoading.value) return;
  clearObjectCropUi();
  trimLoading.value = true;
  trimMessage.value = null;
  trimFailed.value = false;

  try {
    const bounds = await detectLetterboxFromUrl(currentImageSrc.value);
    if (!bounds) {
      trimMessage.value = "No black bars detected — nothing to trim.";
      return;
    }
    emit("cancel-suggest");
    selectedCropTarget.value = null;
    selectedAspectRatio.value = null;
    await nextTick();
    applyCoordinatesToCropper(
      {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
      },
      false
    );
    trimMessage.value = "Black bars removed from the crop box.";
  } catch (error) {
    console.error("Trim black bars failed:", error);
    trimMessage.value = "Could not scan this image for black bars.";
    trimFailed.value = true;
  } finally {
    trimLoading.value = false;
  }
}

// Watch for changes in imageSrc and initialRotation props
watch([() => imageSrc, () => initialRotation], ([newSrc, newRotation]) => {
  currentImageSrc.value = newSrc;
  applySplit(newRotation || 0);
  appliedRotation = currentRotation.value;
  selectedCropTarget.value = null;
  activeToolPanel.value = "crop";
  clearTrimStatus();
  clearObjectCropUi();
});

// Helper function to apply rotation to the cropper
const applyRotationToCropper = (rotation: number) => {
  if (!cropper.value || !cropper.value.image) {
    console.warn("Cropper not ready for rotation");
    return;
  }

  cropper.value.reset();
  cropper.value.updateBoundaries();

  const normalizedRotation = normalize360(rotation);
  applySplit(normalizedRotation);
  if (normalizedRotation !== 0) {
    cropper.value.rotate(normalizedRotation);
  }
  cropper.value.updateBoundaries();
  appliedRotation = normalizedRotation;
};

const handleEsc = (event: KeyboardEvent) => {
  if (event.key !== "Escape") return;
  if (showSamConsent.value) {
    event.preventDefault();
    showSamConsent.value = false;
    return;
  }
  if (showRemoveSamConfirm.value) {
    event.preventDefault();
    showRemoveSamConfirm.value = false;
    return;
  }
  emit("close");
};

let unsubscribeSamProgress: (() => void) | null = null;
let unsubscribeSamDownload: (() => void) | null = null;

onMounted(() => {
  window.addEventListener("keydown", handleEsc);
  unsubscribeSamProgress = subscribeSamProgress((stage) => {
    samProgressStage.value = stage;
    if (stage === "ready") void refreshSamModelCached();
  });
  unsubscribeSamDownload = subscribeSamDownloadProgress((next) => {
    if (!next) void refreshSamModelCached();
  });
  void refreshSamModelCached();
});

onUnmounted(() => {
  unsubscribeSamProgress?.();
  unsubscribeSamProgress = null;
  unsubscribeSamDownload?.();
  unsubscribeSamDownload = null;
  window.removeEventListener("keydown", handleEsc);
  if (dragListenerCleanup) {
    dragListenerCleanup();
    dragListenerCleanup = null;
  }
  if (readyTimeoutId) {
    clearTimeout(readyTimeoutId);
    readyTimeoutId = null;
  }
  emit("cancel-suggest");
  isDragging.value = false;
});

// Setup event listeners for stencil dragging (iOS-style overlay effect)
const setupStencilDragListeners = () => {
  if (!cropper.value) return null;

  // Find the stencil element
  const cropperElement = (cropper.value as any).$el;
  if (!cropperElement) {
    console.warn("CropModal: cropperElement not found");
    return null;
  }

  // Track if we're in a drag operation
  let dragStarted = false;

  // Track mouse/touch events on handlers (resize points)
  const handleDragStart = (_e: Event) => {
    dragStarted = true;
    isDragging.value = true;
  };

  // Try to find stencil element - it might have different class names
  // vue-advanced-cropper uses vue-rectangle-stencil for rectangle stencils
  const stencilContainer = cropperElement.querySelector(
    ".vue-stencil, .vue-simple-stencil, .vue-circle-stencil, .vue-rectangle-stencil"
  );

  // Also get handlers (resize points)
  const handlers = cropperElement.querySelectorAll(
    ".vue-simple-handler, .vue-handler-wrapper, .vue-handler"
  );

  // Track mouse/touch down on stencil body to detect dragging
  const handleStencilMouseDown = (e: MouseEvent | TouchEvent) => {
    // Don't trigger if clicking on a handler (they have their own handler)
    const target = e.target as HTMLElement;
    if (
      target.closest(
        ".vue-simple-handler, .vue-handler-wrapper, .vue-handler, .vue-bounding-box__handler"
      )
    ) {
      return;
    }
    dragStarted = true;
    isDragging.value = true;
  };

  // Also listen on the entire cropper area for edge dragging
  // The stencil edges might be rendered outside the stencil container
  const handleCropperMouseDown = (e: MouseEvent | TouchEvent) => {
    const target = e.target as HTMLElement;

    // Check if clicking on handlers (exclude these)
    const handlerParent = target.closest(
      ".vue-simple-handler, .vue-handler-wrapper, .vue-handler, .vue-bounding-box__handler"
    );

    if (handlerParent) {
      // This is a handler, don't process here (handled by handleDragStart)
      return;
    }

    // Check if clicking on stencil (including rectangle-stencil) or its children
    const stencilParent = target.closest(
      ".vue-stencil, .vue-simple-stencil, .vue-circle-stencil, .vue-rectangle-stencil"
    );

    // Also check if clicking on line-wrapper elements (the edges)
    const isLineWrapper =
      target.classList.contains("vue-line-wrapper") ||
      target.classList.contains("vue-simple-line-wrapper") ||
      !!target.closest(".vue-line-wrapper, .vue-simple-line-wrapper");

    // Check if clicking inside the stencil preview area
    const isInPreview = target.closest(
      ".vue-preview, .vue-preview__wrapper, .vue-rectangle-stencil__preview"
    );

    if ((stencilParent || isLineWrapper || isInPreview) && !handlerParent) {
      if (!dragStarted) {
        dragStarted = true;
        isDragging.value = true;
      }
    }
  };

  // Track mouse/touch move to detect when dragging actually starts on stencil body
  const handleMouseMove = () => {
    if (dragStarted && !isDragging.value) {
      isDragging.value = true;
    }
  };

  const handleTouchMove = () => {
    if (dragStarted && !isDragging.value) {
      isDragging.value = true;
    }
  };

  // Listen for drag end on document
  const handleDocumentMouseUp = () => {
    if (dragStarted || isDragging.value) {
      dragStarted = false;
      isDragging.value = false;
    }
  };

  const handleDocumentTouchEnd = () => {
    if (dragStarted || isDragging.value) {
      dragStarted = false;
      isDragging.value = false;
    }
  };

  // Add listeners to stencil container (for dragging the whole stencil body/edges)
  // Use capture phase to catch events before vue-advanced-cropper handles them
  if (stencilContainer) {
    stencilContainer.addEventListener(
      "mousedown",
      handleStencilMouseDown,
      true
    );
    stencilContainer.addEventListener("touchstart", handleStencilMouseDown, {
      passive: true,
      capture: true,
    });
  }

  // Also listen on the entire cropper element to catch edge dragging
  // This ensures we catch all interactions with the stencil, including edges
  cropperElement.addEventListener("mousedown", handleCropperMouseDown, true);
  cropperElement.addEventListener("touchstart", handleCropperMouseDown, {
    passive: true,
    capture: true,
  });

  // Add event listeners to handlers (for resizing via handles)
  handlers.forEach((handler: Element) => {
    handler.addEventListener("mousedown", handleDragStart);
    handler.addEventListener("touchstart", handleDragStart, { passive: true });
  });

  // Listen for mouse/touch move to detect dragging
  document.addEventListener("mousemove", handleMouseMove);
  document.addEventListener("touchmove", handleTouchMove, { passive: true });

  // Listen for drag end on document
  document.addEventListener("mouseup", handleDocumentMouseUp);
  document.addEventListener("touchend", handleDocumentTouchEnd);
  document.addEventListener("touchcancel", handleDocumentTouchEnd);

  // Cleanup function
  return () => {
    if (stencilContainer) {
      stencilContainer.removeEventListener(
        "mousedown",
        handleStencilMouseDown,
        true
      );
      stencilContainer.removeEventListener(
        "touchstart",
        handleStencilMouseDown,
        {
          capture: true,
        } as EventListenerOptions
      );
    }
    cropperElement.removeEventListener(
      "mousedown",
      handleCropperMouseDown,
      true
    );
    cropperElement.removeEventListener("touchstart", handleCropperMouseDown, {
      capture: true,
    } as EventListenerOptions);
    handlers.forEach((handler: Element) => {
      handler.removeEventListener("mousedown", handleDragStart);
      handler.removeEventListener("touchstart", handleDragStart);
    });
    document.removeEventListener("mousemove", handleMouseMove);
    document.removeEventListener("touchmove", handleTouchMove);
    document.removeEventListener("mouseup", handleDocumentMouseUp);
    document.removeEventListener("touchend", handleDocumentTouchEnd);
    document.removeEventListener("touchcancel", handleDocumentTouchEnd);
  };
};

let dragListenerCleanup: (() => void) | null = null;
let readyTimeoutId: ReturnType<typeof setTimeout> | null = null;

type NaturalCrop = { x: number; y: number; width: number; height: number };

function mapNaturalToCropperCoords(
  natural: NaturalCrop,
  cropperInstance: CropperInstance
): NaturalCrop | null {
  const img = cropperInstance.imageSize;
  const el = cropperInstance.image;
  const naturalWidth = el?.naturalWidth ?? img?.width;
  const naturalHeight = el?.naturalHeight ?? img?.height;

  if (img && naturalWidth && naturalHeight) {
    const scaleX = img.width / naturalWidth;
    const scaleY = img.height / naturalHeight;
    return {
      x: natural.x * scaleX,
      y: natural.y * scaleY,
      width: natural.width * scaleX,
      height: natural.height * scaleY,
    };
  }

  if (el) {
    return { ...natural };
  }

  return null;
}

function resolveInitialNaturalCrop(): NaturalCrop | null {
  if (suggestedCrop) return { ...suggestedCrop };
  if (initialCrop) return { ...initialCrop };
  return null;
}

function fullImageDefaultSize({
  imageSize,
  visibleArea,
}: {
  imageSize: { width: number; height: number };
  visibleArea?: { width: number; height: number } | null;
}) {
  const area = visibleArea || imageSize;
  return {
    width: area.width,
    height: area.height,
  };
}

function setFullImageCoordinates(): {
  left: number;
  top: number;
  width: number;
  height: number;
} | null {
  if (!cropper.value) return null;

  cropper.value.setCoordinates(
    ({
      imageSize,
    }: {
      imageSize: { width: number; height: number };
    }) => ({
      left: 0,
      top: 0,
      width: imageSize.width,
      height: imageSize.height,
    })
  );
  cropper.value.updateBoundaries();
  return {
    left: 0,
    top: 0,
    width: cropper.value.imageSize?.width ?? 0,
    height: cropper.value.imageSize?.height ?? 0,
  };
}

function applyCoordinatesToCropper(
  natural: NaturalCrop | null,
  useFullFrameFallback: boolean
): { left: number; top: number; width: number; height: number } | null {
  if (!cropper.value) return null;

  cropper.value.updateBoundaries();

  if (natural) {
    const mapped = mapNaturalToCropperCoords(natural, cropper.value);
    if (mapped) {
      const coordinates = {
        left: mapped.x,
        top: mapped.y,
        width: mapped.width,
        height: mapped.height,
      };
      cropper.value.setCoordinates(coordinates);
      cropper.value.updateBoundaries();
      return coordinates;
    }
  }

  if (useFullFrameFallback) {
    return setFullImageCoordinates();
  }

  return null;
}

const applyStencilFromProps = (useFullFrameFallback = true) => {
  if (!cropper.value || !cropper.value.image) return;
  applyCoordinatesToCropper(resolveInitialNaturalCrop(), useFullFrameFallback);
};

watch(
  () => suggestedCrop,
  async (crop) => {
    if (!crop || !cropper.value?.image) return;
    await nextTick();
    applyCoordinatesToCropper({ ...crop }, false);
  }
);

const onCropperReady = () => {
  if (cropper.value && cropper.value.image) {
    // Wait for next tick to ensure cropper is fully initialized
    nextTick(() => {
      if (cropper.value && cropper.value.image) {
        // Setup drag listeners for iOS-style overlay
        if (dragListenerCleanup) {
          dragListenerCleanup();
        }
        dragListenerCleanup = setupStencilDragListeners();
        if (initialRotation !== undefined && initialRotation !== 0) {
          applyRotationToCropper(initialRotation);
        }

        readyTimeoutId = setTimeout(() => {
          applyStencilFromProps(true);
        }, 50);
      }
    });
  } else {
    console.warn("Cropper or image is undefined in onCropperReady");
  }
};

const cropImage = async () => {
  if (!canConfirmSmartCrop.value) return;
  if (cropper.value) {
    const { canvas } = cropper.value.getResult();
    if (canvas) {
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/png")
      );
      if (blob && cropper.value.image) {
        const cropperResult = cropper.value.getResult();

        // Use coordinates from getResult() which are already in natural image space
        // stencilCoordinates are in a different coordinate system (viewport/scaled)
        const resultCoordinates = (cropperResult as any).coordinates;
        const stencilCoords = cropper.value.stencilCoordinates;

        // Use coordinates from getResult() - they're already in natural image pixel space
        let naturalCoords;
        if (resultCoordinates) {
          naturalCoords = {
            x: Math.round(resultCoordinates.left),
            y: Math.round(resultCoordinates.top),
            width: Math.round(resultCoordinates.width),
            height: Math.round(resultCoordinates.height),
          };
        } else {
          // Fallback to stencilCoordinates if getResult() doesn't provide coordinates
          console.warn(
            "getResult() coordinates not available, using stencilCoordinates"
          );
          naturalCoords = {
            x: Math.round(stencilCoords.left),
            y: Math.round(stencilCoords.top),
            width: Math.round(stencilCoords.width),
            height: Math.round(stencilCoords.height),
          };
        }

        emit(
          "cropped",
          blob,
          naturalCoords,
          currentRotation.value,
          isSmartBatchMode.value
            ? {
                mode: batchCropMode,
                cropTarget: selectedCropTarget.value,
                aspectRatio: selectedAspectRatio.value,
                rotation: currentRotation.value,
                referenceFaces:
                  isThisPersonMode.value && referenceFaces.length
                    ? referenceFaces.map((face) => ({
                        ...face,
                        bbox: { ...face.bbox },
                        keypoints: face.keypoints,
                      }))
                    : undefined,
              }
            : { mode: "same-box", cropTarget: selectedCropTarget.value, aspectRatio: selectedAspectRatio.value, rotation: currentRotation.value }
        );
        emit("close");
      } else {
        console.warn("Failed to create blob in cropImage");
      }
    } else {
      console.warn("Canvas is undefined in cropImage");
    }
  }
};

const rotate = (angle: number) => {
  if (cropper.value) {
    baseRotation.value = normalize360(baseRotation.value + angle);
    const { left, top, width, height } = cropper.value.stencilCoordinates;
    const { width: imgWidth, height: imgHeight } = cropper.value.getResult()
      .canvas || {
      width: 0,
      height: 0,
    };

    const centerX = (left + width / 2) / imgWidth - 0.5;
    const centerY = (top + height / 2) / imgHeight - 0.5;

    cropper.value.rotate(angle);
    cropper.value.updateBoundaries();

    let newLeft: number, newTop: number, newWidth: number, newHeight: number;
    const newImgWidth = imgHeight;
    const newImgHeight = imgWidth;

    if (angle === 90 || angle === -270) {
      const newCenterX = centerY;
      const newCenterY = -centerX;
      newWidth = height;
      newHeight = width;
      newLeft = (newCenterX + 0.5) * newImgWidth - newWidth / 2;
      newTop = (newCenterY + 0.5) * newImgHeight - newHeight / 2;
    } else if (angle === -90 || angle === 270) {
      const newCenterX = -centerY;
      const newCenterY = centerX;
      newWidth = height;
      newHeight = width;
      newLeft = (newCenterX + 0.5) * newImgWidth - newWidth / 2;
      newTop = (newCenterY + 0.5) * newImgHeight - newHeight / 2;
    } else {
      newLeft = left;
      newTop = top;
      newWidth = width;
      newHeight = height;
    }

    newLeft = Math.max(0, Math.min(newLeft, newImgWidth - newWidth));
    newTop = Math.max(0, Math.min(newTop, newImgHeight - newHeight));

    const coordinates = {
      left: newLeft,
      top: newTop,
      width: newWidth,
      height: newHeight,
    };
    cropper.value.setCoordinates(coordinates);
    appliedRotation = currentRotation.value;
  }
};

const reset = async () => {
  if (!cropper.value?.image) {
    console.warn("Cropper or image is undefined in reset");
    return;
  }

  selectedAspectRatio.value = null;
  selectedCropTarget.value = null;
  clearTrimStatus();
  clearObjectCropUi();
  applySplit(initialRotation || 0);
  await nextTick();

  cropper.value.reset();
  await nextTick();
  if (currentRotation.value !== 0) {
    cropper.value.rotate(currentRotation.value);
  }
  appliedRotation = currentRotation.value;
  setFullImageCoordinates();
};
</script>

<style scoped>
.modal-background {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  padding: env(safe-area-inset-top, 0px) env(safe-area-inset-right, 0px) env(safe-area-inset-bottom, 0px) env(safe-area-inset-left, 0px);
  box-sizing: border-box;
  background: rgba(0, 0, 0, 0.85);
  backdrop-filter: blur(8px);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1650;
}

.modal-content {
  background: var(--surface-color);
  border: 1px solid var(--surface-border);
  border-radius: var(--border-radius);
  padding: 24px 24px 0;
  width: 92vw;
  max-width: 1200px;
  height: 88dvh;
  display: flex;
  flex-direction: column;
  gap: 16px;
  box-shadow: var(--shadow-lg);
}

.cropper-wrapper {
  flex: 1;
  min-height: 0;
  position: relative;
  width: 100%;
  border-radius: var(--border-radius-sm);
  overflow: hidden;
}

.cropper-wrapper--mark {
  cursor: crosshair;
}

.object-draw-overlay {
  position: absolute;
  inset: 0;
  z-index: 14;
  touch-action: none;
}

.object-mask-overlay {
  position: absolute;
  inset: 0;
  z-index: 12;
  pointer-events: none;
}

.object-mask-overlay--hidden {
  opacity: 0;
}

.object-marker {
  position: absolute;
  z-index: 13;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 2px solid #fff;
  background: rgba(56, 189, 248, 0.85);
  box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.35);
  pointer-events: none;
}

.object-pad-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.85);
}

.object-pad-input {
  width: 64px;
  padding: 4px 6px;
  border-radius: 6px;
  border: 1px solid var(--surface-border);
  background: rgba(0, 0, 0, 0.25);
  color: inherit;
  text-align: center;
}

:deep(.vue-advanced-cropper) {
  width: 100%;
  height: 100%;
  max-width: none;
  max-height: none;
  border-radius: var(--border-radius-sm);
  overflow: hidden;
}

/* iOS-style overlay opacity during dragging */
/* The overlay (darkened area outside crop box) is typically the foreground layer */
.cropper-wrapper:not(.dragging) :deep(.vue-advanced-cropper__foreground) {
  opacity: 0.5;
  transition: opacity 0.2s ease;
}

.cropper-wrapper.dragging :deep(.vue-advanced-cropper__foreground) {
  opacity: 1;
  transition: opacity 0.1s ease;
}

/* Also try background in case that's the overlay (fallback) */
.cropper-wrapper:not(.dragging) :deep(.vue-advanced-cropper__background) {
  opacity: 0.5;
  transition: opacity 0.2s ease;
}

.cropper-wrapper.dragging :deep(.vue-advanced-cropper__background) {
  opacity: 1;
  transition: opacity 0.1s ease;
}

:deep(.vue-preview_wrapper) {
  width: 100% !important;
  height: 100% !important;
}

:deep(.vue-preview_image) {
  max-width: none !important;
  max-height: none !important;
  transform: none !important;
}

:deep(.vue-advanced-cropper__foreground),
:deep(.vue-advanced-cropper__background) {
  max-width: none;
  max-height: none;
  width: 100%;
  height: 100%;
  object-fit: contain;
}

/* Style stencil handles/points to white */
:deep(.vue-simple-handler) {
  background-color: white !important;
  border-color: white !important;
}

:deep(.vue-simple-handler--hover) {
  background-color: rgba(255, 255, 255, 0.9) !important;
  border-color: rgba(255, 255, 255, 0.9) !important;
}

/* Style stencil edges/border to white */
:deep(.vue-rectangle-stencil) {
  border-color: white !important;
}

:deep(.vue-bounding-box) {
  border-color: white !important;
}

:deep(.vue-line-wrapper) {
  border-color: white !important;
}

:deep(.vue-simple-line-wrapper) {
  border-color: white !important;
}

.cropper-wrapper {
  position: relative;
}

.cropper-status {
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: 10px;
  z-index: 15;
  margin: 0;
  padding: 6px 10px;
  border-radius: 8px;
  text-align: center;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.88);
  background: rgba(0, 0, 0, 0.55);
  pointer-events: none;
}

.cropper-status--error {
  color: #fca5a5;
}

.crop-target-group {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

.crop-target-btn {
  width: 40px;
  min-width: 40px;
  height: 40px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
}

.crop-target-btn--active {
  background: rgba(212, 175, 55, 0.22);
  border-color: rgba(212, 175, 55, 0.5);
  color: #e8c96a;
}

.crop-target-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.suggestion-overlay {
  position: absolute;
  inset: 0;
  z-index: 10;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: rgba(0, 0, 0, 0.45);
  color: rgba(255, 255, 255, 0.92);
  font-size: 13px;
  pointer-events: none;
}

.suggestion-message {
  width: 100%;
  margin: 0;
  text-align: center;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.65);
}

.suggestion-message--error {
  color: #f87171;
}

.controls {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  grid-template-rows: repeat(3, 1fr);
  grid-template-areas:
    "cats stage actions"
    ". stage actions"
    "uninst stage actions";
  align-items: stretch;
  flex-shrink: 0;
  height: 148px;
  column-gap: 12px;
  padding: 0;
  box-sizing: border-box;
  border-top: 1px solid var(--surface-border);
}

.tool-categories {
  grid-area: cats;
  display: flex;
  align-items: center;
  align-self: center;
  gap: 6px;
}

.tool-category {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  min-width: 36px;
  height: 36px;
  padding: 0;
  border-radius: 8px;
}

.tool-category i {
  font-size: 0.85rem;
}

.tool-category--active {
  background: rgba(212, 175, 55, 0.22);
  border-color: rgba(212, 175, 55, 0.5);
  color: #e8c96a;
}

.tool-stage {
  grid-column: 2;
  grid-row: 1 / -1;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  min-height: 0;
}

.tool-panel {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-width: 0;
}

.tool-panel--crop {
  width: max-content;
  max-width: 100%;
  display: grid;
  grid-template-columns: auto auto auto auto auto;
  align-items: center;
  justify-content: center;
  justify-self: center;
  margin-inline: auto;
  column-gap: 26px;
}

.crop-panel-slot {
  display: flex;
  align-items: center;
  min-width: 0;
}

.crop-panel-slot--aspect,
.crop-panel-slot--targets,
.crop-panel-slot--trim {
  justify-content: center;
}

.crop-panel-divider {
  width: 1px;
  height: 52px;
  background: rgba(255, 255, 255, 0.85);
  flex-shrink: 0;
}

.tool-panel--crop-simple {
  grid-template-columns: auto auto auto;
}

.tool-panel--object {
  gap: 36px;
}

.tool-panel--rotate {
  flex-wrap: nowrap;
  gap: 8px;
  width: 100%;
}

.aspect-ratio-grid {
  display: grid;
  grid-template-columns: repeat(2, 52px);
  grid-template-rows: repeat(2, 28px);
  gap: 4px;
}

.aspect-ratio-btn {
  height: 28px;
  min-width: 0;
  padding: 0 4px;
  font-size: 11px;
  line-height: 1;
}

.aspect-ratio-btn--active {
  background: rgba(212, 175, 55, 0.22);
  border-color: rgba(212, 175, 55, 0.5);
  color: #e8c96a;
}

.rotate-radial {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 420px;
  max-width: calc(100% - 88px);
  flex: 0 1 auto;
  margin: 0;
  padding: 0;
  outline: none;
  cursor: ew-resize;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
}

.rotate-radial:focus-visible {
  border-radius: 8px;
  box-shadow: 0 0 0 2px rgba(212, 175, 55, 0.45);
}

.rotate-radial__value {
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.04em;
  color: rgba(255, 255, 255, 0.72);
  line-height: 1;
  margin-bottom: 0;
}

.rotate-radial__svg {
  display: block;
  width: 100%;
  height: 44px;
  overflow: hidden;
  margin-bottom: 0;
}

.rotate-radial__arc {
  stroke: rgba(255, 255, 255, 0.55);
  stroke-width: 1.25;
  stroke-dasharray: 3 4;
  stroke-linecap: round;
}

.rotate-radial__tick {
  stroke: rgba(255, 255, 255, 0.7);
  stroke-width: 1;
  stroke-linecap: round;
}

.rotate-radial__tick--major {
  stroke: #fff;
  stroke-width: 1.5;
}

.rotate-radial__label {
  fill: #fff;
  font-size: 11px;
  font-weight: 500;
  pointer-events: none;
}

.rotate-radial__indicator {
  fill: rgba(180, 180, 180, 0.95);
}

.controls label {
  font-weight: 500;
}

.control-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  min-width: 40px;
  height: 40px;
  padding: 0;
  flex-shrink: 0;
  white-space: nowrap;
}

.control-icon-btn i {
  font-size: 0.95rem;
}

.tool-panel button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.actions {
  grid-area: actions;
  display: grid;
  grid-template-rows: repeat(3, 1fr);
  align-items: center;
  width: 118px;
}

.actions button {
  width: 100%;
  height: 32px;
  min-height: 32px;
  padding: 0 12px;
  min-width: 0;
  box-sizing: border-box;
}

.action-crop {
  background: rgba(255, 255, 255, 0.15);
  border-color: #888;
}

.action-crop:hover:not(:disabled) {
  background: rgba(212, 175, 55, 0.28);
  border-color: rgba(212, 175, 55, 0.7);
  color: #e8c96a;
}

.action-cancel:hover:not(:disabled) {
  background: var(--danger-color);
  border-color: var(--danger-color);
}

.action-uninstall {
  grid-area: uninst;
  justify-self: start;
  align-self: center;
  width: max-content;
  font-size: 0.7rem;
  padding: 6px 8px;
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.2);
  color: rgba(255, 255, 255, 0.72);
}

.action-uninstall:hover:not(:disabled) {
  background: rgba(234, 88, 12, 0.28);
  border-color: rgba(249, 115, 22, 0.7);
  color: #fb923c;
}

@media (pointer: coarse) {
  :deep(.vue-simple-handler) {
    width: 18px !important;
    height: 18px !important;
  }
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
    padding: env(safe-area-inset-top, 0px) env(safe-area-inset-right, 0px) 0 env(safe-area-inset-left, 0px);
    gap: 8px;
  }

  .controls {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    height: auto;
    max-height: 42dvh;
    overflow: hidden;
    padding: 8px 12px calc(8px + env(safe-area-inset-bottom, 0px));
    gap: 8px;
  }

  .tool-categories {
    justify-content: center;
    align-self: stretch;
  }

  .tool-category {
    width: 44px;
    min-width: 44px;
    height: 44px;
  }

  .tool-stage {
    display: block;
    overflow-x: auto;
    overflow-y: hidden;
    -webkit-overflow-scrolling: touch;
  }

  .tool-panel--crop {
    display: flex;
    width: max-content;
    max-width: none;
    column-gap: 16px;
    margin-inline: 0;
  }

  .crop-panel-divider {
    height: 40px;
  }

  .rotate-radial {
    width: 100%;
    max-width: 100%;
  }

  .rotate-radial__svg {
    height: 40px;
  }

  .actions {
    display: flex;
    flex-direction: row;
    width: 100%;
    gap: 8px;
  }

  .actions button {
    flex: 1;
    height: 44px;
    min-height: 44px;
    font-size: 0.9rem;
  }

  .action-uninstall {
    justify-self: center;
    align-self: center;
  }

  :deep(.vue-advanced-cropper) {
    border-radius: 0;
  }

  .nav-arrow {
    top: 10px;
    transform: none;
    width: 36px;
    height: 36px;
  }

  .nav-arrow:hover:not(:disabled) {
    transform: scale(1.05);
  }

  .nav-arrow i {
    font-size: 14px;
  }

  .nav-arrow-left {
    left: 8px;
  }

  .nav-arrow-right {
    right: 8px;
  }
}

/* Navigation arrows */
.nav-arrow {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 48px;
  height: 48px;
  background: rgba(255, 255, 255, 0.9);
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  z-index: 10;
  transition: all 0.2s ease;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}

.nav-arrow:hover:not(:disabled) {
  background: rgba(255, 255, 255, 1);
  border-color: rgba(255, 255, 255, 0.5);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  transform: translateY(-50%) scale(1.1);
}

.nav-arrow:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.nav-arrow-left {
  left: 16px;
}

.nav-arrow-right {
  right: 16px;
}

.nav-arrow i {
  font-size: 20px;
  color: #1e1e2e;
}
</style>
