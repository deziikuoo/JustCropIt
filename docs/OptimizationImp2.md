# JustCropIt — Optimization Implementation Plan (v2)

**Document version:** 1.0  
**Status:** Planning  
**Scope:** New optimization features, integration rules, and implementation priority for large photo libraries (300+ / 3000+ photos).

---

## Table of Contents

1. [Project Context & Goals](#1-project-context--goals)
2. [Implementation Parameters (Rules)](#2-implementation-parameters-rules)
3. [Optimization Features Overview](#3-optimization-features-overview)
4. [Priority Tiers & Implementation Order](#4-priority-tiers--implementation-order)
5. [Feature Specifications](#5-feature-specifications)
6. [Integration & Conflict Resolution](#6-integration--conflict-resolution)
7. [Constants & Configuration](#7-constants--configuration)
8. [File & Code Structure](#8-file--code-structure)
9. [Current Code Reference (No Redundancy)](#9-current-code-reference-no-redundancy)

---

## 1. Project Context & Goals

- **Product:** JustCropIt — in-browser batch photo editing (crop, flip, paste settings, download).
- **Scale:** Users upload large libraries (300+ to 3000+ photos).
- **Goals:** Smooth UI during batch operations, no long freezes, good experience on mobile (e.g. Pixel 10 Pro and similar).
- **Stack:** Vue 3, TypeScript, Vite, Canvas API, IndexedDB (idb).

**Existing optimizations (already in project):**

- Performance logger + dashboard (dev-only metrics, export, comparison).
- Lazy image loading in grid (`useLazyImage` + Intersection Observer).
- Debounce on select-all / per-item select.
- Throttle on pinch-zoom scale updates.

---

## 2. Implementation Parameters (Rules)

All new optimization features must follow these two rules.

### Rule 1: Seamless Integration for Related Features

**Principle:** When two or more optimizations are similar and can work together, implement them as one coherent layer: shared types, consistent naming, and a single call path where possible. They should feel like one “optimization system,” not separate patches.

**In practice:**

- Use a single abstraction for “run batch operation” that handles both execution (workers or main thread) and measurement (performance logger) with the same types and one call site.
- For grid rendering, use one “visibility” concept (e.g. which indices are in view) shared by virtual scroll and lazy loading, with consistent naming (`visibleIndices`, `isInViewport`, etc.).

### Rule 2: Dynamic Choice When Features Can Conflict

**Principle:** When two strategies address the same problem but can conflict or duplicate work, the application must **choose at runtime** which strategy to use (or how to combine them), instead of hardcoding one or running both in a conflicting way.

**In practice:**

- **Grid:** If `photos.length >= VIRTUAL_SCROLL_PHOTO_THRESHOLD` → use virtual scrolling (only mount visible rows). Else → use current “full DOM + lazy load” approach. Only one strategy is active for a given photo count.
- **Batch processing:** If workers are supported and batch size warrants it → use worker pool. Else → use main-thread path. The same API returns results; the implementation is chosen dynamically (e.g. capability check + optional batch-size threshold).

---

## 3. Optimization Features Overview

| Feature | Priority | Effectiveness (3000+ scale) | Status |
|--------|----------|-----------------------------|--------|
| Web Workers (flip / crop / paste) | P0 | Critical | Implemented |
| Virtual scrolling (grid, 300+ threshold) | P0 | Critical | Implemented |
| IndexedDB write batching | P1 | High | Implemented |
| Batch download parallelization | P1 | High | Implemented |
| content-visibility (CSS) | P2 | Medium | Implemented |
| requestIdleCallback / chunked work | P2 | Medium | Implemented |
| Passive touch/scroll listeners | P2 | Medium | Implemented |
| Lazy image loading | — | High | Implemented |
| Debounce / throttle | — | Supporting | Implemented |
| Performance logger / dashboard | — | Dev/tuning | Implemented |

---

## 4. Priority Tiers & Implementation Order

### P0 — Critical (implement first)

1. **Web Workers for batch image operations**  
   - Eliminates main-thread blocking during batch flip, crop, and paste.  
   - Enables smooth UI and multi-core use on large libraries.

2. **Virtual scrolling for the photo grid**  
   - Threshold: **300+ photos** (see [Constants](#7-constants--configuration)).  
   - Prevents huge DOM (3000+ nodes), reduces layout/scroll cost and memory.  
   - Required for 300+ and 3000+ libraries to feel responsive.

### P1 — High (implement after P0)

3. **IndexedDB write batching**  
   - Batch puts within a single transaction (or chunked transactions) for batch paste, delete, crop.  
   - Reduces I/O time and UI stalls when updating many photos.

4. **Batch download parallelization**  
   - Use parallel `arrayBuffer()` reads (e.g. `Promise.all` in chunks) instead of strictly sequential.  
   - Speeds up “download selected” for large selections.

### P2 — Medium (implement after P1)

5. **content-visibility (CSS)**  
   - Apply to grid items so the browser can skip painting off-screen items.  
   - Complements virtual scrolling (e.g. within visible window) and helps if full DOM is still used below the virtual-scroll threshold.

6. **requestIdleCallback / chunked work**  
   - Use for non-critical post-batch work (e.g. UI updates, cleanup).  
   - Keeps main thread responsive under thermal throttling.

7. **Passive touch/scroll listeners**  
   - Where `preventDefault()` is not required, use passive listeners so the browser can optimize scroll and touch handling (better scroll FPS on mobile).

---

## 5. Feature Specifications

### 5.1 Web Workers (P0)

**Purpose:** Offload canvas-based flip, crop, and paste to background threads so the main thread stays responsive and multiple CPU cores are used.

**How it works:**

- **Worker pool:** Create a pool of Web Workers (e.g. `Math.min(WORKER_POOL_MAX, navigator.hardwareConcurrency - 1 || 4)` to leave UI core free). Use `navigator.deviceMemory` to tune capacity. Reuse workers.
- **Tasks:** Main thread sends image data (ArrayBuffer) via **Transferable Objects**. Workers use `createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' })` and OffscreenCanvas.
- **Result:** Worker returns processed image (ArrayBuffer) via Transferable. Explicitly call `bitmap.close()` in worker. Main thread converts to File via `blobToFile`, updates `photos.value[index]`, and triggers storage (single `updatePhoto` or batched `updatePhotosBatch`; see 5.3).
- **Fallback:** If workers or OffscreenCanvas are unsupported, run the existing main-thread canvas path. **Rule 2:** one code path chooses “workers” or “main thread” at runtime (e.g. feature detection + optional minimum batch size).
- **Integration with performance logger (Rule 1):** The same “run batch” abstraction that invokes workers or main thread should call `performanceLogger.startMeasurement` / `endMeasurement` and pass `workerUsed: true/false` so metrics stay consistent.

**Relevant existing docs:** `WebWorkerParallelPro.md` (phases, message types, pool design). **Code reference:** Section 9.1 (App.vue), 9.6 (what not to add). Use existing handler names: `handleBatchFlip`, `handleBatchCropNext`, `handlePasteSettings`; helpers `applyFlipsRotationAndCrop`, `applyRotationAndCrop`, `blobToFile`; keep `performanceLogger.startMeasurement` / `endMeasurement` in those handlers.

---

### 5.2 Virtual Scrolling (P0)

**Purpose:** Render only a window of photo cards (e.g. ~20–50 items) in the DOM so that 300+ or 3000+ photo libraries do not create 3000+ DOM nodes.

**How it works:**

- **Threshold:** When `photos.length >= VIRTUAL_SCROLL_PHOTO_THRESHOLD` (300), switch to virtual scrolling. Below that, keep current behavior: full list in DOM + lazy loading (**Rule 2**).
- **Mechanics:** Maintain visible range (`startIndex`, `endIndex`). Use `touch-action: pan-y` on grid container for native 120Hz scroll. Introduce a computed **display list**: when above threshold, `displayList` = `photos.slice(startIndex, endIndex)` and a mapping from display index to real index. When below threshold, `displayList = photos` and display index = real index. Use `displayList` in the existing `v-for`; in every handler that emits, pass the **real** index.
- **Selection / drag:** Selection and drag-selection logic must work with virtual indices (data still has full `photos` array; only the *rendered* indices change). Ensure selected state is preserved when items are unmounted and remounted.
- **Rule 1:** When virtual scroll is active, “visibility” for loading images is already bounded to the visible window. Reuse the same visibility/range concept for “which images to decode/load” (lazy load within the virtual window) so virtual scroll and lazy load share one mental model. Reuse **visibleIndices**, **displayList**, and **displayIndexToRealIndex**; emit using real index. Code reference: Section 9.4.

---

### 5.3 IndexedDB Write Batching (P1)

**Purpose:** Reduce time spent on IndexedDB writes during batch paste, batch crop, and bulk delete by batching puts into fewer transactions.

**How it works:**

- **Current:** In `handleBatchCropNext` and `handlePasteSettings`, each photo update calls `updatePhoto(photo.id, newFile, metadata)` in a loop.
- **Target:** Add **`updatePhotosBatch(updates)`** in `photoStorage.ts` (one transaction, or chunked). Collect all updates in the handler, then call `updatePhotosBatch(collected)` once. Keep `updatePhoto` for single-photo ops (`handleFlip`, `handleCrop`, `handleRevert`, undo/redo).
- **Integration:** Use the same batch boundaries as the app’s batch operations (e.g. one transaction per “batch paste” or “batch crop” run). If using undo/redo commands, ensure batch commands still commit storage in a batched way so that Rule 1 is satisfied (one coherent “batch write” path).

---

### 5.4 Batch Download Parallelization (P1)

**Purpose:** Speed up “download selected” by reading multiple photo blobs/arrayBuffers in parallel instead of strictly one-by-one.

**How it works:**

- **Current:** In `handleBatchDownload`, a sequential `await photo.current.arrayBuffer()` then `zip.file(...)` per photo.
- **Target:** For the selected indices, create batches (e.g. 10–20 at a time to limit memory). Per batch, run `Promise.all(indices.map(i => photos.value[i].current.arrayBuffer()))`, then add those to the zip. Proceed to the next batch until done. This is main-thread I/O parallelism; no workers required.
- **Integration:**“download” Keep existing `performanceLogger.endMeasurement(operationId, 'download', ...)`. Code reference: Section 9.1.

---

### 5.5 content-visibility (P2)

**Purpose:** Allow the browser to skip painting (and in some cases layout) for grid items that are off-screen.

**How it works:**

- Apply `content-visibility: auto` and **must** set `contain-intrinsic-size` (to placeholder dimensions) to prevent scrollbar jumping on mobile. Apply to grid item container.
- **Rule 2:** When virtual scrolling is active, only a small set of items exists in the DOM; content-visibility still applies to the few off-screen items in the visible window. When virtual scroll is *not* active (e.g. &lt; 300 photos), content-visibility helps the full-DOM grid. No conflict: both can be enabled; the “best option” for DOM size is already chosen by the 300 threshold.

---

### 5.6 requestIdleCallback / Chunked Work (P2)

**Purpose:** Defer non-critical work to idle time so the main thread stays responsive, especially when the device is under load or thermal throttling.

**How it works:**

- Identify non-critical tasks after batch operations (e.g. clearing temporary state, updating non-essential UI, logging). Schedule them with `requestIdleCallback` (with a short timeout fallback for browsers that support it).
- For very large batches, consider chunking: process N items, then yield (e.g. `await new Promise(r => requestAnimationFrame(r))` or requestIdleCallback) before the next chunk. Prefer doing this in the main-thread fallback path; worker path already keeps main thread freer.
- **Rule 1:** Keep “batch operation” as the single place that decides “run work” and “schedule follow-up”; idle callback is an implementation detail of that path.

---

### 5.7 Passive Touch/Scroll Listeners (P2)

**Purpose:** Improve scroll and touch responsiveness by not blocking the browser’s default scroll behavior where prevention is not needed.

**How it works:**

- In PhotoGrid, drag-selection already uses `document.addEventListener('touchmove', handleDragMove, { passive: false })` — leave as-is. For any other listener that does **not** call `preventDefault()`, use `{ passive: true }`.
- **Primary Optimization:** Use CSS `touch-action` (`pan-y` for grid, `none` for crop canvas) for native 120Hz scroll. **Code reference:** Section 9.4.

---

## 6. Integration & Conflict Resolution

### 6.1 Features That Work Together (Rule 1)

- **Performance logger + Web Workers:** Keep performanceLogger in existing handlers; helper only reports workerUsed. See Section 9.1.
- **Virtual scroll + lazy load:** When virtual scroll is active, “visible range” drives both which nodes exist and which images load. Share `visibleIndices` / “in view” logic and naming so the code reads as one visibility system. See Section 9.4.
- **Batch operations + IndexedDB batching:** Batch paste/crop/delete should trigger one batched storage update (single or chunked transaction), not N separate writes. The batch boundary is the same as the “operation” boundary in the app and in the logger. See Section 9.2.

### 6.2 Features That Require Dynamic Choice (Rule 2)

- **Grid: virtual scroll vs full DOM + lazy load**
  - If `photos.length >= VIRTUAL_SCROLL_PHOTO_THRESHOLD` → use virtual scrolling (only mount visible window).
  - Else → use current implementation (all cards in DOM, lazy load images).
  - Single constant controls the cutoff; no mixing of “full 3000-node DOM” with virtual list.

- **Batch processing: workers vs main thread**
  - If workers and OffscreenCanvas are supported (and optionally `batchSize >= MIN_BATCH_FOR_WORKERS`) → use worker pool.
  - Else → use existing path: `handleFlip` (batch flip), `applyRotationAndCrop` loop (batch crop), `applyFlipsRotationAndCrop` / `handleFlip` (batch paste).
  - The choice is made inside each handler via a per-operation helper (e.g. `runBatchFlip`, `runBatchCropRemaining`, `runBatchPaste`), not a single generic `runBatchImageOp`. See Section 9.1 and 9.6.

---

## 7. Constants & Configuration

Centralize thresholds so behavior can be tuned without scattering magic numbers:

| Constant | Suggested value | Purpose |
|----------|------------------|--------|
| `VIRTUAL_SCROLL_PHOTO_THRESHOLD` | `300` | Minimum photo count to enable virtual scrolling. Below this, full DOM + lazy load is used. |
| `MIN_BATCH_FOR_WORKERS` (optional) | e.g. `2` or `5` | Minimum batch size to use workers (avoids worker overhead for single-image ops). |
| `WORKER_POOL_MAX` | e.g. `8` | Maximum number of workers in the pool (cap relative to `navigator.hardwareConcurrency`). |
| `DOWNLOAD_PARALLEL_BATCH_SIZE` | e.g. `10`–`20` | Number of concurrent `arrayBuffer()` reads per batch during download. |

These can live in a small `src/constants/optimization.ts` (or similar) and be imported where needed.

---

## 8. File & Code Structure

Suggested layout for new and touched files (align with existing project and `WebWorkerParallelPro.md` where applicable):

```
src/
├── constants/
│   └── optimization.ts          # VIRTUAL_SCROLL_PHOTO_THRESHOLD, worker caps, batch sizes
├── workers/
│   ├── imageWorker.ts          # Worker entry: flip, crop, paste via OffscreenCanvas
│   └── workerUtils.ts          # (Optional) shared worker helpers
├── utils/
│   ├── imageWorkerPool.ts      # Pool lifecycle, task queue, progress, fallback
│   ├── photoStorage.ts         # Existing; extend with batched write API where needed
│   └── performanceLogger.ts    # Existing; keep as single place for metrics
├── composables/
│   ├── useLazyImage.ts         # Existing
│   ├── useVirtualScroll.ts    # New: visible range, scroll handling, threshold check
│   └── useImageWorker.ts       # (Optional) Vue-facing wrapper for worker pool
├── components/
│   ├── PhotoGrid.vue           # Integrate virtual scroll when above threshold; passive listeners
│   └── PerformanceDashboard.vue # Existing
└── App.vue                     # Batch ops call single “run batch” path (workers + logger)
```

- **Rule 1:** Shared types (e.g. worker message types, `BatchResult`, visibility types) should live in a single place (e.g. `types/` or next to the main consumer) and be used by workers, pool, logger, and grid.
- **Rule 2:** The decision “virtual scroll or not” should be in one place (e.g. `PhotoGrid.vue` or `useVirtualScroll`) using `VIRTUAL_SCROLL_PHOTO_THRESHOLD`. The decision “workers or main thread” should be in one place (e.g. `imageWorkerPool` or the batch runner in `App.vue`) using capability checks and optional `MIN_BATCH_FOR_WORKERS`.

---

## 9. Current Code Reference (No Redundancy)

This section lists **existing** functions, types, and integration points so new optimizations **extend** them instead of adding redundant code. Use these exact names and call sites when implementing.

### 9.1 App.vue — Batch and single operations

| Purpose | Existing function / flow | Where to integrate new behavior |
|--------|--------------------------|----------------------------------|
| Batch flip | `handleBatchFlip(direction)` — calls `performanceLogger.startMeasurement(operationId)` then `Promise.all(selectedIndices.value.map(i => handleFlip(i, direction)))` then `performanceLogger.endMeasurement(operationId, operationType, selectedIndices.value.length, false)` | **Do not add a new wrapper.** Inside `handleBatchFlip`: (1) keep existing `startMeasurement` / `endMeasurement`; (2) replace the `Promise.all(handleFlip(...))` with a single helper that **chooses** worker path vs main-thread path (e.g. `runBatchFlip(selectedIndices.value, direction)` that returns, then pass `workerUsed: true/false` to `endMeasurement`). The helper runs workers or calls existing `handleFlip` per index. |
| Batch crop (remaining images) | `handleBatchCropNext(blob, crop, rotation)` — crops first image via `handleCrop`, then `Promise.all(remainingIndices.map(...))` using `applyRotationAndCrop(img, rotation, crop, photo.current.type)` and `updatePhoto(photo.id, newFile, {...})` per photo | Same pattern: keep `startMeasurement`/`endMeasurement`; replace the `Promise.all(remainingIndices.map(...))` block with a helper that uses workers or the existing `applyRotationAndCrop` loop. Collect updates for IndexedDB and call **one** batched write (see 9.2) instead of per-photo `updatePhoto` in the loop. |
| Batch paste | `handlePasteSettings(singleIndex?)` — `indicesToPaste` = `singleIndex !== undefined ? [singleIndex] : selectedIndices.value`; uses `applyFlipsRotationAndCrop(img, settings.flips, rotationToApply, settings.crop, photo.original.type)` and `updatePhoto(photo.id, newFile, {...})` per photo; flip-only branch calls `handleFlip(index, "horizontal"\|"vertical")` | Keep `startMeasurement`/`endMeasurement`; replace the `Promise.all(indicesToPaste.map(...))` with a helper that uses workers or existing `applyFlipsRotationAndCrop`/`handleFlip` path. Collect updates and call batched write once (or chunked). |
| Batch download | `handleBatchDownload()` — sequential `for` loop with `await photo.current.arrayBuffer()` then `zip.file(...)`; then `performanceLogger.endMeasurement(...)` | **No new function.** Replace the sequential loop with chunked `Promise.all`: chunk `selectedIndices.value` by `DOWNLOAD_PARALLEL_BATCH_SIZE`, then for each chunk `await Promise.all(chunk.map(i => photos.value[i].current.arrayBuffer()))` and add to zip. Keep the same `operationId` and `endMeasurement` call. |
| Batch delete | `handleBatchDelete()` — `Promise.all(indices.map(i => handleDelete(i)))`; each `handleDelete` calls `deletePhoto(photo.id)` | Optional P1: add `deletePhotos(ids: string[])` in photoStorage (one transaction); in `handleBatchDelete` collect ids and call `deletePhotos(ids)` once, or keep calling `handleDelete`. |
| Single flip | `handleFlip(index, direction)` — uses `FlipCommand` and `undoRedoManager.executeCommand(command)`; `FlipCommand` uses `applyFlipsRotationAndCrop` (via BaseCommand) and `updatePhoto` | Leave as-is for single-image ops. Workers are used only from batch handlers. |
| Single crop | `handleCrop`, `handleCropModalCropped`, `handleBatchCropNext` | Workers only for the batch path in `handleBatchCropNext`. |
| Helpers used by batch/crop/paste | `applyFlipsRotationAndCrop(image, flips, rotation, crop, mimeType)` → `Promise<Blob \| null>`; `applyRotationAndCrop(image, rotation, crop, mimeType)` → `Promise<Blob \| null>`; `blobToFile(blob, fileName, mimeType)`; `blobFromFile(file)` → `Promise<Blob>` | Worker implementations mirror `applyFlipsRotationAndCrop` and `applyRotationAndCrop` (OffscreenCanvas + ImageBitmap). Call existing helpers only when worker path is not used. |

**Performance logger (existing API):** `performanceLogger.startMeasurement(operationId)`; `performanceLogger.endMeasurement(operationId, operationType, batchSize, workerUsed)`. `operationType` must be one of: `'flip-horizontal' | 'flip-vertical' | 'crop' | 'paste' | 'download' | 'delete' | 'upload' | 'select-drag' | 'select-all' | 'revert'` (see `PerformanceMetrics` in `performanceLogger.ts`). When adding workers, pass `workerUsed: true` from the same call sites.

### 9.2 photoStorage.ts — Storage API

| Export | Change for optimization |
|--------|--------------------------|
| `initDB`, `savePhoto`, `updatePhoto`, `loadAllPhotos`, `loadPhoto`, `deletePhoto` | Keep as-is. |
| **New (P1)** | **`updatePhotosBatch(updates: Array<{ id: string; current: File; metadata: { flips; crop?; rotation? } }>) => Promise<void>`** — one `transaction(STORE_NAME, 'readwrite')` (or chunked), then for each update: get existing, build `PhotoData`, put. Call from `handleBatchCropNext` and `handlePasteSettings` instead of looping `updatePhoto`. |
| Optional | `deletePhotos(ids: string[])` for batch delete in one transaction. |

Do **not** add a separate batch save for uploads; critical batching is for **updates** (crop/paste).

### 9.3 performanceLogger.ts — No API change

Existing: `startMeasurement(operationId)`, `endMeasurement(operationId, operationType, batchSize, workerUsed)`, `getMetrics()`, `exportToFile('json'|'csv')`, `compareMetrics(before, after)`. No new functions; when worker path runs, pass `workerUsed: true`.

### 9.4 PhotoGrid.vue — Grid and visibility

| Current piece | Integration with virtual scroll / lazy load |
|---------------|---------------------------------------------|
| **Props** | `photos`, `selectedIndices`, `hasSelection`, `allSelected`, `hasCopiedSettings` — unchanged. |
| **Emits** | All use **real** index (into `photos`). With virtual scroll, map display index → real index before emit (e.g. `emit('flip', realIndex, direction)`). |
| **v-for** | Today: `v-for="(photo, index) in photos"`. **Rule 1:** One computed source: when `photos.length >= VIRTUAL_SCROLL_PHOTO_THRESHOLD` use `displayList` = slice for visible range and `displayIndexToRealIndex(displayIndex)`; else `displayList = photos` and display index = real index. Use `displayList` in `v-for`; convert to real index in handlers. |
| **visibleIndices** | `ref<Set<number>>` — **reuse:** above threshold set from visible range; below threshold keep Intersection Observer via `useLazyImage`. One concept: "in view" drives DOM and `photoUrl`. |
| **photoUrl(file, index)** | Keep; `index` = real index. |
| **setPhotoCardRef(el, index)** | Use real index with virtual scroll. |
| **useLazyImage** | Below threshold only; above threshold visibility = range, no second observer. |
| **Touch/mouse** | P2: use `{ passive: true }` only where handler does **not** call `preventDefault()`. Existing drag `touchmove` uses `passive: false` — leave it. |

### 9.5 Composables (existing, no change)

`useLazyImage(targetRef, rootMargin?)` → `{ isVisible, stop }`. `usePinchZoom` uses `useThrottleFn`. `debounce` in App.vue for `handleToggleSelectAll`, `handleToggleSelect`.

### 9.6 What not to add (avoid redundancy)

- **Do not** add a top-level "runBatchOp" that duplicates `handleBatchFlip` / `handleBatchCropNext` / `handlePasteSettings`. Each handler stays the entry point; it calls a **per-operation** helper (e.g. `runBatchFlip`, `runBatchCropRemaining`, `runBatchPaste`) that chooses worker vs main thread.
- **Do not** add a second performance-measurement path; keep measurement in existing handlers.
- **Do not** add a separate visibility system for virtual scroll; reuse `visibleIndices` (range above threshold, observer below).
- **Do not** add batch save for uploads; prioritize `updatePhotosBatch` for crop/paste.

---

## 10. Advanced Mobile & Hardware Optimizations (Pixel 10 Pro / High-End)

To ensure "native-like" smoothness on high-end Android devices (120Hz screens, high-megapixel cameras), implement these specific technical details within the features above.

### 10.1 Memory & Data Transfer (Crucial for 12MP+ Photos)

- **Transferable Objects:** In `imageWorkerPool` and `imageWorker`, strictly use **Transferable Objects** (the 2nd argument to `postMessage`) when sending image `ArrayBuffer`s. This moves data with **zero-copy**, saving ~50–100ms and ~20MB RAM per photo.
- **Explicit Cleanup:** Call `imageBitmap.close()` immediately after drawing in the worker. Do not wait for Garbage Collection, as Chrome Android can be aggressive about killing high-memory tabs.
- **Dynamic Pool Sizing:** Use `navigator.deviceMemory` (available in Chrome) to tune `WORKER_POOL_MAX`.
  - If `deviceMemory >= 8` (Pixel Pro): allow up to 6–8 workers.
  - If `deviceMemory < 4`: cap at 2–3 workers to avoid OOM kills.

### 10.2 GPU & Compositor (For 120Hz Smoothness)

- **`touch-action`:** In `PhotoGrid.vue`, apply `touch-action: pan-y` (for the grid) or `touch-action: none` (for crop areas) in CSS. This lets the browser handle gestures natively on the compositor thread (guaranteed 120fps) even if the main thread is busy.
- **`will-change`:** Apply `will-change: transform` to the active crop/zoom element during interaction. This promotes it to a GPU layer.
- **`contain-intrinsic-size`:** When using `content-visibility: auto`, **always** set `contain-intrinsic-size` to the estimated card size. Without it, scrollbars will jump on mobile as items load/unload.

### 10.3 Decoding & Scheduling

- **Bitmap Options:** In workers, use `createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' })`. This avoids unnecessary CPU work and preserves strict color accuracy (Display P3) on Pixel screens.
- **Core Reservation:** When sizing the worker pool, use `Math.min(navigator.hardwareConcurrency - 1, 8)` to explicitly leave one core free for the UI thread. Oversaturating all cores on mobile SoCs (which have efficient vs performance cores) can cause UI stutters.

---

## Summary

- **P0:** Implement Web Workers for batch image ops and virtual scrolling (300+ threshold) first; both are critical for large libraries and mobile.
- **P1:** Then add IndexedDB write batching and batch download parallelization.
- **P2:** Then content-visibility, requestIdleCallback/chunking, and passive listeners.
- **Rules:** Related features are implemented to work together with shared types and one call path (Rule 1). When two strategies can conflict, the app chooses the best option at runtime via thresholds and capability checks (Rule 2). Use the constants above so behavior can be tuned without code churn.

This plan is intended to be implemented incrementally: P0 first, then P1, then P2, with each step integrating cleanly with existing features (lazy load, debounce/throttle, performance logger) and with the two implementation parameters applied throughout.
