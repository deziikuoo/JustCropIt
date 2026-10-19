/**
 * CapCut-style compound clips: group contiguous timeline clips into one
 * nested unit. Preview and export flatten to leaves so unique-recipe
 * encode-then-stitch still dedupes shared children.
 */
import type { Clip, CropBox } from '../../types/videoEdit';
import { isCompoundClip } from '../../types/videoEdit';
import { generateClipId } from './clipMath';

function scaleClipSpeed(clip: Clip, multiplier: number): Clip {
  if (multiplier === 1) return clip;
  if (isCompoundClip(clip)) {
    const speed = (clip.speed > 0 ? clip.speed : 1) * multiplier;
    return { ...clip, speed };
  }
  if (clip.freeze) {
    return {
      ...clip,
      freeze: {
        ...clip.freeze,
        durationSeconds: Math.max(0, clip.freeze.durationSeconds / multiplier),
      },
    };
  }
  return { ...clip, speed: (clip.speed > 0 ? clip.speed : 1) * multiplier };
}

function toggleClipReverse(clip: Clip): Clip {
  if (clip.freeze) return clip;
  return { ...clip, reversed: !clip.reversed };
}

function applyCropIfMissing(clip: Clip, crop: CropBox | undefined): Clip {
  if (!crop || clip.crop) return clip;
  return { ...clip, crop: { ...crop } };
}

/**
 * Bake this compound's speed/reverse/crop onto its children (one level).
 * Nested compounds stay nested so Ungroup peels one wrapper at a time.
 */
export function unwrapCompound(compound: Clip): Clip[] {
  if (!isCompoundClip(compound)) return [compound];

  let children = compound.children!.map((child) => ({ ...child }));
  const speed = compound.speed > 0 ? compound.speed : 1;
  if (speed !== 1) {
    children = children.map((child) => scaleClipSpeed(child, speed));
  }
  if (compound.crop) {
    children = children.map((child) => applyCropIfMissing(child, compound.crop));
  }
  if (compound.reversed) {
    children = children.slice().reverse().map(toggleClipReverse);
  }
  return children;
}

/** Leaf sequence for preview + FFmpeg. Unique-stitch fingerprints these recipes. */
export function flattenClipsForRender(clips: Clip[]): Clip[] {
  const out: Clip[] = [];
  for (const clip of clips) {
    if (!isCompoundClip(clip)) {
      out.push(clip);
      continue;
    }
    out.push(...flattenClipsForRender(unwrapCompound(clip)));
  }
  return out;
}

export function selectedContiguousRange(
  clips: Clip[],
  ids: ReadonlySet<string>
): { start: number; end: number } | null {
  if (ids.size < 1) return null;
  const indexes: number[] = [];
  for (let i = 0; i < clips.length; i++) {
    if (ids.has(clips[i].id)) indexes.push(i);
  }
  if (indexes.length !== ids.size) return null;
  const start = indexes[0];
  const end = indexes[indexes.length - 1];
  if (end - start + 1 !== indexes.length) return null;
  return { start, end };
}

export function canCombineClips(clips: Clip[], ids: ReadonlySet<string>): boolean {
  if (ids.size < 2) return false;
  return selectedContiguousRange(clips, ids) !== null;
}

export function canUngroupClips(clips: Clip[], ids: ReadonlySet<string>): boolean {
  return clips.some((clip) => ids.has(clip.id) && isCompoundClip(clip));
}

export function combineClips(clips: Clip[], ids: ReadonlySet<string>): Clip[] {
  const range = selectedContiguousRange(clips, ids);
  if (!range || ids.size < 2) return clips;

  const children = clips.slice(range.start, range.end + 1);
  const compound: Clip = {
    id: generateClipId(),
    sourceStart: 0,
    sourceEnd: 0,
    speed: 1,
    reversed: false,
    children: children.map((child) => ({ ...child })),
  };

  const next = clips.slice();
  next.splice(range.start, range.end - range.start + 1, compound);
  return next;
}

export function ungroupClips(clips: Clip[], ids: ReadonlySet<string>): Clip[] {
  if (ids.size === 0) return clips;
  const next: Clip[] = [];
  for (const clip of clips) {
    if (ids.has(clip.id) && isCompoundClip(clip)) {
      next.push(...unwrapCompound(clip));
    } else {
      next.push(clip);
    }
  }
  return next;
}

export function compoundChildCount(clip: Clip): number {
  if (!isCompoundClip(clip)) return 0;
  return clip.children!.reduce((sum, child) => sum + (isCompoundClip(child) ? compoundChildCount(child) : 1), 0);
}

export function playbackOrderedChildren(clip: Clip): Clip[] {
  if (!isCompoundClip(clip)) return [];
  const children = clip.children!;
  return clip.reversed ? children.slice().reverse() : children;
}
