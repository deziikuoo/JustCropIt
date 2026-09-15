export const DEBUG_REVEAL_EVENT = "justcropit:reveal-debug";

/** Long-press the JustCropIt title to open hidden debug / edit panels. */
export function revealDebugTools(): void {
  window.dispatchEvent(new Event(DEBUG_REVEAL_EVENT));
}

export function onRevealDebugTools(handler: () => void): () => void {
  window.addEventListener(DEBUG_REVEAL_EVENT, handler);
  return () => window.removeEventListener(DEBUG_REVEAL_EVENT, handler);
}
