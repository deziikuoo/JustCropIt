/**
 * Video Processing Web Worker (FFmpeg trim + Edit-tab clip render)
 *
 * Active path: trim export and unique-clip timeline render via FFmpeg.wasm.
 * FFmpeg stays loaded and the source file is cached in MEMFS across jobs.
 * Probe + frame extraction moved to webCodecsWorker.ts (WebCodecs + web-demuxer).
 *
 * To re-enable FFmpeg probe/extract:
 * 1. Uncomment the LEGACY_FFMPEG_EXTRACTION block below
 * 2. Route probe/extract back to this worker in videoWorkerPool.ts
 */

/// <reference lib="webworker" />

import { FFmpeg } from '@ffmpeg/ffmpeg';
import type {
  VideoWorkerRequest,
  VideoWorkerResponse,
  ExtractionProgress,
  TrimExportOptions,
  RenderClipOptions,
  ExportTimelineOptions,
  RenderClipBatchOptions,
  ConcatClipsOptions,
  TimelineRenderProgressWire,
} from '../types/video';
import type { ClipRenderSpec } from '../types/videoEdit';
import {
  clipIsPassthrough,
  fingerprintFileToken,
  planUniqueRenders,
  uniqueClipsShareOutputSize,
} from '../utils/videoEdit/clipRenderFingerprint';

/**
 * Same-origin FFmpeg core (public/ffmpeg/, matches package.json @ffmpeg/core).
 * Self-hosting removes the ~31MB CDN download on first export and keeps
 * loading working offline / behind strict COEP.
 */
function getFfmpegCoreUrl(file: 'ffmpeg-core.js' | 'ffmpeg-core.wasm'): string {
  const base = import.meta.env.BASE_URL || '/';
  const root = `${self.location.origin}${base.startsWith('/') ? base : `/${base}`}`;
  return new URL(`ffmpeg/${file}`, root.endsWith('/') ? root : `${root}/`).href;
}

/** ffmpeg.load() hangs forever if its class worker or core fails to boot — cap it. */
const FFMPEG_LOAD_TIMEOUT_MS = 60_000;

const ctx: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;

let ffmpeg: FFmpeg | null = null;
let isLoaded = false;
let isCancelled = false;

const recentLogs: string[] = [];
const MAX_RECENT_LOGS = 15;

function recordLog(message: string): void {
  recentLogs.push(message);
  if (recentLogs.length > MAX_RECENT_LOGS) {
    recentLogs.shift();
  }
}

function getRecentLogs(): string {
  return recentLogs.slice(-8).join(' | ');
}

const NOISY_FFMPEG_LOG =
  /Could not find codec parameters for stream \d+ \(Audio:|Consider increasing the value for the 'analyzeduration'/i;

function isNoisyFfmpegLog(message: string): boolean {
  return NOISY_FFMPEG_LOG.test(message);
}

function asUint8(source: ArrayBuffer | Uint8Array): Uint8Array {
  if (source instanceof Uint8Array) return source;
  return new Uint8Array(source);
}

let loadPromise: Promise<void> | null = null;
let cachedSourceKey: string | null = null;
let cachedSourceName: string | null = null;

function clearSourceCache(): void {
  cachedSourceKey = null;
  cachedSourceName = null;
}

async function loadFFmpeg(): Promise<void> {
  if (isLoaded && ffmpeg) return;
  if (loadPromise) {
    await loadPromise;
    return;
  }

  loadPromise = (async () => {
    ffmpeg = new FFmpeg();

    ffmpeg.on('log', ({ message }) => {
      if (isNoisyFfmpegLog(message)) return;
      console.log('[FFmpeg]', message);
      recordLog(message);
    });

    try {
      // No classWorkerURL: @ffmpeg/ffmpeg's own `new URL('./worker.js', import.meta.url)`
      // is what Vite bundles correctly. The old `@ffmpeg/ffmpeg/worker?url` import
      // emitted the RAW worker file, whose `./const.js` import 404s in production —
      // the class worker died before replying and load() hung forever.
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, rejectTimeout) => {
        timeoutId = setTimeout(
          () => rejectTimeout(new Error(`FFmpeg core did not load within ${FFMPEG_LOAD_TIMEOUT_MS / 1000}s`)),
          FFMPEG_LOAD_TIMEOUT_MS
        );
      });
      try {
        await Promise.race([
          ffmpeg.load({
            coreURL: getFfmpegCoreUrl('ffmpeg-core.js'),
            wasmURL: getFfmpegCoreUrl('ffmpeg-core.wasm'),
          }),
          timeout,
        ]);
      } finally {
        clearTimeout(timeoutId);
      }
      isLoaded = true;
      console.log('[FFmpeg] Loaded successfully (same-origin core)');
    } catch (loadError) {
      ffmpeg = null;
      isLoaded = false;
      throw new Error(`Failed to load FFmpeg core: ${loadError instanceof Error ? loadError.message : String(loadError)}`);
    }
  })();

  try {
    await loadPromise;
  } finally {
    loadPromise = null;
  }
}

function sendProgress(id: string, progress: ExtractionProgress): void {
  ctx.postMessage({ id, type: 'progress', progress } as VideoWorkerResponse);
}

function sendError(id: string, error: string): void {
  ctx.postMessage({ id, type: 'error', error } as VideoWorkerResponse);
}

async function deleteFileIfExists(name: string): Promise<void> {
  if (!ffmpeg) return;
  try {
    await ffmpeg.deleteFile(name);
  } catch {
    // file may not exist
  }
}

async function ensureSourceWritten(fileName: string, videoBytes: Uint8Array): Promise<string> {
  if (!ffmpeg) throw new Error('FFmpeg not loaded');
  const ext = fileName.split('.').pop() || 'mp4';
  const inputName = `source_input.${ext}`;
  const key = `${fileName}:${videoBytes.byteLength}`;
  if (cachedSourceKey === key && cachedSourceName === inputName) {
    return inputName;
  }
  if (cachedSourceName && cachedSourceName !== inputName) {
    await deleteFileIfExists(cachedSourceName);
  }
  try {
    await ffmpeg.writeFile(inputName, videoBytes);
  } catch (err) {
    clearSourceCache();
    throw err;
  }
  cachedSourceKey = key;
  cachedSourceName = inputName;
  return inputName;
}

/** Drop the WASM instance after an out-of-memory export so the next job can load a fresh core. */
async function resetFFmpeg(): Promise<void> {
  clearSourceCache();
  if (ffmpeg) {
    try {
      ffmpeg.terminate();
    } catch (e) {
      console.warn('[FFmpeg] Terminate warning:', e);
    }
    ffmpeg = null;
    isLoaded = false;
  }
  await new Promise((resolve) => setTimeout(resolve, 100));
  await loadFFmpeg();
}

function getMimeFromExt(ext: string): string {
  const map: Record<string, string> = {
    mp4: 'video/mp4',
    webm: 'video/webm',
    mov: 'video/quicktime',
    mkv: 'video/x-matroska',
    m4v: 'video/x-m4v',
  };
  return map[ext.toLowerCase()] || 'video/mp4';
}

function buildTrimmedFileName(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  if (dot > 0) {
    return `${fileName.slice(0, dot)}_trimmed${fileName.slice(dot)}`;
  }
  return `${fileName}_trimmed.mp4`;
}

async function trimVideoExport(
  id: string,
  videoData: ArrayBuffer,
  fileName: string,
  options: TrimExportOptions,
): Promise<void> {
  isCancelled = false;

  const ext = fileName.split('.').pop() || 'mp4';
  const outputName = `trim_output.${ext}`;
  const trimStart = options.trimStartSeconds;
  const clipDuration = options.clipDurationSeconds;

  if (clipDuration <= 0) {
    sendError(id, 'Invalid clip range');
    return;
  }

  const videoBytes = asUint8(videoData);

  try {
    sendProgress(id, {
      phase: 'loading',
      currentFrame: 0,
      totalFrames: 1,
      percent: 10,
      message: 'Preparing FFmpeg...',
    });

    await loadFFmpeg();
    const inputName = await ensureSourceWritten(fileName, videoBytes);

    if (isCancelled) {
      ctx.postMessage({ id, type: 'cancelled' } as VideoWorkerResponse);
      return;
    }

    sendProgress(id, {
      phase: 'processing',
      currentFrame: 0,
      totalFrames: 1,
      percent: 40,
      message: 'Trimming video (stream copy)...',
    });

    const copyArgs = [
      '-ss', trimStart.toFixed(3),
      '-i', inputName,
      '-t', clipDuration.toFixed(3),
      '-c', 'copy',
      '-avoid_negative_ts', 'make_zero',
      '-y', outputName,
    ];

    let trimSucceeded = false;
    try {
      await ffmpeg!.exec(copyArgs);
      trimSucceeded = true;
    } catch (copyErr) {
      console.warn('[FFmpeg] Stream copy trim failed, retrying with re-encode:', copyErr);
    }

    if (!trimSucceeded) {
      if (isCancelled) {
        ctx.postMessage({ id, type: 'cancelled' } as VideoWorkerResponse);
        return;
      }

      sendProgress(id, {
        phase: 'processing',
        currentFrame: 0,
        totalFrames: 1,
        percent: 60,
        message: 'Trimming video (re-encoding)...',
      });

      await deleteFileIfExists(outputName);
      // Stream copy failed (cut point likely isn't on a keyframe) — fall back to a
      // visually lossless re-encode. (Not crf 0: lossless x264 uses the
      // High 4:4:4 profile most hardware decoders can't play, and its huge
      // output can exceed WASM memory.)
      const reencodeArgs = [
        '-ss', trimStart.toFixed(3),
        '-i', inputName,
        '-t', clipDuration.toFixed(3),
        // yuv420p (needed below) requires even width/height.
        '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
        '-pix_fmt', 'yuv420p',
        '-c:v', 'libx264',
        '-profile:v', 'high',
        '-preset', 'ultrafast',
        '-crf', '12',
        '-an',
        '-y', outputName,
      ];
      await ffmpeg!.exec(reencodeArgs);
    }

    if (isCancelled) {
      ctx.postMessage({ id, type: 'cancelled' } as VideoWorkerResponse);
      return;
    }

    sendProgress(id, {
      phase: 'processing',
      currentFrame: 1,
      totalFrames: 1,
      percent: 90,
      message: 'Reading trimmed file...',
    });

    const data = await ffmpeg!.readFile(outputName);
    const safeCopy = (data as Uint8Array).slice();

    await deleteFileIfExists(outputName);

    if (safeCopy.byteLength === 0) {
      sendError(id, `Trim produced an empty file. FFmpeg output: ${getRecentLogs()}`);
      return;
    }

    ctx.postMessage({
      id,
      type: 'trimComplete',
      trimVideo: {
        data: safeCopy,
        mimeType: getMimeFromExt(ext),
        fileName: buildTrimmedFileName(fileName),
      },
      progress: {
        phase: 'complete',
        currentFrame: 1,
        totalFrames: 1,
        percent: 100,
        message: 'Trim complete',
      },
    } as VideoWorkerResponse);
  } catch (error) {
    await deleteFileIfExists(outputName);
    sendError(id, `Failed to trim video: ${error instanceof Error ? error.message : String(error)}. FFmpeg output: ${getRecentLogs()}`);
  }
}

/* =============================================================================
 * Hidden Edit tab — per-clip render + timeline export (crop/speed/reverse/freeze)
 * ============================================================================= */

function sendTimelineProgress(id: string, progress: TimelineRenderProgressWire): void {
  ctx.postMessage({ id, type: 'progress', timelineProgress: progress } as VideoWorkerResponse);
}

/** Builds the `-vf` filter chain for a non-freeze clip: crop -> speed -> reverse. */
function buildClipVideoFilters(clip: ClipRenderSpec): string {
  const filters: string[] = [];

  if (clip.crop) {
    const { x, y, width, height } = clip.crop;
    filters.push(
      `crop=${Math.max(2, Math.round(width))}:${Math.max(2, Math.round(height))}:${Math.max(0, Math.round(x))}:${Math.max(0, Math.round(y))}`
    );
  }

  const speed = clip.speed && clip.speed > 0 ? clip.speed : 1;
  if (speed !== 1) {
    filters.push(`setpts=${(1 / speed).toFixed(6)}*PTS`);
  }

  if (clip.reversed) {
    filters.push('reverse');
  }

  // FFmpeg's yuv420p pixel format requires even width/height.
  filters.push('scale=trunc(iw/2)*2:trunc(ih/2)*2');

  return filters.join(',');
}

/**
 * Encode quality per use case:
 * - 'lossless': the actual downloadable export. Visually lossless `-crf 12`
 *   in the standard High profile. (True `-crf 0` lossless was tried and
 *   reverted: x264 lossless always signals the High 4:4:4 Predictive profile,
 *   which mobile/hardware decoders can't play — videos rendered black — and
 *   its enormous bitstreams blew past the FFmpeg WASM memory limit,
 *   crashing exports with "memory access out of bounds".)
 * - 'preview': the ephemeral in-app reversed-clip preview render only. Never
 *   downloaded/kept, so it favors fast encode over quality.
 */
type EncodeQuality = 'lossless' | 'preview';

function cropFilter(crop: NonNullable<ClipRenderSpec['crop']>): string {
  return `crop=${Math.max(2, Math.round(crop.width))}:${Math.max(2, Math.round(crop.height))}:${Math.max(0, Math.round(crop.x))}:${Math.max(0, Math.round(crop.y))}`;
}

function buildClipFilterChain(clip: ClipRenderSpec, outLabel: string): string {
  const filters: string[] = [];

  if (clip.freeze) {
    const t = Math.max(0, clip.freeze.sourceTime);
    filters.push(`trim=start=${t}:end=${(t + 0.04).toFixed(4)}`);
    filters.push('setpts=PTS-STARTPTS');
    if (clip.crop) filters.push(cropFilter(clip.crop));
    filters.push('loop=loop=-1:size=1:start=0');
    filters.push(`trim=duration=${Math.max(0.05, clip.freeze.durationSeconds).toFixed(3)}`);
    filters.push('setpts=PTS-STARTPTS');
    filters.push('fps=30');
  } else {
    filters.push(`trim=start=${clip.sourceStart}:end=${clip.sourceEnd}`);
    filters.push('setpts=PTS-STARTPTS');
    if (clip.crop) filters.push(cropFilter(clip.crop));
    const speed = clip.speed && clip.speed > 0 ? clip.speed : 1;
    if (speed !== 1) {
      filters.push(`setpts=${(1 / speed).toFixed(6)}*PTS`);
    }
    if (clip.reversed) {
      filters.push('reverse');
    }
  }

  filters.push('scale=trunc(iw/2)*2:trunc(ih/2)*2');
  filters.push('format=yuv420p');
  return `[0:v]${filters.join(',')}[${outLabel}]`;
}

function buildTimelineFilterComplex(clips: ClipRenderSpec[]): string {
  if (clips.length === 1) {
    return buildClipFilterChain(clips[0], 'outv');
  }
  const chains: string[] = [];
  const labels: string[] = [];
  for (let i = 0; i < clips.length; i++) {
    const label = `v${i}`;
    labels.push(`[${label}]`);
    chains.push(buildClipFilterChain(clips[i], label));
  }
  chains.push(`${labels.join('')}concat=n=${clips.length}:v=1:a=0[outv]`);
  return chains.join(';');
}

/** Stream-copy a trim-only clip — no decode/encode. */
async function copyClipToFile(
  inputName: string,
  outputName: string,
  clip: ClipRenderSpec
): Promise<void> {
  if (!ffmpeg) throw new Error('FFmpeg not loaded');
  const duration = Math.max(0, clip.sourceEnd - clip.sourceStart);
  await deleteFileIfExists(outputName);
  await ffmpeg.exec([
    '-ss', clip.sourceStart.toFixed(3),
    '-t', duration.toFixed(3),
    '-i', inputName,
    '-c:v', 'copy',
    '-an',
    '-avoid_negative_ts', 'make_zero',
    '-y', outputName,
  ]);
}

async function concatClipFiles(clipFileNames: string[], outputName: string): Promise<void> {
  if (!ffmpeg) throw new Error('FFmpeg not loaded');
  if (clipFileNames.length === 1) {
    const data = await ffmpeg.readFile(clipFileNames[0]);
    await ffmpeg.writeFile(outputName, data as Uint8Array);
    return;
  }
  const concatListText = clipFileNames.map((name) => `file '${name}'`).join('\n');
  await ffmpeg.writeFile('export_concat_list.txt', new TextEncoder().encode(concatListText));
  await deleteFileIfExists(outputName);
  await ffmpeg.exec([
    '-f', 'concat',
    '-safe', '0',
    '-i', 'export_concat_list.txt',
    '-c', 'copy',
    '-y', outputName,
  ]);
  await deleteFileIfExists('export_concat_list.txt');
}

function getClipEncodeArgs(quality: EncodeQuality): string[] {
  if (quality === 'lossless') {
    // ultrafast keeps unique-clip export fast. crf 12 + High stays playable;
    // crf 0 forces High 4:4:4, which hardware decoders render black and which
    // can exhaust the FFmpeg WASM heap.
    return [
      '-pix_fmt', 'yuv420p',
      '-c:v', 'libx264',
      '-profile:v', 'high',
      '-preset', 'ultrafast',
      '-crf', '12',
      '-an',
    ];
  }
  return ['-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '20', '-an'];
}

/** Renders one clip (regular or freeze) from `inputName` into `outputName`. */
async function renderClipToFile(
  inputName: string,
  outputName: string,
  clip: ClipRenderSpec,
  quality: EncodeQuality
): Promise<void> {
  if (!ffmpeg) throw new Error('FFmpeg not loaded');
  const encodeArgs = getClipEncodeArgs(quality);

  if (clip.freeze) {
    // Extract the still losslessly (PNG) so the frame itself never loses quality
    // before being re-encoded into the freeze-duration video below.
    const frameName = `${outputName}.freeze-frame.png`;
    await deleteFileIfExists(frameName);
    const frameArgs = [
      '-ss', Math.max(0, clip.freeze.sourceTime).toFixed(3),
      '-i', inputName,
      '-frames:v', '1',
    ];
    // Freeze clips can still carry a crop (e.g. the user cropped a frozen frame) —
    // apply it while extracting the still so the export matches the preview crop.
    if (clip.crop) {
      const { x, y, width, height } = clip.crop;
      frameArgs.push(
        '-vf',
        `crop=${Math.max(2, Math.round(width))}:${Math.max(2, Math.round(height))}:${Math.max(0, Math.round(x))}:${Math.max(0, Math.round(y))}`
      );
    }
    frameArgs.push('-y', frameName);
    await ffmpeg.exec(frameArgs);

    await deleteFileIfExists(outputName);
    await ffmpeg.exec([
      '-loop', '1',
      '-i', frameName,
      '-t', Math.max(0.05, clip.freeze.durationSeconds).toFixed(3),
      '-r', '30',
      '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
      ...encodeArgs,
      '-y', outputName,
    ]);
    await deleteFileIfExists(frameName);
    return;
  }

  const duration = Math.max(0, clip.sourceEnd - clip.sourceStart);
  // CRITICAL: `-t` must come BEFORE `-i` (input option) so it limits how much
  // of the source is read. As an output option (after `-i`) it only trims the
  // final output, which breaks reversed clips: `reverse` would buffer from
  // sourceStart to the END of the file, flip it, and `-t` would then keep the
  // reversed *end of the video* instead of the selected scene. Input-side -t
  // also fixes slow-motion clips being truncated to the source duration.
  const args = [
    '-ss', clip.sourceStart.toFixed(3),
    '-t', duration.toFixed(3),
    '-i', inputName,
    '-vf', buildClipVideoFilters(clip),
    ...encodeArgs,
    '-y', outputName,
  ];

  await deleteFileIfExists(outputName);
  await ffmpeg.exec(args);
}

function buildRenderedClipFileName(fileName: string, clipId: string): string {
  const dot = fileName.lastIndexOf('.');
  const base = dot > 0 ? fileName.slice(0, dot) : fileName;
  return `${base}_clip-${clipId}.mp4`;
}

function buildExportedTimelineFileName(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  const base = dot > 0 ? fileName.slice(0, dot) : fileName;
  return `${base}_edited.mp4`;
}

/** Renders a single clip and returns it — used to pre-render reversed clips for preview. */
async function renderClipRequest(
  id: string,
  videoData: ArrayBuffer,
  fileName: string,
  options: RenderClipOptions
): Promise<void> {
  isCancelled = false;
  const outputName = 'render_output.mp4';
  const videoBytes = asUint8(videoData);

  try {
    sendProgress(id, {
      phase: 'loading', currentFrame: 0, totalFrames: 1, percent: 10,
      message: 'Preparing FFmpeg...',
    });
    await loadFFmpeg();
    const inputName = await ensureSourceWritten(fileName, videoBytes);

    if (isCancelled) {
      ctx.postMessage({ id, type: 'cancelled' } as VideoWorkerResponse);
      return;
    }

    sendProgress(id, {
      phase: 'processing', currentFrame: 0, totalFrames: 1, percent: 40,
      message: 'Rendering clip...',
    });
    // This render is only ever shown in the live preview player, never downloaded —
    // favor fast encode over quality here.
    await renderClipToFile(inputName, outputName, options.clip, 'preview');

    if (isCancelled) {
      ctx.postMessage({ id, type: 'cancelled' } as VideoWorkerResponse);
      return;
    }

    const data = await ffmpeg!.readFile(outputName);
    const safeCopy = (data as Uint8Array).slice();
    await deleteFileIfExists(outputName);

    if (safeCopy.byteLength === 0) {
      sendError(id, `Clip render produced an empty file. FFmpeg output: ${getRecentLogs()}`);
      return;
    }

    ctx.postMessage({
      id,
      type: 'renderClipComplete',
      renderedClip: {
        data: safeCopy,
        mimeType: 'video/mp4',
        fileName: buildRenderedClipFileName(fileName, options.clip.id),
      },
      progress: {
        phase: 'complete', currentFrame: 1, totalFrames: 1, percent: 100,
        message: 'Clip rendered',
      },
    } as VideoWorkerResponse);
  } catch (error) {
    await deleteFileIfExists(outputName);
    sendError(id, `Failed to render clip: ${error instanceof Error ? error.message : String(error)}. FFmpeg output: ${getRecentLogs()}`);
  }
}

async function encodeTimelineFilterGraph(
  inputName: string,
  outputName: string,
  clips: ClipRenderSpec[]
): Promise<void> {
  if (!ffmpeg) throw new Error('FFmpeg not loaded');
  const filter = buildTimelineFilterComplex(clips);
  await deleteFileIfExists(outputName);
  await ffmpeg.exec([
    '-i', inputName,
    '-filter_complex', filter,
    '-map', '[outv]',
    ...getClipEncodeArgs('lossless'),
    '-movflags', '+faststart',
    '-y', outputName,
  ]);
}

/** Renders unique recipes once, then concatenates them in timeline order. */
async function exportTimelineRequest(
  id: string,
  videoData: ArrayBuffer,
  fileName: string,
  options: ExportTimelineOptions
): Promise<void> {
  isCancelled = false;
  const clips = options.clips;
  if (!clips || clips.length === 0) {
    sendError(id, 'No clips to export');
    return;
  }

  const outputName = 'export_output.mp4';
  const videoBytes = asUint8(videoData);
  const uniqueFileNames: string[] = [];

  try {
    sendTimelineProgress(id, {
      phase: 'loading', currentClip: 0, totalClips: clips.length, percent: 5,
      message: isLoaded ? 'Preparing export...' : 'Loading FFmpeg (first time only)...',
    });
    await loadFFmpeg();
    const inputName = await ensureSourceWritten(fileName, videoBytes);

    if (isCancelled) {
      ctx.postMessage({ id, type: 'cancelled' } as VideoWorkerResponse);
      return;
    }

    const plan = planUniqueRenders(clips);
    const uniqueClips = plan.uniqueKeys.map((key) => plan.clipByKey.get(key)!);
    const allPassthrough = uniqueClips.every(clipIsPassthrough);
    const canStitchUnique =
      uniqueClipsShareOutputSize(uniqueClips) &&
      (allPassthrough || uniqueClips.length < clips.length || uniqueClips.length === 1);

    let usedUniqueStitch = false;

    if (canStitchUnique) {
      try {
        sendTimelineProgress(id, {
          phase: 'rendering',
          currentClip: 1,
          totalClips: plan.uniqueKeys.length,
          percent: 20,
          message: allPassthrough
            ? `Copying ${plan.uniqueKeys.length} unique clip${plan.uniqueKeys.length === 1 ? '' : 's'}...`
            : `Encoding ${plan.uniqueKeys.length} unique clip${plan.uniqueKeys.length === 1 ? '' : 's'}...`,
        });

        const fileByKey = new Map<string, string>();
        // If any unique recipe needs a re-encode, encode them all with the same
        // x264 settings so concat -c copy stays codec-compatible (copy+reverse
        // would mix the source codec with libx264 and fail).
        const encodeAll = !allPassthrough;

        for (let i = 0; i < plan.uniqueKeys.length; i++) {
          if (isCancelled) {
            ctx.postMessage({ id, type: 'cancelled' } as VideoWorkerResponse);
            return;
          }
          const key = plan.uniqueKeys[i];
          const clip = plan.clipByKey.get(key)!;
          const uniqueName = `unique_${fingerprintFileToken(key)}.mp4`;
          sendTimelineProgress(id, {
            phase: 'rendering',
            currentClip: i + 1,
            totalClips: plan.uniqueKeys.length,
            percent: 20 + Math.round(((i + 0.5) / plan.uniqueKeys.length) * 55),
            message: encodeAll
              ? `Encoding unique clip ${i + 1} of ${plan.uniqueKeys.length}...`
              : `Copying unique clip ${i + 1} of ${plan.uniqueKeys.length}...`,
          });
          if (encodeAll) {
            await renderClipToFile(inputName, uniqueName, clip, 'lossless');
          } else {
            await copyClipToFile(inputName, uniqueName, clip);
          }
          fileByKey.set(key, uniqueName);
          uniqueFileNames.push(uniqueName);
        }

        const orderedFiles = plan.keyByIndex.map((key) => fileByKey.get(key)!);
        sendTimelineProgress(id, {
          phase: 'concatenating',
          currentClip: clips.length,
          totalClips: clips.length,
          percent: 85,
          message: orderedFiles.length === 1 ? 'Finishing...' : 'Joining timeline...',
        });
        await concatClipFiles(orderedFiles, outputName);
        usedUniqueStitch = true;
      } catch (stitchErr) {
        console.warn('[FFmpeg] Unique-clip stitch failed, falling back to filter graph:', stitchErr);
        for (const name of uniqueFileNames) await deleteFileIfExists(name);
        uniqueFileNames.length = 0;
      }
    }

    if (!usedUniqueStitch) {
      sendTimelineProgress(id, {
        phase: 'rendering', currentClip: 1, totalClips: clips.length, percent: 30,
        message: 'Encoding timeline...',
      });
      try {
        await encodeTimelineFilterGraph(inputName, outputName, clips);
      } catch (graphErr) {
        console.warn('[FFmpeg] Single-pass encode failed, falling back to per-clip:', graphErr);
        const clipFileNames: string[] = [];
        for (let i = 0; i < clips.length; i++) {
          if (isCancelled) {
            ctx.postMessage({ id, type: 'cancelled' } as VideoWorkerResponse);
            return;
          }
          const clipFileName = `export_clip_${i}.mp4`;
          sendTimelineProgress(id, {
            phase: 'rendering',
            currentClip: i + 1,
            totalClips: clips.length,
            percent: Math.round(((i + 0.5) / clips.length) * 80),
            message: `Rendering clip ${i + 1} of ${clips.length}...`,
          });
          await renderClipToFile(inputName, clipFileName, clips[i], 'lossless');
          clipFileNames.push(clipFileName);
        }
        uniqueFileNames.push(...clipFileNames);
        await concatClipFiles(clipFileNames, outputName);
      }
    }

    if (isCancelled) {
      ctx.postMessage({ id, type: 'cancelled' } as VideoWorkerResponse);
      return;
    }

    sendTimelineProgress(id, {
      phase: 'concatenating', currentClip: clips.length, totalClips: clips.length, percent: 95,
      message: 'Reading final file...',
    });

    const data = await ffmpeg!.readFile(outputName);
    const safeCopy = (data as Uint8Array).slice();

    for (const name of uniqueFileNames) await deleteFileIfExists(name);
    await deleteFileIfExists('export_concat_list.txt');
    await deleteFileIfExists(outputName);

    if (safeCopy.byteLength === 0) {
      sendError(id, `Export produced an empty file. FFmpeg output: ${getRecentLogs()}`);
      return;
    }

    ctx.postMessage({
      id,
      type: 'exportTimelineComplete',
      exportedTimeline: {
        data: safeCopy,
        mimeType: 'video/mp4',
        fileName: buildExportedTimelineFileName(fileName),
      },
      timelineProgress: {
        phase: 'complete', currentClip: clips.length, totalClips: clips.length, percent: 100,
        message: 'Export complete',
      },
    } as VideoWorkerResponse);
  } catch (error) {
    for (const name of uniqueFileNames) await deleteFileIfExists(name);
    await deleteFileIfExists('export_concat_list.txt');
    await deleteFileIfExists(outputName);
    const message = error instanceof Error ? error.message : String(error);
    if (/memory|out of bounds/i.test(message)) {
      try {
        await resetFFmpeg();
      } catch {
        // ignore — next export will try to load a fresh core
      }
    }
    sendError(id, `Failed to export timeline: ${message}. FFmpeg output: ${getRecentLogs()}`);
  }
}

/* =============================================================================
 * Parallel timeline export — one worker per pool slot renders its own
 * contiguous share of clips (used by videoWorkerPool.ts's exportTimeline
 * when there are enough clips to make pooling worthwhile); the main thread
 * then hands every rendered buffer to concatClipsRequest below to join them.
 * ============================================================================= */

/** Renders this worker's contiguous share of clips and returns every buffer, tagged with its global index. */
async function renderClipBatchRequest(
  id: string,
  videoData: ArrayBuffer,
  fileName: string,
  options: RenderClipBatchOptions
): Promise<void> {
  isCancelled = false;
  const clips = options.clips;
  if (!clips || clips.length === 0) {
    sendError(id, 'No clips in batch');
    return;
  }

  const videoBytes = asUint8(videoData);
  const rendered: { index: number; data: Uint8Array; mimeType: string }[] = [];

  try {
    sendTimelineProgress(id, {
      phase: 'loading', currentClip: options.startIndex, totalClips: options.totalClips, percent: 0,
      message: 'Preparing FFmpeg...',
    });
    await loadFFmpeg();
    const inputName = await ensureSourceWritten(fileName, videoBytes);

    for (let i = 0; i < clips.length; i++) {
      if (isCancelled) {
        ctx.postMessage({ id, type: 'cancelled' } as VideoWorkerResponse);
        return;
      }
      const globalIndex = options.startIndex + i;
      const clipFileName = `batch_clip_${i}.mp4`;
      sendTimelineProgress(id, {
        phase: 'rendering',
        currentClip: globalIndex + 1,
        totalClips: options.totalClips,
        percent: Math.round(((i + 0.5) / clips.length) * 100),
        message: `Rendering clip ${globalIndex + 1} of ${options.totalClips}...`,
      });
      await renderClipToFile(inputName, clipFileName, clips[i], 'lossless');

      const data = await ffmpeg!.readFile(clipFileName);
      const safeCopy = (data as Uint8Array).slice();
      await deleteFileIfExists(clipFileName);

      if (safeCopy.byteLength === 0) {
        throw new Error(`Clip ${globalIndex + 1} render produced an empty file`);
      }
      rendered.push({ index: globalIndex, data: safeCopy, mimeType: 'video/mp4' });
    }

    if (isCancelled) {
      ctx.postMessage({ id, type: 'cancelled' } as VideoWorkerResponse);
      return;
    }

    ctx.postMessage(
      {
        id,
        type: 'renderClipBatchComplete',
        renderedClipBatch: { clips: rendered },
        timelineProgress: {
          phase: 'complete', currentClip: options.startIndex + clips.length, totalClips: options.totalClips,
          percent: 100, message: 'Batch rendered',
        },
      } as VideoWorkerResponse,
      rendered.map((r) => r.data.buffer)
    );
  } catch (error) {
    sendError(id, `Failed to render clip batch: ${error instanceof Error ? error.message : String(error)}. FFmpeg output: ${getRecentLogs()}`);
  }
}

/** Stream-copies pre-rendered (already lossless, identically-encoded) clip buffers into one file. */
async function concatClipsRequest(
  id: string,
  fileName: string,
  options: ConcatClipsOptions
): Promise<void> {
  isCancelled = false;
  const clipBuffers = options.clipBuffers;
  if (!clipBuffers || clipBuffers.length === 0) {
    sendError(id, 'No rendered clips to join');
    return;
  }

  const clipFileNames: string[] = [];

  try {
    sendTimelineProgress(id, {
      phase: 'concatenating', currentClip: clipBuffers.length, totalClips: clipBuffers.length, percent: 85,
      message: 'Joining clips...',
    });
    await loadFFmpeg();

    for (let i = 0; i < clipBuffers.length; i++) {
      const clipFileName = `concat_clip_${i}.mp4`;
      await ffmpeg!.writeFile(clipFileName, clipBuffers[i]);
      clipFileNames.push(clipFileName);
    }

    if (isCancelled) {
      ctx.postMessage({ id, type: 'cancelled' } as VideoWorkerResponse);
      return;
    }

    const concatListText = clipFileNames.map((name) => `file '${name}'`).join('\n');
    await ffmpeg!.writeFile('concat_list.txt', new TextEncoder().encode(concatListText));

    const outputName = 'concat_output.mp4';
    await deleteFileIfExists(outputName);
    await ffmpeg!.exec([
      '-f', 'concat',
      '-safe', '0',
      '-i', 'concat_list.txt',
      '-c', 'copy',
      '-y', outputName,
    ]);

    if (isCancelled) {
      ctx.postMessage({ id, type: 'cancelled' } as VideoWorkerResponse);
      return;
    }

    const data = await ffmpeg!.readFile(outputName);
    const safeCopy = (data as Uint8Array).slice();

    for (const name of clipFileNames) await deleteFileIfExists(name);
    await deleteFileIfExists('concat_list.txt');
    await deleteFileIfExists(outputName);

    if (safeCopy.byteLength === 0) {
      sendError(id, `Export produced an empty file. FFmpeg output: ${getRecentLogs()}`);
      return;
    }

    ctx.postMessage({
      id,
      type: 'concatClipsComplete',
      concatenatedTimeline: {
        data: safeCopy,
        mimeType: 'video/mp4',
        fileName: buildExportedTimelineFileName(fileName),
      },
      timelineProgress: {
        phase: 'complete', currentClip: clipBuffers.length, totalClips: clipBuffers.length, percent: 100,
        message: 'Export complete',
      },
    } as VideoWorkerResponse);
  } catch (error) {
    for (const name of clipFileNames) await deleteFileIfExists(name);
    await deleteFileIfExists('concat_list.txt');
    sendError(id, `Failed to join rendered clips: ${error instanceof Error ? error.message : String(error)}. FFmpeg output: ${getRecentLogs()}`);
  }
}

/* =============================================================================
 * LEGACY_FFMPEG_EXTRACTION — preserved for reference (do not delete)
 *
 * Previously used for probe + per-frame extract. Replaced by WebCodecs
 * (src/workers/webCodecsWorker.ts) for speed at dense intervals (e.g. 0.05s).
 * =============================================================================

import {
  VIDEO_EXTRACTION_CHUNK_SIZE,
  VIDEO_EXTRACTION_CHUNK_SIZE_PNG,
} from '../constants/optimization';
import type { ExtractionOptions } from '../types/video';

const SINGLE_FRAME_OUTPUT = 'frame_out';
const DELAY_AFTER_FRAME_MS = 10;
const DELAY_BETWEEN_BATCHES_MS = 150;

async function pngToJpeg(pngBytes: Uint8Array, quality: number): Promise<Uint8Array> {
  const pngBlob = new Blob([pngBytes], { type: 'image/png' });
  const bitmap = await createImageBitmap(pngBlob);
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const c2d = canvas.getContext('2d');
    if (!c2d) {
      throw new Error('OffscreenCanvas 2D context unavailable');
    }
    c2d.drawImage(bitmap, 0, 0);
    const clampedQuality = Math.min(1, Math.max(0.1, quality));
    const jpegBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality: clampedQuality });
    const buf = await jpegBlob.arrayBuffer();
    return new Uint8Array(buf);
  } finally {
    bitmap.close();
  }
}

async function probeVideo(id: string, videoData: ArrayBuffer, fileName: string): Promise<void> {
  if (!ffmpeg) {
    sendError(id, 'FFmpeg not loaded');
    return;
  }

  const inputName = `probe_${Date.now()}.${fileName.split('.').pop() || 'mp4'}`;

  try {
    const videoBytes = copyBuffer(videoData);
    await ffmpeg.writeFile(inputName, videoBytes);

    let duration = 0;
    let width = 0;
    let height = 0;

    ffmpeg.on('log', ({ message }) => {
      const durationMatch = message.match(/Duration:\s*(\d+):(\d+):(\d+\.?\d*)/);
      if (durationMatch) {
        const hours = parseInt(durationMatch[1], 10);
        const minutes = parseInt(durationMatch[2], 10);
        const seconds = parseFloat(durationMatch[3]);
        duration = hours * 3600 + minutes * 60 + seconds;
      }
      const streamMatch = message.match(/Stream.*Video.*?(\d+)x(\d+)/);
      if (streamMatch) {
        width = parseInt(streamMatch[1], 10);
        height = parseInt(streamMatch[2], 10);
      }
    });

    await ffmpeg.exec(['-i', inputName, '-vframes', '1', '-f', 'null', '-']);
    await deleteFileIfExists(inputName);

    ctx.postMessage({
      id,
      type: 'info',
      info: { duration, width, height },
    } as VideoWorkerResponse);
  } catch (error) {
    await deleteFileIfExists(inputName);
    sendError(id, `Failed to probe video: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function extractSingleFrame(
  inputName: string,
  timestamp: number,
  ext: string
): Promise<Uint8Array | null> {
  if (!ffmpeg) return null;

  const outputName = `${SINGLE_FRAME_OUTPUT}.${ext}`;
  await deleteFileIfExists(outputName);

  const args = [
    '-ss', timestamp.toFixed(3),
    '-i', inputName,
    '-frames:v', '1',
    '-an',
    '-update', '1',
    '-y', outputName,
  ];

  try {
    await ffmpeg.exec(args);
  } catch (err) {
    console.warn(`[FFmpeg] exec failed at ${timestamp}s with args [${args.join(' ')}]:`, err);
    console.warn(`[FFmpeg] Recent log context: ${getRecentLogs()}`);
    await deleteFileIfExists(outputName);
    return null;
  }

  try {
    const data = await ffmpeg.readFile(outputName);
    await deleteFileIfExists(outputName);

    const safeCopy = (data as Uint8Array).slice();
    await delay(DELAY_AFTER_FRAME_MS);

    return safeCopy;
  } catch (readErr) {
    console.warn(`[FFmpeg] readFile failed at ${timestamp}s:`, readErr);
    await deleteFileIfExists(outputName);
    return null;
  }
}

async function extractFrames(
  id: string,
  videoData: ArrayBuffer,
  fileName: string,
  options: ExtractionOptions
): Promise<void> {
  isCancelled = false;

  const intervalSeconds = options.intervalMs / 1000;
  const isJpeg = options.outputFormat === 'jpeg';
  const deliveredMimeType = isJpeg ? 'image/jpeg' : 'image/png';
  const jpegQuality = typeof options.quality === 'number' && options.quality > 0 && options.quality <= 1
    ? options.quality
    : 0.95;
  const chunkSize = options.chunkSize ?? (
    isJpeg ? VIDEO_EXTRACTION_CHUNK_SIZE : VIDEO_EXTRACTION_CHUNK_SIZE_PNG
  );

  const clipDuration = options.videoDuration;
  const trimStart = options.trimStartSeconds ?? 0;
  if (!clipDuration || clipDuration <= 0) {
    sendError(id, 'Video duration unknown — reload the video and try again');
    return;
  }

  let totalFrames = Math.ceil(clipDuration / intervalSeconds);
  if (options.maxFrames) {
    totalFrames = Math.min(totalFrames, options.maxFrames);
  }
  if (totalFrames <= 0) {
    sendError(id, 'No frames to extract at this interval');
    return;
  }

  const inputName = `input.${fileName.split('.').pop() || 'mp4'}`;
  let framesSent = 0;
  let failedFrames = 0;
  const totalChunks = Math.ceil(totalFrames / chunkSize);

  const videoBytes = copyBuffer(videoData);

  try {
    sendProgress(id, {
      phase: 'loading',
      currentFrame: 0,
      totalFrames,
      percent: 0,
      message: 'Preparing FFmpeg...',
    });

    await loadFFmpeg();
    await writeInputVideo(inputName, videoBytes);

    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
      if (isCancelled) break;

      if (chunkIndex > 0) {
        sendProgress(id, {
          phase: 'loading',
          currentFrame: framesSent,
          totalFrames,
          percent: 5 + Math.round((framesSent / totalFrames) * 85),
          message: `Resetting memory before batch ${chunkIndex + 1}...`,
        });

        await delay(DELAY_BETWEEN_BATCHES_MS);
        await loadFFmpeg();
        await writeInputVideo(inputName, videoBytes);
      }

      const chunkStartFrame = chunkIndex * chunkSize;
      const batchSize = Math.min(chunkSize, totalFrames - chunkStartFrame);

      sendProgress(id, {
        phase: 'extracting',
        currentFrame: framesSent,
        totalFrames,
        percent: 5 + Math.round((framesSent / totalFrames) * 85),
        message: `Batch ${chunkIndex + 1} of ${totalChunks} (frames ${chunkStartFrame + 1}–${chunkStartFrame + batchSize})...`,
      });

      for (let i = 0; i < batchSize; i++) {
        if (isCancelled) break;

        const globalIndex = chunkStartFrame + i;
        const timestamp = trimStart + globalIndex * intervalSeconds;

        const pngData = await extractSingleFrame(inputName, timestamp, 'png');
        if (!pngData || pngData.byteLength === 0) {
          console.warn(`[FFmpeg] No data for frame ${globalIndex} at ${timestamp}s`);
          failedFrames++;
          if (framesSent === 0 && failedFrames >= 8) {
            sendError(id, `Extraction failing on every frame (${failedFrames} errors). FFmpeg output: ${getRecentLogs()}`);
            return;
          }
          continue;
        }

        let outData: Uint8Array = pngData;
        if (isJpeg) {
          try {
            outData = await pngToJpeg(pngData, jpegQuality);
          } catch (convErr) {
            console.warn(`[Convert] PNG→JPEG failed at frame ${globalIndex}:`, convErr);
            failedFrames++;
            continue;
          }
        }

        ctx.postMessage({
          id,
          type: 'frame',
          frame: {
            index: globalIndex,
            timestamp,
            data: outData,
            mimeType: deliveredMimeType,
          },
        } as VideoWorkerResponse);

        framesSent++;
        sendProgress(id, {
          phase: 'processing',
          currentFrame: framesSent,
          totalFrames,
          percent: 5 + Math.round((framesSent / totalFrames) * 90),
          message: `Extracted frames ${framesSent} of ${totalFrames}`,
        });
      }
    }

    if (ffmpeg) {
      await deleteFileIfExists(inputName);
    }

    if (isCancelled) {
      ctx.postMessage({ id, type: 'cancelled', framesExtracted: framesSent } as VideoWorkerResponse);
      return;
    }

    if (framesSent === 0 && failedFrames > 0) {
      sendError(id, `Failed to extract any frames (${failedFrames} errors). FFmpeg output: ${getRecentLogs()}`);
      return;
    }

    ctx.postMessage({
      id,
      type: 'complete',
      framesExtracted: framesSent,
      progress: {
        phase: 'complete',
        currentFrame: framesSent,
        totalFrames: framesSent,
        percent: 100,
        message: framesSent > 0
          ? `Extracted ${framesSent} frames${failedFrames > 0 ? ` (${failedFrames} failed)` : ''}`
          : 'No frames extracted',
      },
    } as VideoWorkerResponse);
  } catch (error) {
    sendError(id, error instanceof Error ? error.message : String(error));
  }
}

============================================================================= */

ctx.onmessage = async (event: MessageEvent<VideoWorkerRequest>) => {
  const {
    id,
    type,
    videoData,
    fileName,
    trimOptions,
    renderClipOptions,
    exportTimelineOptions,
    renderClipBatchOptions,
    concatClipsOptions,
  } = event.data;

  try {
    if (type === 'cancel') {
      isCancelled = true;
      return;
    }

    if (type === 'preload' || type === 'warmup') {
      await loadFFmpeg();
      ctx.postMessage({ id, type: 'complete' } as VideoWorkerResponse);
      return;
    }

    if (type === 'probe' || type === 'extract') {
      sendError(
        id,
        `FFmpeg ${type} is disabled — use the WebCodecs worker. Legacy code is preserved in LEGACY_FFMPEG_EXTRACTION.`
      );
      return;
    }

    // No eager loadFFmpeg() here: every handler below loads it itself AFTER
    // posting its first progress message, so the UI shows activity immediately
    // instead of sitting silent while the ~31MB core compiles.
    if (type === 'trim' && videoData && fileName && trimOptions) {
      await trimVideoExport(id, videoData, fileName, trimOptions);
    } else if (type === 'renderClip' && videoData && fileName && renderClipOptions) {
      await renderClipRequest(id, videoData, fileName, renderClipOptions);
    } else if (type === 'exportTimeline' && videoData && fileName && exportTimelineOptions) {
      await exportTimelineRequest(id, videoData, fileName, exportTimelineOptions);
    } else if (type === 'renderClipBatch' && videoData && fileName && renderClipBatchOptions) {
      await renderClipBatchRequest(id, videoData, fileName, renderClipBatchOptions);
    } else if (type === 'concatClips' && fileName && concatClipsOptions) {
      await concatClipsRequest(id, fileName, concatClipsOptions);
    } else {
      sendError(id, `Invalid request: missing required parameters for ${type}`);
    }
  } catch (error) {
    sendError(id, `Worker error: ${error instanceof Error ? error.message : String(error)}`);
  }
};
