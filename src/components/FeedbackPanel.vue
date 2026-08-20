<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="feedback-backdrop"
      @click="handleClose"
    >
      <aside
        id="feedback-panel"
        class="feedback-panel"
        :class="{ 'feedback-panel--mobile': isMobile }"
        role="dialog"
        aria-modal="true"
        aria-labelledby="feedback-panel-title"
        @click.stop
      >
        <header class="feedback-panel__header">
          <h2 id="feedback-panel-title" class="feedback-panel__title">
            <i class="fas fa-comment-dots" aria-hidden="true"></i>
            Support
          </h2>
          <button
            type="button"
            class="feedback-panel__close"
            aria-label="Close and clear support form"
            @click="handleClearAndClose"
          >
            <i class="fas fa-xmark"></i>
          </button>
        </header>

        <div class="feedback-panel__body">
          <p class="feedback-panel__intro">
            Opens GitHub to create an issue in the JustCropIt repository.
            Do not include passwords or API keys.
          </p>

          <form id="feedback-form" class="feedback-form" @submit.prevent="handleSubmit">
            <div class="feedback-field">
              <label for="feedback-type">Type</label>
              <div class="feedback-select-wrap">
                <select
                  id="feedback-type"
                  v-model="form.type"
                  class="feedback-select"
                  :disabled="submitting"
                >
                  <option value="bug">Report a bug</option>
                  <option value="feature">Request a feature</option>
                  <option value="general">General feedback</option>
                </select>
                <i class="fas fa-chevron-down feedback-select-icon" aria-hidden="true"></i>
              </div>
            </div>

            <div class="feedback-field">
              <label for="feedback-title">Title</label>
              <input
                id="feedback-title"
                v-model="form.title"
                type="text"
                class="feedback-input"
                placeholder="Short summary"
                maxlength="200"
                :disabled="submitting"
                required
              />
            </div>

            <div class="feedback-field">
              <label for="feedback-message">Message</label>
              <textarea
                id="feedback-message"
                v-model="form.message"
                class="feedback-textarea"
                rows="6"
                placeholder="What happened, or what would you like to see?"
                maxlength="8000"
                :disabled="submitting"
                required
              ></textarea>
            </div>

            <div class="feedback-field">
              <label for="feedback-contact">Contact (optional)</label>
              <input
                id="feedback-contact"
                v-model="form.contact"
                type="email"
                class="feedback-input"
                placeholder="Email"
                maxlength="320"
                :disabled="submitting"
                autocomplete="email"
              />
            </div>

            <p v-if="errorMessage" class="feedback-error" role="alert">
              {{ errorMessage }}
            </p>
          </form>

          <p class="feedback-panel__footer-note">
            <a
              :href="issuesUrl"
              target="_blank"
              rel="noopener noreferrer"
              class="feedback-link"
            >
              View existing issues
            </a>
            on GitHub
          </p>

          <section class="support-section" aria-labelledby="support-heading">
            <h3 id="support-heading" class="support-section__title">
              Support the project
            </h3>
            <p class="support-section__copy">
              Donations help keep JustCropIt free to build and maintain.
            </p>
            <a
              class="support-link"
              :href="coffeeUrl"
              target="_blank"
              rel="noopener noreferrer"
            >
              <i class="fas fa-mug-hot" aria-hidden="true"></i>
              Buy me a coffee
            </a>
            <a
              class="support-link"
              :href="sponsorsUrl"
              target="_blank"
              rel="noopener noreferrer"
            >
              <i class="fab fa-github" aria-hidden="true"></i>
              GitHub Sponsors
            </a>
          </section>
        </div>

        <footer class="feedback-panel__footer">
          <button
            type="button"
            class="feedback-btn"
            :disabled="submitting"
            @click="handleClose"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="feedback-form"
            class="feedback-btn feedback-btn--primary"
            :disabled="submitting || !canSubmit"
          >
            <i
              v-if="submitting"
              class="fas fa-spinner fa-spin"
              aria-hidden="true"
            ></i>
            {{ submitting ? 'Opening GitHub…' : 'Submit' }}
          </button>
        </footer>
      </aside>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch, onMounted, onUnmounted } from 'vue';
import { useMediaQuery } from '@vueuse/core';
import { GITHUB_ISSUES_URL, GITHUB_SPONSORS_URL, BUY_ME_A_COFFEE_URL } from '../constants/github';
import {
  openGitHubIssue,
  type FeedbackType,
} from '../utils/feedback/buildGitHubIssueUrl';
import { HISTORY_PANEL_MOBILE_BREAKPOINT_PX } from '../constants/optimization';

const props = defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'submitted'): void;
}>();

const isMobile = useMediaQuery(
  `(max-width: ${HISTORY_PANEL_MOBILE_BREAKPOINT_PX}px)`
);

const issuesUrl = GITHUB_ISSUES_URL;
const coffeeUrl = BUY_ME_A_COFFEE_URL;
const sponsorsUrl = GITHUB_SPONSORS_URL;
const submitting = ref(false);
const errorMessage = ref('');

const form = reactive({
  type: 'bug' as FeedbackType,
  title: '',
  message: '',
  contact: '',
});

const canSubmit = computed(
  () => form.title.trim().length > 0 && form.message.trim().length > 0
);

function resetForm(): void {
  form.type = 'bug';
  form.title = '';
  form.message = '';
  form.contact = '';
  errorMessage.value = '';
}

function handleClose(): void {
  if (submitting.value) return;
  emit('close');
}

function handleClearAndClose(): void {
  if (submitting.value) return;
  resetForm();
  emit('close');
}

async function handleSubmit(): Promise<void> {
  if (!canSubmit.value || submitting.value) return;

  errorMessage.value = '';
  submitting.value = true;

  try {
    const popup = openGitHubIssue({
      type: form.type,
      title: form.title,
      message: form.message,
      contact: form.contact,
    });

    if (!popup) {
      errorMessage.value =
        'Your browser blocked the GitHub tab. Allow pop-ups for this site and try again.';
      return;
    }

    resetForm();
    emit('submitted');
    emit('close');
  } finally {
    submitting.value = false;
  }
}

function onKeydown(event: KeyboardEvent): void {
  if (!props.open) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    handleClose();
  }
}

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) {
      submitting.value = false;
    }
  }
);

onMounted(() => {
  window.addEventListener('keydown', onKeydown);
});

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown);
});
</script>

<style scoped>
.feedback-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1250;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  justify-content: flex-end;
  align-items: stretch;
}

.feedback-panel {
  width: min(360px, 100%);
  max-height: 100vh;
  background: rgba(18, 18, 20, 0.98);
  border-left: 1px solid rgba(255, 255, 255, 0.1);
  display: flex;
  flex-direction: column;
  box-shadow: -8px 0 32px rgba(0, 0, 0, 0.35);
}

.feedback-panel--mobile {
  width: 100%;
  max-height: 85vh;
  align-self: flex-end;
  border-left: none;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 16px 16px 0 0;
}

.feedback-backdrop:has(.feedback-panel--mobile) {
  align-items: flex-end;
}

.feedback-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.feedback-panel__title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.92);
  display: flex;
  align-items: center;
  gap: 8px;
}

.feedback-panel__close {
  background: transparent;
  border: none;
  color: rgba(255, 255, 255, 0.7);
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 6px;
}

.feedback-panel__close:hover {
  background: rgba(255, 255, 255, 0.08);
  transform: none;
}

.feedback-panel__body {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

.feedback-panel__intro {
  margin: 0 0 16px;
  font-size: 13px;
  line-height: 1.5;
  color: rgba(255, 255, 255, 0.5);
}

.feedback-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.feedback-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.feedback-field label {
  font-size: 0.65rem;
  font-weight: 600;
  letter-spacing: 0.4px;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.55);
}

.feedback-input,
.feedback-textarea,
.feedback-select {
  width: 100%;
  font: inherit;
  font-size: 0.875rem;
  color: rgba(255, 255, 255, 0.9);
  background: rgba(18, 18, 26, 0.98);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  padding: 10px 12px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
  transition: border-color 0.2s ease, background 0.2s ease, box-shadow 0.2s ease;
}

.feedback-textarea {
  resize: vertical;
  min-height: 120px;
  line-height: 1.45;
}

.feedback-input::placeholder,
.feedback-textarea::placeholder {
  color: rgba(255, 255, 255, 0.35);
}

.feedback-input:focus,
.feedback-textarea:focus,
.feedback-select:focus {
  outline: none;
  border-color: rgba(212, 175, 55, 0.45);
  box-shadow: 0 0 0 2px rgba(212, 175, 55, 0.16), 0 4px 16px rgba(0, 0, 0, 0.4);
}

.feedback-select-wrap {
  position: relative;
}

.feedback-select {
  appearance: none;
  padding-right: 40px;
  cursor: pointer;
}

.feedback-select option {
  background: #12121a;
  color: rgba(255, 255, 255, 0.9);
}

.feedback-select-icon {
  position: absolute;
  right: 12px;
  top: 50%;
  transform: translateY(-50%);
  pointer-events: none;
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.45);
}

.feedback-error {
  margin: 0;
  font-size: 12px;
  color: #f0a0a8;
}

.feedback-panel__footer-note {
  margin: 16px 0 0;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.4);
  text-align: center;
}

.feedback-link {
  color: #d4af37;
  text-decoration: none;
}

.feedback-link:hover {
  color: #ffd700;
  text-decoration: underline;
}

.support-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.support-section__title {
  margin: 0;
  font-size: 0.65rem;
  font-weight: 600;
  letter-spacing: 0.4px;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.55);
}

.support-section__copy {
  margin: 0 0 4px;
  font-size: 13px;
  line-height: 1.45;
  color: rgba(255, 255, 255, 0.5);
}

.support-link {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(18, 18, 26, 0.98);
  color: rgba(255, 255, 255, 0.9);
  font-size: 13px;
  font-weight: 600;
  text-decoration: none;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
}

.support-link i {
  width: 1.1em;
  color: #d4af37;
}

.support-link:hover {
  background: linear-gradient(135deg, rgba(212, 175, 55, 0.22) 0%, rgba(212, 175, 55, 0.1) 100%);
  color: #ffd700;
  border-color: rgba(255, 255, 255, 0.08);
  box-shadow: 0 2px 8px rgba(212, 175, 55, 0.2);
}

.feedback-panel__footer {
  display: flex;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.feedback-btn {
  flex: 1;
  padding: 8px 12px;
  min-height: 36px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.9);
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.feedback-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.1);
  transform: none;
}

.feedback-btn--primary {
  background: rgba(255, 255, 255, 0.12);
  border-color: rgba(255, 255, 255, 0.15);
}

.feedback-btn--primary:hover:not(:disabled) {
  background: linear-gradient(135deg, rgba(212, 175, 55, 0.22) 0%, rgba(212, 175, 55, 0.1) 100%);
  color: #ffd700;
  border-color: rgba(255, 255, 255, 0.08);
  box-shadow: 0 2px 8px rgba(212, 175, 55, 0.2);
}
</style>
