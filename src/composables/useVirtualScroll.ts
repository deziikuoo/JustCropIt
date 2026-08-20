import { ref, computed, onMounted, onUnmounted, watch, type Ref } from 'vue';
import { useResizeObserver } from '@vueuse/core';

interface UseVirtualScrollOptions {
  totalItems: Ref<number>;
  itemMinWidth: Ref<number>;
  gap: Ref<number>;
  rowGap?: Ref<number>;
  containerRef: Ref<HTMLElement | undefined | null>;
  enabled: Ref<boolean>;
  bufferRows?: number;
}

export function useVirtualScroll({
  totalItems,
  itemMinWidth,
  gap,
  rowGap,
  containerRef,
  enabled,
  bufferRows = 3
}: UseVirtualScrollOptions) {
  const windowHeight = ref(typeof window !== 'undefined' ? window.innerHeight : 800);
  const scrollY = ref(typeof window !== 'undefined' ? window.scrollY : 0);
  const containerWidth = ref(0);
  const containerTop = ref(0);
  const rowGapSize = computed(() => rowGap?.value ?? gap.value);

  // Layout calculations
  const layout = computed(() => {
    if (!containerWidth.value || !itemMinWidth.value) {
      return { colCount: 1, itemWidth: 0, rowHeight: 0 };
    }

    // Match CSS grid auto-fill logic approximately
    // grid-template-columns: repeat(auto-fill, minmax(minSize, 1fr))
    // The browser calculates how many columns fit with at least minSize + gap
    
    // Available width for columns + gaps
    const availableWidth = containerWidth.value;
    const minSize = itemMinWidth.value;
    const gapSize = gap.value;

    // Calculate max columns that fit
    // width >= colCount * minSize + (colCount - 1) * gap
    // width + gap >= colCount * (minSize + gap)
    let colCount = Math.floor((availableWidth + gapSize) / (minSize + gapSize));
    colCount = Math.max(1, colCount);

    // Grid uses fixed pixel columns (repeat(auto-fill, Npx)), not 1fr stretch
    const itemWidth = minSize;
    
    // Photos are usually square in the grid
    const rowHeight = itemWidth;

    return { colCount, itemWidth, rowHeight };
  });

  const totalRows = computed(() => Math.ceil(totalItems.value / layout.value.colCount));
  const totalHeight = computed(() => {
    if (totalRows.value === 0) return 0;
    return totalRows.value * layout.value.rowHeight + (totalRows.value - 1) * rowGapSize.value;
  });

  // Calculate visible range
  const visibleRange = computed(() => {
    if (!enabled.value || totalItems.value === 0 || layout.value.rowHeight === 0) {
      return { start: 0, end: totalItems.value };
    }

    // Determine viewport relative to container
    // If container is not at top of page, offset scrollY
    // We want the scroll position relative to the container start
    // However, the container itself flows with the page.
    // So we need to check intersection of window viewport and container.
    
    // Simplified model: We assume the container starts at `containerTop` (document offset)
    // and the window scrolls down.
    // Visible start inside container = scrollY - containerTop
    // If scrollY < containerTop, we are above the container, start = 0.
    
    const viewStart = Math.max(0, scrollY.value - containerTop.value);
    const viewEnd = viewStart + windowHeight.value;

    const rowHeightWithGap = layout.value.rowHeight + rowGapSize.value;
    
    // Calculate visible rows
    let startRow = Math.floor(viewStart / rowHeightWithGap);
    let endRow = Math.ceil(viewEnd / rowHeightWithGap);

    // Add buffer
    startRow = Math.max(0, startRow - bufferRows);
    endRow = Math.min(totalRows.value, endRow + bufferRows);

    const start = startRow * layout.value.colCount;
    const end = Math.min(totalItems.value, endRow * layout.value.colCount);

    return { start, end };
  });

  // Spacer heights for virtual scrolling
  const spacerBeforeHeight = computed(() => {
    if (!enabled.value) return 0;
    const startRow = Math.floor(visibleRange.value.start / layout.value.colCount);
    if (startRow <= 0) return 0;
    const rowHeightWithGap = layout.value.rowHeight + rowGapSize.value;
    return startRow * rowHeightWithGap;
  });

  const spacerAfterHeight = computed(() => {
    if (!enabled.value) return 0;
    const endRow = Math.ceil(visibleRange.value.end / layout.value.colCount);
    const remainingRows = totalRows.value - endRow;
    if (remainingRows <= 0) return 0;
    const rowHeightWithGap = layout.value.rowHeight + rowGapSize.value;
    // For the very last row, there is no gap after it, but our calculation includes it per row.
    // Exact height might be slightly off by one gap, but for spacer it's usually fine.
    // Correct calculation:
    // Total height - height of rows up to endRow.
    // Height up to endRow = endRow * rowHeight + (endRow - 1) * gap
    // Use easier logic:
    return remainingRows * rowHeightWithGap;
  });

  // Event handlers
  const handleScroll = () => {
    scrollY.value = window.scrollY;
    updateContainerTop();
  };

  const updateContainerTop = () => {
    if (containerRef.value) {
      const rect = containerRef.value.getBoundingClientRect();
      // rect.top is relative to viewport. 
      // absolute top = rect.top + window.scrollY
      containerTop.value = rect.top + window.scrollY;
    }
  };

  const updateContainerWidth = () => {
    if (containerRef.value) {
      containerWidth.value = containerRef.value.clientWidth;
    }
  };

  // Resize observer for container width updates
  useResizeObserver(containerRef, (entries) => {
    const entry = entries[0];
    if (entry) {
      containerWidth.value = entry.contentRect.width;
      updateContainerTop();
    }
  });

  // Watch enabled state to force remeasure
  watch(enabled, (newVal) => {
    if (newVal) {
      updateContainerWidth();
      updateContainerTop();
    }
  });

  onMounted(() => {
    if (typeof window !== 'undefined') {
      window.addEventListener('scroll', handleScroll, { passive: true });
      window.addEventListener('resize', () => {
        windowHeight.value = window.innerHeight;
        updateContainerWidth();
        updateContainerTop();
      }, { passive: true });
      
      updateContainerWidth();
      updateContainerTop();
    }
  });

  onUnmounted(() => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('scroll', handleScroll);
    }
  });

  return {
    visibleRange,
    spacerBeforeHeight,
    spacerAfterHeight,
    totalHeight,
    colCount: computed(() => layout.value.colCount),
    itemWidth: computed(() => layout.value.itemWidth),
  };
}
