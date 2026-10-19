/**
 * Export reuse key: clips that share a render recipe produce identical video
 * and can share one encoded file. Lineage fields (id, originClipId, autoBuilt)
 * are intentionally excluded — a later crop/speed on one Auto Build clone
 * must not reuse the unedited encode.
 *
 * RECIPE_KEYS must list every ClipRenderRecipe field. Adding a future effect
 * to the recipe type without updating this list fails typecheck.
 */
import type { ClipRenderRecipe, ClipRenderSpec, CropBox, FreezeSpec } from '../../types/videoEdit';

export function toClipRenderRecipe(clip: ClipRenderSpec): ClipRenderRecipe {
  return {
    sourceStart: clip.sourceStart,
    sourceEnd: clip.sourceEnd,
    speed: clip.speed,
    reversed: clip.reversed,
    crop: clip.crop,
    freeze: clip.freeze,
  };
}

const RECIPE_KEYS = [
  'sourceStart',
  'sourceEnd',
  'speed',
  'reversed',
  'crop',
  'freeze',
] as const satisfies readonly (keyof ClipRenderRecipe)[];

type MissingRecipeKeys = Exclude<keyof ClipRenderRecipe, (typeof RECIPE_KEYS)[number]>;
type AssertRecipeKeysCovered = [MissingRecipeKeys] extends [never]
  ? true
  : ['ClipRenderRecipe fingerprint is missing fields', MissingRecipeKeys];
const _recipeKeysCovered: AssertRecipeKeysCovered = true;
void _recipeKeysCovered;

function roundTime(seconds: number): string {
  return (Number.isFinite(seconds) ? seconds : 0).toFixed(3);
}

function serializeCrop(crop: CropBox | undefined): string {
  if (!crop) return '';
  return [crop.x, crop.y, crop.width, crop.height].map((n) => Math.round(n)).join(',');
}

function serializeFreeze(freeze: FreezeSpec | undefined): string {
  if (!freeze) return '';
  return `${roundTime(freeze.sourceTime)}:${roundTime(freeze.durationSeconds)}`;
}

function serializeRecipeField(recipe: ClipRenderRecipe, key: (typeof RECIPE_KEYS)[number]): string {
  switch (key) {
    case 'sourceStart':
      return roundTime(recipe.sourceStart);
    case 'sourceEnd':
      return roundTime(recipe.sourceEnd);
    case 'speed':
      return String(recipe.speed > 0 ? recipe.speed : 1);
    case 'reversed':
      return recipe.reversed ? '1' : '0';
    case 'crop':
      return serializeCrop(recipe.crop);
    case 'freeze':
      return serializeFreeze(recipe.freeze);
    default: {
      const _exhaustive: never = key;
      return _exhaustive;
    }
  }
}

export function clipRenderFingerprint(clip: ClipRenderSpec): string {
  const recipe = toClipRenderRecipe(clip);
  return RECIPE_KEYS.map((key) => serializeRecipeField(recipe, key)).join('|');
}

/**
 * Concat demuxer stream-copy requires matching output dimensions.
 * Uncropped clips share the source frame size; cropped clips use the crop box.
 */
export function clipOutputSizeSignature(clip: ClipRenderSpec): string {
  if (clip.crop && clip.crop.width > 0 && clip.crop.height > 0) {
    return `${Math.round(clip.crop.width)}x${Math.round(clip.crop.height)}`;
  }
  return 'source';
}

export function uniqueClipsShareOutputSize(uniqueClips: ClipRenderSpec[]): boolean {
  if (uniqueClips.length <= 1) return true;
  const first = clipOutputSizeSignature(uniqueClips[0]);
  return uniqueClips.every((clip) => clipOutputSizeSignature(clip) === first);
}

/** Trim-only clip: FFmpeg can stream-copy; any effect forces a re-encode. */
export function clipIsPassthrough(clip: ClipRenderSpec): boolean {
  if (clip.freeze) return false;
  if (clip.reversed) return false;
  if (clip.crop) return false;
  const speed = clip.speed && clip.speed > 0 ? clip.speed : 1;
  return speed === 1;
}

export function getClipRenderDuration(clip: ClipRenderSpec): number {
  if (clip.freeze) {
    return Math.max(0, clip.freeze.durationSeconds);
  }
  const speed = clip.speed && clip.speed > 0 ? clip.speed : 1;
  return Math.max(0, (clip.sourceEnd - clip.sourceStart) / speed);
}

export interface UniqueRenderPlan {
  /** Fingerprint per timeline index. */
  keyByIndex: string[];
  /** First clip that produced each key (stable encode source). */
  clipByKey: Map<string, ClipRenderSpec>;
  /** Unique keys in first-seen order. */
  uniqueKeys: string[];
}

export function planUniqueRenders(clips: ClipRenderSpec[]): UniqueRenderPlan {
  const keyByIndex: string[] = [];
  const clipByKey = new Map<string, ClipRenderSpec>();
  const uniqueKeys: string[] = [];
  for (const clip of clips) {
    const key = clipRenderFingerprint(clip);
    keyByIndex.push(key);
    if (!clipByKey.has(key)) {
      clipByKey.set(key, clip);
      uniqueKeys.push(key);
    }
  }
  return { keyByIndex, clipByKey, uniqueKeys };
}

/** Safe MEMFS filename fragment for a fingerprint. */
export function fingerprintFileToken(fingerprint: string): string {
  let hash = 2166136261;
  for (let i = 0; i < fingerprint.length; i++) {
    hash ^= fingerprint.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}
