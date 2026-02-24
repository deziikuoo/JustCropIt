# Google Pixel 10 Pro XL — Testing & Layout Reference

Use these specs when testing JustCropIt on a **Google Pixel 10 Pro XL** so spacing and components stay correct and professional.

---

## 1. Viewport (what the browser uses)

| Orientation | Typical viewport (CSS px) | Use for |
|-------------|---------------------------|--------|
| **Portrait** | **~412 × 915** to **~430 × 932** | Main testing; DevTools device "Pixel 10 Pro XL" or similar |
| **Landscape** | **~915 × 412** to **~932 × 430** | Optional; 20:9 becomes narrow in height |

- **Device resolution (physical):** 1344 × 2992 px (20:9).
- **Device pixel ratio (DPR):** ~3.1 (browser scales to CSS pixels).
- **Current app breakpoints:** `max-width: 480px` (small/mobile), `max-width: 768px` (tablet).  
  On this device in portrait you are in the **&lt; 480px** range, so all “mobile” styles apply.

**For Chrome DevTools:** Add a custom device with width **412** or **430** px and height **915** or **932** px (or use a preset for “Pixel 10 Pro XL” if available).

---

## 2. Safe areas (notch, corners, home bar)

The phone has a punch-hole and rounded corners; the browser exposes insets.

| CSS / meta | Purpose |
|------------|--------|
| `env(safe-area-inset-top)` | Status bar / notch — already used in PhotoGrid padding |
| `env(safe-area-inset-bottom)` | Home indicator / gesture bar |
| `env(safe-area-inset-left)` | Rounded corner or notch side |
| `env(safe-area-inset-right)` | Rounded corner or notch side |

**Check:** In the app, any full-width/full-height UI (modals, toolbars, bottom bars) should use these in padding so content is not under the notch or home bar. The project already uses `env(safe-area-inset-top, 0px)` in a few places; consider adding **safe-area-inset-bottom** for fixed bottom elements.

---

## 3. Touch targets

| Spec | Minimum size | Where it matters in the app |
|------|----------------|-----------------------------|
| **Material Design** | 48 × 48 dp (CSS px) | Buttons, checkboxes, list rows |
| **Apple HIG** | 44 × 44 pt | Same idea for tap targets |

On Pixel 10 Pro XL, **48px** minimum for primary actions (Select, Crop, Flip, Download, Delete, checkboxes, size buttons) keeps taps reliable and avoids mis-taps. Existing button/min-height values in the app are in that range; keep any new controls ≥ 44–48px.

---

## 4. Display & performance (already covered in OptimizationImp2.md)

| Spec | Value | Relevance |
|------|--------|-----------|
| **Refresh rate** | 120 Hz | Smooth scroll; `touch-action: pan-y` and passive listeners help. |
| **Brightness** | Up to 2200 nits (HBM), 3300 peak | Ensure text/UI contrast in bright light. |
| **Aspect** | 20:9 | Long vertical scroll; virtual scroll and content-visibility help. |

No extra layout numbers are required beyond viewport and safe areas above.

---

## 5. Quick checklist for “professional” layout on device

1. **Viewport:** Test at **412 × 915** (or 430 × 932) in portrait.
2. **Breakpoints:** Confirm layout uses the **&lt; 480px** rules (grid, sidebars, padding).
3. **Safe areas:** Top/bottom/left/right of the screen have padding so nothing is clipped by notch or home bar; use `env(safe-area-inset-*)`.
4. **Touch targets:** Buttons and tappable areas are at least **44–48px** in the smaller dimension.
5. **Spacing:** Side padding (e.g. 8px / 12px / 16px) looks even and consistent; grid gap (e.g. 12px on small) doesn’t feel cramped.
6. **Fixed/overlay UI:** Performance dashboard, optimization check modal, deletion notification, and any bottom bar respect safe areas and don’t overlap critical content.

---

## 6. Post-implementation verification

After implementing viewport, safe-area, and touch-target changes, verify in Chrome DevTools:

1. **Viewport:** Custom device **412 × 915** or **430 × 932** (portrait); device pixel ratio and “Mobile” type enabled.
2. **Safe areas:** No content under notch or home bar; fixed elements (counters, StorageAlert, DeletionNotification, dev toggles) use `env(safe-area-inset-*)`; grid and modals have even spacing and no clipping at rounded corners.
3. **Touch targets:** Buttons and checkboxes (Select controls, photo card Flip/Crop/Download/Delete, photo checkbox) are **≥ 48 px** in the smaller dimension at 480px.
4. **Fixed UI:** Performance dashboard, Optimization check modal, Copy/Paste visualizer toggle, and deletion notification sit above the home bar and respect bottom inset.

---

## 7. One-liner reference

**Pixel 10 Pro XL (portrait):** 6.8″, 1344×2992 (20:9), ~412–430 CSS px wide, 120 Hz, ~88% screen-to-body. Test at **412×915** or **430×932**; use **env(safe-area-inset-*)** and **≥48px** touch targets for a professional fit.
