<template>
  <div
    class="primary-photo-counter"
    :class="{ embedded, header, 'is-active': photoCount > 0 }"
  >
    <span v-if="embedded" class="counter-label">Total</span>
    <span class="counter-value">{{ photoCount }}</span>
  </div>
</template>

<script setup lang="ts">
interface Props {
  photoCount: number;
  embedded?: boolean;
  header?: boolean;
}

withDefaults(defineProps<Props>(), {
  embedded: false,
  header: false,
});
</script>

<style scoped>
.primary-photo-counter {
  position: relative;
  font-size: 0.9rem;
  font-weight: 700;
  font-family: "SF Pro Display", "Segoe UI", "Helvetica Neue", Arial, sans-serif;
  color: #e8c96a;
  line-height: 1;
  margin-bottom: 1.5px;
  white-space: nowrap;
  z-index: 1;
  pointer-events: none;
}

.primary-photo-counter.embedded {
  width: 100%;
  height: 100%;
  margin: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  -webkit-text-stroke: 0;
  opacity: 0.35;
  transition: opacity 0.2s ease;
}

.primary-photo-counter.embedded.is-active {
  opacity: 1;
}

.primary-photo-counter.embedded.header {
  width: auto;
  height: auto;
  gap: 4px;
}

.counter-label {
  font-size: 0.6rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: #e8c96a;
  flex-shrink: 0;
}

.counter-value {
  font-size: 0.75rem;
  font-weight: 700;
  color: #e8c96a;
  line-height: 1;
}
</style>
