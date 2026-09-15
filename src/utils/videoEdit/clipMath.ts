/**
 * Pure clip-array transforms for the hidden Edit tab timeline.
 * Nothing here touches Vue reactivity or FFmpeg — every function takes a
 * Clip[] and returns a new Clip[], which keeps them trivial to unit test
 * and to wrap as undo/redo commands.
 */
import type { Clip, CropBox } from '../../types/videoEdit';
import { getClipDuration } from '../../types/videoEdit';

/** Below this many seconds, a split/freeze is considered "at the edge" and is a no-op. */
const MIN_CLIP_SECONDS = 0.05;

export function generateClipId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `clip-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export interface TimelinePosition {
  index: number;
  clip: Clip;
  /** Timeline seconds where this clip starts. */
  clipStart: number;
  /** Seconds into this clip's own playback, clamped to [0, duration]. */
  localTime: number;
}

/** Finds the clip covering `timelineTime` (clamped to the timeline's bounds). */
export function findClipAtTime(clips: Clip[], timelineTime: number): TimelinePosition | null {
  let cursor = 0;
  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i];
    const duration = getClipDuration(clip);
    const end = cursor + duration;
    const isLast = i === clips.length - 1;
    if (timelineTime < end - 1e-6 || (isLast && timelineTime <= end + 1e-6)) {
      return {
        index: i,
        clip,
        clipStart: cursor,
        localTime: Math.max(0, Math.min(timelineTime - cursor, duration)),
      };
    }
    cursor = end;
  }
  return null;
}

/** Maps a clip's local playback time (0..duration) to a source-video timestamp. */
export function localTimeToSourceTime(clip: Clip, localTime: number): number {
  if (clip.freeze) return clip.freeze.sourceTime;
  const speed = clip.speed > 0 ? clip.speed : 1;
  const sourceOffset = localTime * speed;
  return clip.reversed ? clip.sourceEnd - sourceOffset : clip.sourceStart + sourceOffset;
}

export function getSourceTimeAtTimelineTime(clips: Clip[], timelineTime: number): number | null {
  const pos = findClipAtTime(clips, timelineTime);
  if (!pos) return null;
  return localTimeToSourceTime(pos.clip, pos.localTime);
}

/** Splits the clip with `clipId` at `localTime` seconds into its own playback. */
export function splitClipAtLocalTime(clips: Clip[], clipId: string, localTime: number): Clip[] {
  const index = clips.findIndex((c) => c.id === clipId);
  if (index === -1) return clips;

  const clip = clips[index];
  const duration = getClipDuration(clip);
  if (localTime <= MIN_CLIP_SECONDS || localTime >= duration - MIN_CLIP_SECONDS) {
    return clips; // Too close to an edge — nothing meaningful to split.
  }

  let first: Clip;
  let second: Clip;

  if (clip.freeze) {
    first = {
      ...clip,
      id: generateClipId(),
      freeze: { ...clip.freeze, durationSeconds: localTime },
      originClipId: undefined,
      autoBuilt: undefined,
    };
    second = {
      ...clip,
      id: generateClipId(),
      freeze: { ...clip.freeze, durationSeconds: duration - localTime },
      originClipId: undefined,
      autoBuilt: undefined,
    };
  } else {
    const speed = clip.speed > 0 ? clip.speed : 1;
    const sourceOffset = localTime * speed;
    if (clip.reversed) {
      const splitPoint = clip.sourceEnd - sourceOffset;
      first = { ...clip, id: generateClipId(), sourceStart: splitPoint, originClipId: undefined, autoBuilt: undefined };
      second = { ...clip, id: generateClipId(), sourceEnd: splitPoint, originClipId: undefined, autoBuilt: undefined };
    } else {
      const splitPoint = clip.sourceStart + sourceOffset;
      first = { ...clip, id: generateClipId(), sourceEnd: splitPoint, originClipId: undefined, autoBuilt: undefined };
      second = { ...clip, id: generateClipId(), sourceStart: splitPoint, originClipId: undefined, autoBuilt: undefined };
    }
  }

  const next = clips.slice();
  next.splice(index, 1, first, second);
  return next;
}

/** Convenience wrapper: splits whichever clip sits at absolute timeline time. */
export function splitAtTimelineTime(clips: Clip[], timelineTime: number): Clip[] {
  const pos = findClipAtTime(clips, timelineTime);
  if (!pos) return clips;
  return splitClipAtLocalTime(clips, pos.clip.id, pos.localTime);
}

export function deleteClips(clips: Clip[], ids: ReadonlySet<string>): Clip[] {
  if (ids.size === 0) return clips;
  return clips.filter((clip) => !ids.has(clip.id));
}

/** Clones each selected clip and inserts the copy immediately after the original. */
export function duplicateClips(clips: Clip[], ids: ReadonlySet<string>): Clip[] {
  if (ids.size === 0) return clips;
  const next: Clip[] = [];
  for (const clip of clips) {
    next.push(clip);
    if (ids.has(clip.id)) {
      next.push({ ...clip, id: generateClipId(), originClipId: clip.id, autoBuilt: undefined });
    }
  }
  return next;
}

export function setSpeedForClips(clips: Clip[], ids: ReadonlySet<string>, speed: number): Clip[] {
  const clamped = Math.min(8, Math.max(0.1, speed));
  return clips.map((clip) => (ids.has(clip.id) && !clip.freeze ? { ...clip, speed: clamped } : clip));
}

export function toggleReverseForClips(clips: Clip[], ids: ReadonlySet<string>): Clip[] {
  return clips.map((clip) => (ids.has(clip.id) && !clip.freeze ? { ...clip, reversed: !clip.reversed } : clip));
}

export function applyCropToClips(
  clips: Clip[],
  ids: ReadonlySet<string>,
  crop: CropBox | undefined
): Clip[] {
  return clips.map((clip) => (ids.has(clip.id) ? { ...clip, crop } : clip));
}

/**
 * Splits at `timelineTime` (if needed) and inserts a new freeze clip at that boundary,
 * capturing the source frame that was showing at that instant.
 */
export function insertFreezeClip(
  clips: Clip[],
  timelineTime: number,
  durationSeconds: number
): Clip[] {
  const sourceTime = getSourceTimeAtTimelineTime(clips, timelineTime);
  if (sourceTime === null) return clips;

  const splitClips = splitAtTimelineTime(clips, timelineTime);

  // Find the boundary index whose cumulative duration matches timelineTime.
  let cursor = 0;
  let insertIndex = splitClips.length;
  for (let i = 0; i <= splitClips.length; i++) {
    if (Math.abs(cursor - timelineTime) < 1e-3) {
      insertIndex = i;
      break;
    }
    if (i < splitClips.length) {
      cursor += getClipDuration(splitClips[i]);
    }
  }

  const freezeClip: Clip = {
    id: generateClipId(),
    sourceStart: 0,
    sourceEnd: 0,
    speed: 1,
    reversed: false,
    freeze: { sourceTime, durationSeconds },
  };

  const next = splitClips.slice();
  next.splice(insertIndex, 0, freezeClip);
  return next;
}
