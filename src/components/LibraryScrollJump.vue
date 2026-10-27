<template>
  <div class="library-jump">
    <Transition name="library-jump">
      <button
        v-if="showUp"
        type="button"
        class="library-jump__btn library-jump__btn--up"
        aria-label="Jump to top"
        title="Jump to top"
        @click="jumpToTop"
      >
        <i class="fas fa-chevron-up" aria-hidden="true"></i>
      </button>
    </Transition>
    <Transition name="library-jump">
      <button
        v-if="showDown"
        type="button"
        class="library-jump__btn library-jump__btn--down"
        aria-label="Jump to bottom"
        title="Jump to bottom"
        @click="jumpToBottom"
      >
        <i class="fas fa-chevron-down" aria-hidden="true"></i>
      </button>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';

const EDGE_PX = 4;
const MIN_SCROLL_PX = 160;

const showUp = ref(false);
const showDown = ref(false);

let frame = 0;

function measure(): void {
  const scroller = document.scrollingElement || document.documentElement;
  const maxScroll = Math.max(0, scroller.scrollHeight - window.innerHeight);
  const y = scroller.scrollTop;
  const scrollable = maxScroll > MIN_SCROLL_PX;
  showUp.value = scrollable && y > EDGE_PX;
  showDown.value = scrollable && y < maxScroll - EDGE_PX;
}

function scheduleMeasure(): void {
  if (frame) return;
  frame = window.requestAnimationFrame(() => {
    frame = 0;
    measure();
  });
}

function jumpToTop(): void {
  const scroller = document.scrollingElement || document.documentElement;
  scroller.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  measure();
}

function jumpToBottom(): void {
  const scroller = document.scrollingElement || document.documentElement;
  scroller.scrollTo({ top: scroller.scrollHeight, left: 0, behavior: 'auto' });
  measure();
}

let resizeObserver: ResizeObserver | null = null;

onMounted(() => {
  measure();
  window.addEventListener('scroll', scheduleMeasure, { passive: true });
  window.addEventListener('resize', scheduleMeasure, { passive: true });
  resizeObserver = new ResizeObserver(scheduleMeasure);
  resizeObserver.observe(document.documentElement);
});

onUnmounted(() => {
  window.removeEventListener('scroll', scheduleMeasure);
  window.removeEventListener('resize', scheduleMeasure);
  resizeObserver?.disconnect();
  if (frame) window.cancelAnimationFrame(frame);
});
</script>

<style scoped>
.library-jump {
  position: fixed;
  right: calc(12px + env(safe-area-inset-right, 0px));
  bottom: calc(52px + env(safe-area-inset-bottom, 0px));
  z-index: 1110;
  width: 40px;
  height: 88px;
  pointer-events: none;
}

.library-jump__btn {
  position: absolute;
  right: 0;
  pointer-events: auto;
}

.library-jump__btn--up {
  top: 0;
}

.library-jump__btn--down {
  bottom: 0;
}

.library-jump__btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  padding: 0;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(18, 18, 26, 0.94);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
  color: rgba(255, 255, 255, 0.88);
  font-size: 0.85rem;
  cursor: pointer;
}

.library-jump__btn:hover {
  background: rgba(212, 175, 55, 0.18);
  border-color: rgba(212, 175, 55, 0.45);
  color: #ffd700;
}

.library-jump-enter-active,
.library-jump-leave-active {
  transition: opacity 0.22s ease, transform 0.22s ease;
}

.library-jump-enter-from,
.library-jump-leave-to {
  opacity: 0;
  transform: translateY(10px) scale(0.82);
}

@media (max-width: 599px) {
  .library-jump {
    bottom: calc(12px + env(safe-area-inset-bottom, 0px));
  }
}

@media (prefers-reduced-motion: reduce) {
  .library-jump-enter-active,
  .library-jump-leave-active {
    transition: none;
  }
}
</style>
