import { IDLE_PREFETCH_AHEAD } from '../constants/optimization';

export function computePrefetchIndices(
  visible: ReadonlySet<number>,
  totalCount: number,
  ahead: number = IDLE_PREFETCH_AHEAD
): number[] {
  if (visible.size === 0 || totalCount === 0) {
    return [];
  }

  const sorted = [...visible].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const indices: number[] = [];

  for (let i = Math.max(0, min - ahead); i < min; i++) {
    if (!visible.has(i)) {
      indices.push(i);
    }
  }

  for (let i = max + 1; i <= Math.min(totalCount - 1, max + ahead); i++) {
    if (!visible.has(i)) {
      indices.push(i);
    }
  }

  return indices;
}
