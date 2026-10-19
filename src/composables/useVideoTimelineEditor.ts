/**
 * Hidden Edit tab — timeline state, selection, and operations.
 *
 * Owns the clip list and a dedicated UndoRedoManager instance (entirely
 * separate from photo undo). Every mutating operation goes through a
 * Command so it's undoable via the toolbar's Undo button.
 */
import { ref, computed, watch, onUnmounted, nextTick } from 'vue';
import type { Ref } from 'vue';
import { UndoRedoManager } from '../utils/undoRedo';
import type { Command } from '../utils/undoRedo';
import {
  SplitClipCommand,
  DeleteClipsCommand,
  DuplicateClipsCommand,
  CombineClipsCommand,
  UngroupClipsCommand,
  SetSpeedCommand,
  ToggleReverseCommand,
  ApplyCropCommand,
  FreezeClipCommand,
  AutoBuildCommand,
} from '../utils/undoRedo/commands/timeline';
import type { Clip, CropBox, TimelineRenderProgress } from '../types/videoEdit';
import { FREEZE_CLIP_DURATION_SECONDS, getTimelineDuration, isCompoundClip } from '../types/videoEdit';
import { generateClipId, findClipAtTime } from '../utils/videoEdit/clipMath';
import { canCombineClips, canUngroupClips, flattenClipsForRender } from '../utils/videoEdit/compoundClip';
import { videoWorkerPool } from '../utils/videoWorkerPool';
import type { VideoInfo } from '../types/video';
import { exportTimelineToVideo, downloadRenderedVideo } from '../utils/videoEdit/exportTimeline';
import {
  saveVideoEditSession,
  loadVideoEditSession,
  clearVideoEditSession,
  cleanupExpiredVideoEditSession,
  VIDEO_SESSION_TTL_MS,
} from '../utils/videoSessionStorage';

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

  const isRestoringSession = ref(false);
  const sessionCreatedAt = ref<number | null>(null);
  const sessionExpiresAt = ref<number | null>(null);
  let persistTimer: ReturnType<typeof setTimeout> | null = null;
  let expiryTimer: ReturnType<typeof setTimeout> | null = null;

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
  const canCombineSelection = computed(() => canCombineClips(clips.value, selectedClipIds.value));
  const canUngroupSelection = computed(() => canUngroupClips(clips.value, selectedClipIds.value));

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

  /**
   * Shift+click: select the contiguous range from the last anchor to `id`.
   * `additive` (Ctrl+Shift) unions that range into the current selection.
   */
  function selectRangeTo(id: string, additive = false): void {
    const anchor = selectionAnchorId.value;
    if (!anchor) {
      toggleClipSelection(id, additive);
      return;
    }
    const ids = clips.value.map((clip) => clip.id);
    const from = ids.indexOf(anchor);
    const to = ids.indexOf(id);
    if (from === -1 || to === -1) return;
    const [start, end] = from < to ? [from, to] : [to, from];
    const rangeIds = ids.slice(start, end + 1);
    if (additive) {
      const next = new Set(selectedClipIds.value);
      for (const rangeId of rangeIds) next.add(rangeId);
      selectedClipIds.value = next;
      return;
    }
    selectedClipIds.value = new Set(rangeIds);
  }

  // --- Video loading ---------------------------------------------------------

  function revokePreviewUrl(): void {
    if (videoPreviewUrl.value) {
      URL.revokeObjectURL(videoPreviewUrl.value);
      videoPreviewUrl.value = null;
    }
  }

  async function reset(): Promise<void> {
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
    clearExpiryTimer();
    sessionCreatedAt.value = null;
    sessionExpiresAt.value = null;
    revokePreviewUrl();
    videoFile.value = null;
    videoInfo.value = null;
    clips.value = [];
    clearSelection();
    playheadTime.value = 0;
    error.value = null;
    exportProgress.value = null;
    history.clear();
    try {
      await clearVideoEditSession();
    } catch (err) {
      console.warn('Failed to clear edit session:', err);
    }
  }

  async function loadVideo(file: File): Promise<void> {
    await reset();
    videoFile.value = file;
    videoPreviewUrl.value = URL.createObjectURL(file);
    videoWorkerPool.preloadFfmpeg();
    isProbing.value = true;
    videoWorkerPool.warmupFfmpeg();
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
    // Initialize clips array with the full video as the first clip
    if (clips.value.length === 0) {
      clips.value = [
        { id: generateClipId(), sourceStart: 0, sourceEnd: meta.duration, speed: 1, reversed: false },
      ];
    }
    if (clips.value.length === 0) {
      clips.value = [
        { id: generateClipId(), sourceStart: 0, sourceEnd: meta.duration, speed: 1, reversed: false },
      ];
    }
  }

  // --- Session persistence (same 24h IndexedDB clock as the Video tab) -----

  function clearExpiryTimer(): void {
    if (expiryTimer) {
      clearTimeout(expiryTimer);
      expiryTimer = null;
    }
  }

  function beginNewSessionClock(): void {
    const now = Date.now();
    sessionCreatedAt.value = now;
    sessionExpiresAt.value = now + VIDEO_SESSION_TTL_MS;
    scheduleExpiryTimer();
  }

  function scheduleExpiryTimer(): void {
    clearExpiryTimer();
    if (sessionExpiresAt.value == null) return;
    const delay = Math.max(0, sessionExpiresAt.value - Date.now());
    expiryTimer = setTimeout(() => {
      void (async () => {
        console.warn('[VideoEditSession] 24h timer elapsed — clearing edit page');
        await reset();
        error.value =
          'Edit session expired after 24 hours and was cleared. Photos are unaffected.';
      })();
    }, delay);
  }

  function schedulePersist(): void {
    if (
      isRestoringSession.value ||
      isProbing.value ||
      isExporting.value ||
      !videoFile.value
    ) {
      return;
    }
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      persistTimer = null;
      void persistSession();
    }, 500);
  }

  async function persistSession(): Promise<void> {
    if (!videoFile.value || isRestoringSession.value || isProbing.value) return;

    if (sessionCreatedAt.value == null || sessionExpiresAt.value == null) {
      beginNewSessionClock();
    }

    try {
      await saveVideoEditSession({
        video: videoFile.value,
        videoName: videoFile.value.name,
        videoType: videoFile.value.type || 'video/mp4',
        videoInfo: videoInfo.value,
        clips: clips.value,
        playheadTime: playheadTime.value,
        createdAt: sessionCreatedAt.value!,
        expiresAt: sessionExpiresAt.value!,
      });
    } catch (err) {
      console.warn('Failed to persist edit session:', err);
    }
  }

  async function restoreSession(): Promise<boolean> {
    try {
      await cleanupExpiredVideoEditSession();
      const session = await loadVideoEditSession();
      if (!session) return false;

      isRestoringSession.value = true;
      sessionCreatedAt.value = session.createdAt;
      sessionExpiresAt.value = session.expiresAt;
      scheduleExpiryTimer();
      videoInfo.value = session.videoInfo;
      clips.value = session.clips;
      playheadTime.value = session.playheadTime;
      clearSelection();
      history.clear();

      const file = new File([session.video], session.videoName, {
        type: session.videoType || 'video/mp4',
      });
      revokePreviewUrl();
      videoFile.value = file;
      videoPreviewUrl.value = URL.createObjectURL(file);
      videoWorkerPool.warmupFfmpeg();
      error.value = null;
      exportProgress.value = null;

      await nextTick();
      return true;
    } catch (err) {
      console.warn('Failed to restore edit session:', err);
      return false;
    } finally {
      isRestoringSession.value = false;
    }
  }

  watch([videoFile, videoInfo, clips], schedulePersist, { deep: true });

  watch(isProbing, (probing, wasProbing) => {
    if (wasProbing && !probing) schedulePersist();
  });

  watch(isExporting, (exporting, wasExporting) => {
    if (wasExporting && !exporting) schedulePersist();
  });

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

  async function combineSelected(): Promise<void> {
    if (!canCombineSelection.value) return;
    const ids = new Set(selectedClipIds.value);
    await runCommand(new CombineClipsCommand(clips, ids));
    const compound = clips.value.find(
      (clip) => isCompoundClip(clip) && clip.children!.some((child) => ids.has(child.id))
    );
    selectedClipIds.value = compound ? new Set([compound.id]) : new Set();
    selectionAnchorId.value = compound?.id ?? null;
  }

  async function ungroupSelected(): Promise<void> {
    if (!canUngroupSelection.value) return;
    const expandedIds: string[] = [];
    for (const clip of clips.value) {
      if (selectedClipIds.value.has(clip.id) && isCompoundClip(clip)) {
        expandedIds.push(...clip.children!.map((child) => child.id));
      } else if (selectedClipIds.value.has(clip.id)) {
        expandedIds.push(clip.id);
      }
    }
    await runCommand(new UngroupClipsCommand(clips, new Set(selectedClipIds.value)));
    selectedClipIds.value = new Set(expandedIds);
    selectionAnchorId.value = expandedIds[expandedIds.length - 1] ?? null;
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

    const leaves = flattenClipsForRender(clips.value);
    const invalidClips = leaves.filter((c) => !c.freeze && c.sourceEnd <= c.sourceStart);
    if (invalidClips.length > 0 || leaves.length === 0) {
      error.value = 'Cannot export: video metadata not loaded. Please try reloading the video.';
      console.error('[Export] Invalid clips detected:', invalidClips);
      return;
    }

    isExporting.value = true;
    error.value = null;
    exportProgress.value = {
      phase: 'loading',
      currentClip: 0,
      totalClips: leaves.length,
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
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
      void persistSession();
    }
    clearExpiryTimer();
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
    canCombineSelection,
    canUngroupSelection,

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
  };
}
