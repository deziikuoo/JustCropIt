/**
 * Hidden Edit tab — timeline state, selection, and operations.
 *
 * Owns the clip list and a dedicated UndoRedoManager instance (entirely
 * separate from photo undo). Every mutating operation goes through a
 * Command so it's undoable via the toolbar's Undo button.
 */
import { ref, computed, onUnmounted } from 'vue';
import type { Ref } from 'vue';
import { UndoRedoManager } from '../utils/undoRedo';
import type { Command } from '../utils/undoRedo';
import {
  SplitClipCommand,
  DeleteClipsCommand,
  DuplicateClipsCommand,
  SetSpeedCommand,
  ToggleReverseCommand,
  ApplyCropCommand,
  FreezeClipCommand,
  AutoBuildCommand,
} from '../utils/undoRedo/commands/timeline';
import type { Clip, CropBox, TimelineRenderProgress } from '../types/videoEdit';
import { FREEZE_CLIP_DURATION_SECONDS, getTimelineDuration } from '../types/videoEdit';
import { generateClipId, findClipAtTime } from '../utils/videoEdit/clipMath';
import { videoWorkerPool } from '../utils/videoWorkerPool';
import type { VideoInfo } from '../types/video';
import { exportTimelineToVideo, downloadRenderedVideo } from '../utils/videoEdit/exportTimeline';

export function useVideoTimelineEditor() {
  const videoFile = ref<File | null>(null);
  const videoInfo = ref<VideoInfo | null>(null);
  const videoPreviewUrl = ref<string | null>(null);
  const isProbing = ref(false);
  const error = ref<string | null>(null);

  const clips: Ref<Clip[]> = ref([]);
  const selectedClipIds = ref<Set<string>>(new Set());
  const selectionAnchorId = ref<string | null>(null);
  const playheadTime = ref(0);

  const isExporting = ref(false);
  const exportProgress = ref<TimelineRenderProgress | null>(null);

  const history = new UndoRedoManager();
  const historyVersion = ref(0);
  const unsubscribeHistory = history.subscribe(() => {
    historyVersion.value++;
  });

  const canUndo = computed(() => {
    void historyVersion.value; // reactivity trigger — UndoRedoManager isn't itself reactive
    return history.canUndo();
  });
  const canRedo = computed(() => {
    void historyVersion.value;
    return history.canRedo();
  });

  const totalDuration = computed(() => getTimelineDuration(clips.value));
  const hasSelection = computed(() => selectedClipIds.value.size > 0);
  const selectedClips = computed(() =>
    clips.value.filter((clip) => selectedClipIds.value.has(clip.id))
  );
  const clipAtPlayhead = computed(() => findClipAtTime(clips.value, playheadTime.value));

  // --- Selection -----------------------------------------------------------

  function clearSelection(): void {
    selectedClipIds.value = new Set();
    selectionAnchorId.value = null;
  }

  function selectAll(): void {
    selectedClipIds.value = new Set(clips.value.map((clip) => clip.id));
    selectionAnchorId.value = clips.value.length > 0 ? clips.value[clips.value.length - 1].id : null;
  }

  /** Click semantics: plain click replaces selection, `additive` (ctrl/meta) toggles within it. */
  function toggleClipSelection(id: string, additive = false): void {
    const next = additive ? new Set(selectedClipIds.value) : new Set<string>();
    if (additive && selectedClipIds.value.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    selectedClipIds.value = next;
    selectionAnchorId.value = id;
  }

  /** Shift+click: select the contiguous range from the last anchor to `id`. */
  function selectRangeTo(id: string): void {
    const anchor = selectionAnchorId.value;
    if (!anchor) {
      toggleClipSelection(id);
      return;
    }
    const ids = clips.value.map((clip) => clip.id);
    const from = ids.indexOf(anchor);
    const to = ids.indexOf(id);
    if (from === -1 || to === -1) return;
    const [start, end] = from < to ? [from, to] : [to, from];
    selectedClipIds.value = new Set(ids.slice(start, end + 1));
  }

  // --- Video loading ---------------------------------------------------------

  function revokePreviewUrl(): void {
    if (videoPreviewUrl.value) {
      URL.revokeObjectURL(videoPreviewUrl.value);
      videoPreviewUrl.value = null;
    }
  }

  function reset(): void {
    revokePreviewUrl();
    videoFile.value = null;
    videoInfo.value = null;
    clips.value = [];
    clearSelection();
    playheadTime.value = 0;
    error.value = null;
    exportProgress.value = null;
    history.clear();
  }

  async function loadVideo(file: File): Promise<void> {
    reset();
    videoFile.value = file;
    videoPreviewUrl.value = URL.createObjectURL(file);
    isProbing.value = true;
    try {
      const info = await videoWorkerPool.probeVideo(file);
      if (info.duration > 0) {
        videoInfo.value = info;
        clips.value = [
          { id: generateClipId(), sourceStart: 0, sourceEnd: info.duration, speed: 1, reversed: false },
        ];
      }
    } catch (err) {
      console.warn('Video probe failed, waiting on element metadata fallback:', err);
    } finally {
      isProbing.value = false;
    }
  }

  /** Fallback path if WebCodecs probing fails — mirrors useVideoExtraction's pattern. */
  function applyVideoMetadataFallback(meta: { duration: number; width: number; height: number }): void {
    if (videoInfo.value && videoInfo.value.duration > 0) return;
    if (!Number.isFinite(meta.duration) || meta.duration <= 0) return;
    videoInfo.value = { duration: meta.duration, width: meta.width, height: meta.height };
    if (clips.value.length === 0) {
      clips.value = [
        { id: generateClipId(), sourceStart: 0, sourceEnd: meta.duration, speed: 1, reversed: false },
      ];
    }
  }

  // --- Commands / operations ---------------------------------------------

  async function runCommand(command: Command): Promise<void> {
    try {
      await history.executeCommand(command);
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
    }
  }

  async function undo(): Promise<void> {
    try {
      await history.undo();
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
    }
  }

  async function redo(): Promise<void> {
    try {
      await history.redo();
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
    }
  }

  async function splitAtPlayhead(): Promise<void> {
    await runCommand(new SplitClipCommand(clips, playheadTime.value));
  }

  async function deleteSelected(): Promise<void> {
    if (!hasSelection.value) return;
    await runCommand(new DeleteClipsCommand(clips, new Set(selectedClipIds.value)));
    clearSelection();
  }

  async function duplicateSelected(): Promise<void> {
    if (!hasSelection.value) return;
    await runCommand(new DuplicateClipsCommand(clips, new Set(selectedClipIds.value)));
  }

  async function setSpeedForSelected(speed: number): Promise<void> {
    if (!hasSelection.value) return;
    await runCommand(new SetSpeedCommand(clips, new Set(selectedClipIds.value), speed));
  }

  async function reverseSelected(): Promise<void> {
    if (!hasSelection.value) return;
    await runCommand(new ToggleReverseCommand(clips, new Set(selectedClipIds.value)));
  }

  async function applyCropToSelected(crop: CropBox | undefined): Promise<void> {
    if (!hasSelection.value) return;
    await runCommand(new ApplyCropCommand(clips, new Set(selectedClipIds.value), crop));
  }

  async function freezeAtPlayhead(): Promise<void> {
    await runCommand(new FreezeClipCommand(clips, playheadTime.value, FREEZE_CLIP_DURATION_SECONDS));
  }

  async function runAutoBuild(): Promise<void> {
    await runCommand(new AutoBuildCommand(clips));
  }

  // --- Export --------------------------------------------------------------

  async function exportEditedVideo(): Promise<void> {
    if (!videoFile.value || clips.value.length === 0) return;
    isExporting.value = true;
    error.value = null;
    exportProgress.value = {
      phase: 'loading',
      currentClip: 0,
      totalClips: clips.value.length,
      percent: 0,
    };
    try {
      const { blob, fileName } = await exportTimelineToVideo(videoFile.value, clips.value, (p) => {
        exportProgress.value = p;
      });
      downloadRenderedVideo(blob, fileName);
    } catch (err) {
      error.value = `Export failed: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      isExporting.value = false;
    }
  }

  onUnmounted(() => {
    unsubscribeHistory();
    revokePreviewUrl();
  });

  return {
    videoFile,
    videoInfo,
    videoPreviewUrl,
    isProbing,
    error,

    clips,
    selectedClipIds,
    playheadTime,
    totalDuration,
    hasSelection,
    selectedClips,
    clipAtPlayhead,

    canUndo,
    canRedo,
    isExporting,
    exportProgress,

    clearSelection,
    selectAll,
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
  };
}
