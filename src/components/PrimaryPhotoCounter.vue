<template>
  <div v-if="photoCount > 0" class="primary-photo-counter">
    {{ photoCount }}
  </div>
</template>

<script setup lang="ts">
interface Props {
  photoCount: number;
}

defineProps<Props>();
</script>

<style scoped>
.primary-photo-counter {
  position: relative;
  font-size: 0.9rem;
  font-weight: 700;
  font-family: "SF Pro Display", "Segoe UI", "Helvetica Neue", Arial, sans-serif;
  background: linear-gradient(135deg, #ffffff 55%, #708090 90%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  -webkit-text-stroke: 1px gray;
  line-height: 1;
  margin-bottom: 1.5px;
  white-space: nowrap;
  z-index: 1002;
  pointer-events: none;
}
</style>
