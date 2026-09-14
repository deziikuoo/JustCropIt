import {
  LAYOUT_COMPACT_MEDIA,
  LAYOUT_COARSE_POINTER_MEDIA,
} from "../constants/layout";

const TOUCH_SELECT_CLASS = "disable-touch-select";
const MOBILE_NO_SELECT_MEDIA = `${LAYOUT_COMPACT_MEDIA}, ${LAYOUT_COARSE_POINTER_MEDIA}, (hover: none)`;

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return target.isContentEditable;
}

function isLinkTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest("a[href]"));
}

function isEditableActive(): boolean {
  const active = document.activeElement;
  if (isEditableTarget(active)) return true;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return false;
  const node = sel.anchorNode;
  const el = node instanceof Element ? node : node?.parentElement;
  return isEditableTarget(el);
}

/**
 * Chrome on Android often reports touch devices as coarse, but can miss
 * `selectstart` entirely and still run image long-press / Lens highlight.
 * Treat any compact, coarse, or non-hover pointer as a selection-block context.
 */
export function isMobileSelectionContext(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia(MOBILE_NO_SELECT_MEDIA).matches) return true;
  const hasTouch =
    navigator.maxTouchPoints > 0 || "ontouchstart" in window;
  const hasFineHover = window.matchMedia(
    "(hover: hover) and (pointer: fine)"
  ).matches;
  return hasTouch && !hasFineHover;
}

function clearNonEditableSelection(): void {
  if (isEditableActive()) return;
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0) sel.removeAllRanges();
}

/**
 * Block native long-press highlight/copy/save-image on mobile so hold
 * gestures are not stolen. Chrome Android does not fire `selectstart` for
 * touch selection, so also clear ranges on `selectionchange` and while a
 * finger is down. Form fields and links keep their default behavior.
 */
export function disableMobileTextSelection(): void {
  if (typeof document === "undefined") return;

  const syncClass = () => {
    document.documentElement.classList.toggle(
      TOUCH_SELECT_CLASS,
      isMobileSelectionContext()
    );
  };
  syncClass();
  window.addEventListener("resize", syncClass, { passive: true });

  const onSelectStart = (event: Event) => {
    if (!isMobileSelectionContext() || isEditableTarget(event.target)) return;
    event.preventDefault();
  };

  const onContextMenu = (event: Event) => {
    if (!isMobileSelectionContext()) return;
    if (isEditableTarget(event.target) || isLinkTarget(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    clearNonEditableSelection();
  };

  const onSelectionChange = () => {
    if (!isMobileSelectionContext()) return;
    clearNonEditableSelection();
  };

  let holdWatch: number | null = null;

  const stopHoldWatch = () => {
    if (holdWatch !== null) {
      cancelAnimationFrame(holdWatch);
      holdWatch = null;
    }
  };

  const startHoldWatch = () => {
    stopHoldWatch();
    const started = performance.now();
    const tick = () => {
      clearNonEditableSelection();
      // Cover Chrome's ~400–500ms long-press window plus a little after.
      if (performance.now() - started < 1500) {
        holdWatch = requestAnimationFrame(tick);
      } else {
        holdWatch = null;
      }
    };
    holdWatch = requestAnimationFrame(tick);
  };

  const onTouchStart = (event: TouchEvent) => {
    if (!isMobileSelectionContext() || isEditableTarget(event.target)) return;
    clearNonEditableSelection();
    startHoldWatch();
  };

  const onTouchEnd = () => {
    stopHoldWatch();
    clearNonEditableSelection();
  };

  document.addEventListener("selectstart", onSelectStart, { capture: true });
  document.addEventListener("contextmenu", onContextMenu, { capture: true });
  document.addEventListener("selectionchange", onSelectionChange);
  document.addEventListener("touchstart", onTouchStart, {
    capture: true,
    passive: true,
  });
  document.addEventListener("touchend", onTouchEnd, {
    capture: true,
    passive: true,
  });
  document.addEventListener("touchcancel", onTouchEnd, {
    capture: true,
    passive: true,
  });
}
