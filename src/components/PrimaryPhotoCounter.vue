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
  position: absolute;
  top: -33px;
  right: 140px;
  color: #ffffff;
  font-size: 0.875rem;
  font-weight: 400;
  z-index: 10;
  pointer-events: none;
}
</style>
