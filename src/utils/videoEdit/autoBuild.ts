/**
 * Auto Build — detects "regular clip immediately followed by a duplicated,
 * reversed copy of itself" (a boomerang pair) and extends each such pair,
 * independently, into a repeating forward/reverse loop lasting 5s+.
 *
 * Implemented as a single left-to-right pass so multiple chained pairs are
 * each handled independently and in order, with no index-shifting bugs from
 * mutating the array while scanning it.
 */
import type { Clip } from '../../types/videoEdit';
import { AUTO_BUILD_MIN_EXTRA_SECONDS, getClipDuration } from '../../types/videoEdit';
import { cloneClipTree } from './clipMath';

/** True when `candidate` is a reversed duplicate of `original` (same lineage, flipped). */
function isReverseDuplicateOf(candidate: Clip, original: Clip): boolean {
  return (
    candidate.originClipId === original.id &&
    candidate.reversed === true &&
    original.reversed !== true
  );
}

/** Fresh copy used for the repeated clips — tagged so re-running Auto Build skips them. */
function cloneForAutoBuild(clip: Clip): Clip {
  return { ...cloneClipTree(clip), autoBuilt: true };
}

export function autoBuildClips(clips: Clip[]): Clip[] {
  const result: Clip[] = [];
  let i = 0;

  while (i < clips.length) {
    const clipA = clips[i];
    const clipB = i + 1 < clips.length ? clips[i + 1] : null;

    const isPair =
      clipB !== null && !clipA.autoBuilt && !clipB.autoBuilt && isReverseDuplicateOf(clipB, clipA);

    if (!isPair || !clipB) {
      result.push(clipA);
      i += 1;
      continue;
    }

    // Emit the originally detected pair unchanged.
    result.push(clipA, clipB);

    // Idempotency guard: if this exact pair was already expanded by a previous
    // Auto Build run, the very next clip will be a leftover autoBuilt repeat —
    // in that case, skip re-expanding (the loop will pass the existing
    // expansion through unchanged on the next iterations).
    const alreadyExpanded = clips[i + 2]?.autoBuilt === true;

    if (!alreadyExpanded) {
      const pairDuration = getClipDuration(clipA) + getClipDuration(clipB);
      if (pairDuration > 0) {
        let addedDuration = 0;
        while (addedDuration < AUTO_BUILD_MIN_EXTRA_SECONDS) {
          result.push(cloneForAutoBuild(clipA), cloneForAutoBuild(clipB));
          addedDuration += pairDuration;
        }
      }
    }

    i += 2; // Continue scanning right after the original pair.
  }

  return result;
}
