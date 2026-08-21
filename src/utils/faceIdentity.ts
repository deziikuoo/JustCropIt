import type { BoundingBox, CropTarget, ImageDimensions } from '../types/detection';

export function cosineSimilarity(
  a: ArrayLike<number>,
  b: ArrayLike<number>
): number {
  const len = Math.min(a.length, b.length);
  if (len === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < len; i += 1) {
    const av = a[i];
    const bv = b[i];
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

export function bboxToRoi(
  bbox: BoundingBox,
  imageSize: ImageDimensions,
  padRatio = 0.12
): { left: number; top: number; right: number; bottom: number } {
  const padX = bbox.width * padRatio;
  const padY = bbox.height * padRatio;
  const left = (bbox.x - padX) / imageSize.width;
  const top = (bbox.y - padY) / imageSize.height;
  const right = (bbox.x + bbox.width + padX) / imageSize.width;
  const bottom = (bbox.y + bbox.height + padY) / imageSize.height;
  return {
    left: Math.max(0, Math.min(1, left)),
    top: Math.max(0, Math.min(1, top)),
    right: Math.max(0, Math.min(1, right)),
    bottom: Math.max(0, Math.min(1, bottom)),
  };
}

/**
 * Expand a matched face into a search region so pose can run on one person.
 */
export function expandHintToSearchRegion(
  hint: BoundingBox,
  imageSize: ImageDimensions,
  target: CropTarget
): BoundingBox {
  const faceH = Math.max(1, hint.height);
  const faceW = Math.max(1, hint.width);
  const cx = hint.x + faceW / 2;

  let top = hint.y - faceH * 0.35;
  let height = faceH * 2.2;
  let width = faceW * 2.4;

  switch (target) {
    case 'head':
      height = faceH * 1.9;
      width = faceW * 2.1;
      top = hint.y - faceH * 0.4;
      break;
    case 'head-shoulders':
      height = faceH * 2.8;
      width = faceW * 2.6;
      break;
    case 'upper-body':
      height = faceH * 4.6;
      width = Math.max(faceW * 3.2, height * 0.55);
      break;
    case 'lower-body':
      top = hint.y + faceH * 1.2;
      height = faceH * 5.5;
      width = Math.max(faceW * 3.2, height * 0.5);
      break;
    case 'full-body':
    default:
      height = faceH * 7.4;
      width = Math.max(faceW * 3.4, height * 0.42);
      break;
  }

  let x = cx - width / 2;
  let y = top;

  if (x < 0) x = 0;
  if (y < 0) y = 0;
  if (x + width > imageSize.width) width = imageSize.width - x;
  if (y + height > imageSize.height) height = imageSize.height - y;

  return {
    x: Math.max(0, Math.floor(x)),
    y: Math.max(0, Math.floor(y)),
    width: Math.max(1, Math.floor(width)),
    height: Math.max(1, Math.floor(height)),
  };
}

export function pickBestMatchIndex(
  reference: ArrayLike<number>,
  candidates: Array<ArrayLike<number>>,
  minCosine: number
): number {
  let best = -1;
  let bestScore = minCosine;
  for (let i = 0; i < candidates.length; i += 1) {
    const score = cosineSimilarity(reference, candidates[i]);
    if (score >= bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

/** Max cosine of one embedding against a gallery of reference embeddings. */
export function bestCosineVsGallery(
  embedding: ArrayLike<number>,
  references: Array<ArrayLike<number>>
): number {
  let best = 0;
  for (const reference of references) {
    best = Math.max(best, cosineSimilarity(reference, embedding));
  }
  return best;
}

/**
 * Among candidate face embeddings, pick the index whose best gallery cosine
 * is highest and at least `minCosine`.
 */
export function pickBestMatchIndexVsGallery(
  references: Array<ArrayLike<number>>,
  candidates: Array<ArrayLike<number>>,
  minCosine: number
): { index: number; bestCosine: number } {
  let bestIndex = -1;
  let bestScore = minCosine;
  for (let i = 0; i < candidates.length; i += 1) {
    const score = bestCosineVsGallery(candidates[i], references);
    if (score >= bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }
  return { index: bestIndex, bestCosine: bestIndex >= 0 ? bestScore : 0 };
}
