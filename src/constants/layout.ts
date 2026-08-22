/** Phone CSS width ceiling (zoom floor 320 through Pro Max ~448). */
export const LAYOUT_PHONE_MAX_PX = 599;

/** iPad mini / 11-inch portrait and similar tablets. */
export const LAYOUT_TABLET_MAX_PX = 1023;

/** 13-inch iPad portrait, iPad landscape, and desktop. */
export const LAYOUT_WIDE_MIN_PX = 1024;

export const LAYOUT_PHONE_MEDIA = `(max-width: ${LAYOUT_PHONE_MAX_PX}px)`;
export const LAYOUT_TABLET_MEDIA = `(min-width: ${LAYOUT_PHONE_MAX_PX + 1}px) and (max-width: ${LAYOUT_TABLET_MAX_PX}px)`;
export const LAYOUT_COMPACT_MEDIA = `(max-width: ${LAYOUT_TABLET_MAX_PX}px)`;
export const LAYOUT_WIDE_MEDIA = `(min-width: ${LAYOUT_WIDE_MIN_PX}px)`;
export const LAYOUT_COARSE_POINTER_MEDIA = "(pointer: coarse)";
