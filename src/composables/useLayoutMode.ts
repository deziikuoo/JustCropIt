import { computed } from "vue";
import { useMediaQuery } from "@vueuse/core";
import {
  LAYOUT_COARSE_POINTER_MEDIA,
  LAYOUT_PHONE_MEDIA,
  LAYOUT_WIDE_MEDIA,
} from "../constants/layout";

export type LayoutMode = "phone" | "tablet" | "wide";

export function useLayoutMode() {
  const isPhone = useMediaQuery(LAYOUT_PHONE_MEDIA);
  const isWide = useMediaQuery(LAYOUT_WIDE_MEDIA);
  const isCoarsePointer = useMediaQuery(LAYOUT_COARSE_POINTER_MEDIA);

  const mode = computed<LayoutMode>(() => {
    if (isPhone.value) return "phone";
    if (isWide.value) return "wide";
    return "tablet";
  });

  const isTablet = computed(() => mode.value === "tablet");
  const isCompact = computed(() => !isWide.value);

  return {
    mode,
    isPhone,
    isTablet,
    isWide,
    isCompact,
    isCoarsePointer,
  };
}
