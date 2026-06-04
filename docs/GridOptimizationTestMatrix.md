# Grid Optimization Test Matrix

Manual verification for Phases 0–8 of the grid memory and rendering optimization work. Run in **development mode** so the Optimization Check modal (✓) and Performance Dashboard (⚡) are available.

For mobile scenarios, use viewport **412 × 915** per [Pixel10ProXL_TestingSpecs.md](Pixel10ProXL_TestingSpecs.md).

---

## Automated pre-check

Before manual tests, open the **Optimization Check** modal and confirm:

- All Phase 8 checks pass (or `phase8-grid-img-dom` is info when grid is empty)
- With 10+ photos loaded and refreshed: `phase8-grid-img-dom` passes (blob: URLs only)
- `phase8-grid-source-audit` passes

During scroll tests, open the **Performance Dashboard** and watch **Grid Runtime** counts.

---

## Test matrix

| # | Scenario | Steps | Expected |
|---|----------|-------|----------|
| 1 | Upload 30 photos | Upload batch; watch grid fill | ≤6 concurrent decode; ≤48 active URLs; thumbs visible; thumbhash preview may show before URL |
| 2 | Upload 120 (desktop viewport) | Desktop width ≥481px; upload 120 photos | Virtual scroll ON at 150; no full-grid URL storm; Performance Dashboard URLs stay ≤48 |
| 3 | Upload 90 (mobile 412px) | DevTools mobile 412×915; upload 90 photos | Virtual scroll ON at 80 |
| 4 | Scroll 200 photos 30s | Load 200 photos; scroll up/down rapidly 30s | Memory plateau in DevTools; `gridUrlsActive` ≤ LRU max (48); no sustained growth |
| 5 | Drag-select 20 rows + auto-scroll | Select mode; drag across many rows with auto-scroll | Range selection correct; indices between unmounted cards included |
| 6 | Select all + batch flip | Select all; batch flip horizontal | Thumbs refresh; selection preserved; placeholders during regen OK |
| 7 | Crop one photo | Open crop on visible photo; apply crop | Modal uses full-res; grid thumb + thumbhash regen after close |
| 8 | Undo/redo flip | Flip one photo; undo; redo | Thumb and thumbhash match restored state |
| 9 | Reload page | Load library; reload browser | Thumbs + thumbhash from IndexedDB; idle backfill for legacy thumbs without hash |
| 10 | Delete photo | Delete selected photo(s) | URLs revoked; decode jobs cancelled; no errors in console |
| 11 | Grid size S→XL | Change photo size S → XL with 50+ photos | No animation storm; layout stable; `allowGridAnimation` gating OK |
| 12 | Download single + batch zip | Download one photo; batch download selection | Full-resolution files unchanged |
| 13 | Upload 5 with thumbhash | Upload 5 new photos | Color preview before Tier-1 URL; no layout shift (fixed cell size) |
| 14 | Legacy photo (thumb, no hash) | Use IDB record with thumbnail but no thumbhash metadata | Idle backfill adds hash; preview on next load |
| 15 | Photo without hash or thumb | Photo missing both (or cleared after edit before regen) | Shimmer or empty shell only; no crash |

---

## Regression targets (Chrome DevTools)

### Memory

- Loading **100 photos** should stay well below decoding 100 full-res images in the grid (~2× single full-image decode baseline is a rough upper bound).
- Take a heap snapshot after scroll settles; object URL count should track Performance Dashboard `gridUrlsActive`.

### Performance

- **Performance** panel: no sustained long tasks **>50ms** during normal scroll.
- Occasional spikes during upload/backfill are acceptable; scroll itself should stay smooth.

### Optimization Check

- With photos loaded, all Phase 8 automated checks pass.
- `phase8-grid-img-dom`: Tier-1 `<img>` elements use `blob:` only (thumbhash previews use `data:` in `.image-placeholder__preview`, excluded from check).

---

## Quick smoke subset

Minimum manual pass before merge:

1. Row **1** — upload + URL/decode bounds  
2. Row **4** — scroll memory plateau  
3. Row **7** — crop full-res isolation + thumb regen  
4. Row **13** — thumbhash placeholder  

Document results in PR notes or checklist.

---

## References

- Parent plan: `.cursor/plans/grid_memory_and_rendering_optimization.plan.md`
- Optimization rules: `docs/OptimizationImp2.md`
- Device viewport: `docs/Pixel10ProXL_TestingSpecs.md`
