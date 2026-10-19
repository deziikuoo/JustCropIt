/**
 * WebCodecs Video Processing Worker
 *
 * Demuxes with web-demuxer and decodes via VideoDecoder (prefer-hardware).
 * Edit-tab export encodes with VideoEncoder when available; trim stays on FFmpeg.
 */

/// <reference lib="webworker" />

import type {
  VideoWorkerRequest,
  VideoWorkerResponse,
  ExtractionProgress,
} from '../types/video';
import { isVideoEncoderSupported, isWebCodecsSupported } from '../utils/webCodecs/support';
import { WebCodecsExtractionSession } from '../utils/webCodecs/extractFrames';
import {
  buildEditedVideoFileName,
  HardwareExportCancelledError,
  HardwareTimelineExportSession,
} from '../utils/webCodecs/hardwareExport';

const ctx: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;

let activeSession: WebCodecsExtractionSession | null = null;
let hardwareExport: HardwareTimelineExportSession | null = null;
let isCancelled = false;

function sendProgress(id: string, progress: ExtractionProgress): void {
  ctx.postMessage({ id, type: 'progress', progress } as VideoWorkerResponse);
}

function sendError(id: string, error: string): void {
  ctx.postMessage({ id, type: 'error', error } as VideoWorkerResponse);
}

async function disposeActiveSession(): Promise<void> {
  if (activeSession) {
    const session = activeSession;
    activeSession = null;
    await session.dispose();
  }
  if (hardwareExport) {
    const session = hardwareExport;
    hardwareExport = null;
    await session.dispose();
  }
}

async function probeVideo(
  id: string,
  videoData: ArrayBuffer,
  fileName: string
): Promise<void> {
  const session = new WebCodecsExtractionSession();
  activeSession = session;

  try {
    sendProgress(id, {
      phase: 'loading',
      currentFrame: 0,
      totalFrames: 0,
      percent: 0,
      message: 'Probing video...',
    });

    const info = await session.probe(videoData, fileName);

    ctx.postMessage({
      id,
      type: 'info',
      info: {
        duration: info.duration,
        width: info.width,
        height: info.height,
        frameRate: info.frameRate,
        codec: info.codec,
      },
    } as VideoWorkerResponse);
  } catch (error) {
    sendError(
      id,
      `Failed to probe video: ${error instanceof Error ? error.message : String(error)}`
    );
  } finally {
    await disposeActiveSession();
  }
}

async function extractFrames(
  id: string,
  videoData: ArrayBuffer,
  fileName: string,
  options: NonNullable<VideoWorkerRequest['options']>
): Promise<void> {
  isCancelled = false;
  const session = new WebCodecsExtractionSession();
  activeSession = session;

  try {
    const result = await session.extract(videoData, fileName, options, {
      onProgress: (progress) => sendProgress(id, progress),
      onFrame: (frame) => {
        const copy = frame.data.slice();
        ctx.postMessage(
          {
            id,
            type: 'frame',
            frame: {
              index: frame.index,
              timestamp: frame.timestamp,
              data: copy,
              mimeType: frame.mimeType,
            },
          } as VideoWorkerResponse,
          [copy.buffer]
        );
      },
      isCancelled: () => isCancelled,
    });

    if (result.cancelled || isCancelled) {
      ctx.postMessage({
        id,
        type: 'cancelled',
        framesExtracted: result.framesExtracted,
      } as VideoWorkerResponse);
      return;
    }

    ctx.postMessage({
      id,
      type: 'complete',
      framesExtracted: result.framesExtracted,
      progress: {
        phase: 'complete',
        currentFrame: result.framesExtracted,
        totalFrames: result.framesExtracted,
        percent: 100,
        message:
          result.failedFrames > 0
            ? `Extracted ${result.framesExtracted} frames (${result.failedFrames} failed)`
            : `Extracted ${result.framesExtracted} frames`,
      },
    } as VideoWorkerResponse);
  } catch (error) {
    if (isCancelled) {
      ctx.postMessage({
        id,
        type: 'cancelled',
        framesExtracted: 0,
      } as VideoWorkerResponse);
      return;
    }
    sendError(
      id,
      `Extraction failed: ${error instanceof Error ? error.message : String(error)}`
    );
  } finally {
    await disposeActiveSession();
  }
}

async function exportTimelineHardware(
  id: string,
  videoData: ArrayBuffer,
  fileName: string,
  clips: NonNullable<VideoWorkerRequest['exportTimelineOptions']>['clips']
): Promise<void> {
  isCancelled = false;
  const session = new HardwareTimelineExportSession();
  hardwareExport = session;

  try {
    const data = await session.export(videoData, fileName, clips, {
      onProgress: (progress) => {
        ctx.postMessage({
          id,
          type: 'progress',
          timelineProgress: progress,
        } as VideoWorkerResponse);
      },
      isCancelled: () => isCancelled,
    });

    if (isCancelled) {
      ctx.postMessage({ id, type: 'cancelled' } as VideoWorkerResponse);
      return;
    }

    const copy = data.slice();
    ctx.postMessage(
      {
        id,
        type: 'exportTimelineComplete',
        exportedTimeline: {
          data: copy,
          mimeType: 'video/mp4',
          fileName: buildEditedVideoFileName(fileName),
        },
        timelineProgress: {
          phase: 'complete',
          currentClip: clips.length,
          totalClips: clips.length,
          percent: 100,
          message: 'Export complete',
        },
      } as VideoWorkerResponse,
      [copy.buffer]
    );
  } catch (error) {
    if (error instanceof HardwareExportCancelledError || isCancelled) {
      ctx.postMessage({ id, type: 'cancelled' } as VideoWorkerResponse);
      return;
    }
    sendError(
      id,
      `Hardware export failed: ${error instanceof Error ? error.message : String(error)}`
    );
  } finally {
    await disposeActiveSession();
  }
}

ctx.onmessage = async (event: MessageEvent<VideoWorkerRequest>) => {
  const { id, type, videoData, fileName, options, exportTimelineOptions } = event.data;

  try {
    if (type === 'cancel') {
      isCancelled = true;
      activeSession?.cancel();
      hardwareExport?.cancel();
      return;
    }

    if (type === 'trim') {
      sendError(id, 'Trim is handled by the FFmpeg worker, not WebCodecs');
      return;
    }

    if (!isWebCodecsSupported()) {
      sendError(
        id,
        'WebCodecs is not supported in this browser. Use Chrome, Edge, or Firefox.'
      );
      return;
    }

    if (type === 'probe' && videoData && fileName) {
      await probeVideo(id, videoData, fileName);
    } else if (type === 'extract' && videoData && fileName && options) {
      await extractFrames(id, videoData, fileName, options);
    } else if (type === 'exportTimeline' && videoData && fileName && exportTimelineOptions) {
      if (!isVideoEncoderSupported()) {
        sendError(id, 'WebCodecs VideoEncoder is not available in this browser');
        return;
      }
      await exportTimelineHardware(id, videoData, fileName, exportTimelineOptions.clips);
    } else {
      sendError(id, `Invalid request: missing required parameters for ${type}`);
    }
  } catch (error) {
    sendError(
      id,
      `Worker error: ${error instanceof Error ? error.message : String(error)}`
    );
  }
};
