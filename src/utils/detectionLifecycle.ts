/**
 * Page-level detection runtime teardown.
 */

import { shutdownDetectionRuntime } from './detectionWorkerPool';

let hooked = false;

export function installDetectionLifecycle(): void {
  if (hooked || typeof window === 'undefined') return;
  hooked = true;
  window.addEventListener('pagehide', shutdownDetectionRuntime);
}
