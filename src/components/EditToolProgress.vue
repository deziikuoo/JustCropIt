<template>
  <span
    v-if="visible"
    class="edit-tool-ring"
    :class="{ 'edit-tool-ring--spin': indeterminate, 'edit-tool-ring--dark': tone === 'dark' }"
    role="progressbar"
    aria-valuemin="0"
    aria-valuemax="100"
    :aria-valuenow="indeterminate ? undefined : clamped"
    :aria-label="ariaLabel"
  >
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <circle class="edit-tool-ring-track" cx="10" cy="10" r="7" />
      <circle
        class="edit-tool-ring-value"
        cx="10"
        cy="10"
        r="7"
        :stroke-dasharray="indeterminate ? '12 32' : String(CIRCUMFERENCE)"
        :stroke-dashoffset="indeterminate ? 0 : dashOffset"
        :transform="indeterminate ? undefined : 'rotate(-90 10 10)'"
      />
    </svg>
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  /** 0–100 while working, -1 while the amount of work is unknown, null when idle. */
  percent: number | null;
  label: string;
  tone?: 'light' | 'dark';
}>();

const CIRCUMFERENCE = 2 * Math.PI * 7;

const visible = computed(() => props.percent !== null && props.percent !== undefined);
const indeterminate = computed(() => props.percent !== null && props.percent < 0);
const clamped = computed(() => Math.max(0, Math.min(100, props.percent ?? 0)));
const dashOffset = computed(() => CIRCUMFERENCE * (1 - clamped.value / 100));
const ariaLabel = computed(() =>
  indeterminate.value ? `${props.label} in progress` : `${props.label} ${clamped.value}%`
);
</script>

<style scoped>
.edit-tool-ring {
  position: absolute;
  top: 3px;
  right: 3px;
  width: 15px;
  height: 15px;
  pointer-events: none;
  z-index: 2;
}

.edit-tool-ring svg {
  display: block;
  width: 100%;
  height: 100%;
}

.edit-tool-ring-track,
.edit-tool-ring-value {
  fill: none;
  stroke-width: 2.4;
}

.edit-tool-ring-track {
  stroke: rgba(255, 255, 255, 0.22);
}

.edit-tool-ring-value {
  stroke: #ffd700;
  stroke-linecap: round;
}

.edit-tool-ring--dark .edit-tool-ring-track {
  stroke: rgba(0, 0, 0, 0.28);
}

.edit-tool-ring--dark .edit-tool-ring-value {
  stroke: #1a1a1a;
}

.edit-tool-ring--spin svg {
  transform-origin: 50% 50%;
  animation: edit-tool-ring-spin 0.75s linear infinite;
}

@keyframes edit-tool-ring-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
