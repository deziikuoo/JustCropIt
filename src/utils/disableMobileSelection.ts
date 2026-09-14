import {
  LAYOUT_COMPACT_MEDIA,
  LAYOUT_COARSE_POINTER_MEDIA,
} from "../constants/layout";

const MOBILE_NO_SELECT_MEDIA = `${LAYOUT_COMPACT_MEDIA}, ${LAYOUT_COARSE_POINTER_MEDIA}`;

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return target.isContentEditable;
}

function isLinkTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest("a[href]"));
}

function isMobileSelectionContext(): boolean {
  return window.matchMedia(MOBILE_NO_SELECT_MEDIA).matches;
}

/**
 * Block native long-press highlight/copy menus on mobile so hold gestures
 * (open edits toolkit) are not stolen by the browser. Form fields and links
 * keep their default behavior.
 */
export function disableMobileTextSelection(): void {
  if (typeof document === "undefined") return;

  const onSelectStart = (event: Event) => {
    if (!isMobileSelectionContext() || isEditableTarget(event.target)) return;
    event.preventDefault();
  };

  const onContextMenu = (event: Event) => {
    if (!isMobileSelectionContext()) return;
    if (isEditableTarget(event.target) || isLinkTarget(event.target)) return;
    event.preventDefault();
  };

  document.addEventListener("selectstart", onSelectStart);
  document.addEventListener("contextmenu", onContextMenu);
}
