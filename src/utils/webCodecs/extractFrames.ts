/**
 * Single-pass sequential WebCodecs frame extraction.
 *
 * Decodes the video once from a keyframe before trimStart through trimEnd,
 * capturing the first decoded frame at or after each target timestamp.
 */

import {
  WEBCODECS_PROGRESS_EVERY_N_FRAMES,
  WEBCODECS_TIMESTAMP_TOLERANCE_US,
} from '../../constants/optimization';
import { DemuxerSession, arrayBufferToFile } from './demuxerSession';
import { DecoderSession } from './decoderSession';
import { FrameCapture } from './frameCapture';
import type {
  ExtractionOptions,
  WebCodecsExtractCallbacks,
  WebCodecsExtractResult,
  WebCodecsProbeResult,
} from './types';

const US_PER_SECOND = 1_000_000;

export class WebCodecsExtractionSession {
  private demuxer = new DemuxerSession();
  private decoder = new DecoderSession();
  private capture = new FrameCapture();
  private cancelled = false;
  private streamReader: ReadableStreamDefaultReader<EncodedVideoChunk> | null = null;

  cancel(): void {
    this.cancelled = true;
    if (this.streamReader) {
      void this.streamReader.cancel().catch(() => undefined);
    }
  }

  get isCancelled(): boolean {
    return this.cancelled;
  }

  async probe(videoData: ArrayBuffer, fileName: string): Promise<WebCodecsProbeResult> {
    const file = arrayBufferToFile(videoData, fileName);
    await this.demuxer.load(file);
    try {
      return await this.demuxer.probe();
    } finally {
      // Keep demuxer only for short probe; dispose after
      this.demuxer.destroy();
    }
  }

  async extract(
    videoData: ArrayBuffer,
    fileName: string,
    options: ExtractionOptions,
    callbacks: WebCodecsExtractCallbacks
  ): Promise<WebCodecsExtractResult> {
    this.cancelled = false;

    const intervalSeconds = options.intervalMs / 1000;
    if (!Number.isFinite(intervalSeconds) || intervalSeconds <= 0) {
      throw new Error('Invalid extraction interval');
    }

    const clipDuration = options.videoDuration;
    const trimStart = options.trimStartSeconds ?? 0;
    if (!clipDuration || clipDuration <= 0) {
      throw new Error('Video duration unknown — reload the video and try again');
    }

    const trimEnd = trimStart + clipDuration;
    const targets = buildTargetTimestamps(
      trimStart,
      trimEnd,
      intervalSeconds,
      options.maxFrames
    );

    if (targets.length === 0) {
      throw new Error('No frames to extract at this interval');
    }

    const isJpeg = options.outputFormat === 'jpeg';
    const jpegQuality =
      typeof options.quality === 'number' && options.quality > 0 && options.quality <= 1
        ? options.quality
        : 0.95;

    callbacks.onProgress({
      phase: 'loading',
      currentFrame: 0,
      totalFrames: targets.length,
      percent: 0,
      message: 'Loading demuxer...',
    });

    const file = arrayBufferToFile(videoData, fileName);
    await this.demuxer.load(file);

    if (this.cancelled || callbacks.isCancelled()) {
      return { framesExtracted: 0, cancelled: true, failedFrames: 0 };
    }

    callbacks.onProgress({
      phase: 'loading',
      currentFrame: 0,
      totalFrames: targets.length,
      percent: 3,
      message: 'Configuring hardware decoder...',
    });

    const decoderConfig = await this.demuxer.getVideoDecoderConfig();

    let targetIndex = 0;
    let framesSent = 0;
    let failedFrames = 0;
    const toleranceSec = WEBCODECS_TIMESTAMP_TOLERANCE_US / US_PER_SECOND;

    await this.decoder.configure(decoderConfig, async (frame) => {
      if (this.cancelled || callbacks.isCancelled()) {
        return;
      }

      const frameTs = frame.timestamp / US_PER_SECOND;

      // Still decoding pre-roll frames before trim window
      if (frameTs < trimStart - toleranceSec && targetIndex === 0) {
        return;
      }

      // Past the clip — nothing left to capture
      if (frameTs > trimEnd + toleranceSec && targetIndex >= targets.length) {
        return;
      }

      while (
        targetIndex < targets.length &&
        frameTs >= targets[targetIndex] - toleranceSec
      ) {
        const targetTs = targets[targetIndex];
        const index = targetIndex;
        targetIndex++;

        // Skip targets that are clearly past trim end
        if (targetTs > trimEnd + toleranceSec) {
          continue;
        }

        try {
          const { data, mimeType } = await this.capture.capture(
            frame,
            isJpeg ? 'jpeg' : 'png',
            jpegQuality
          );

          callbacks.onFrame({
            index,
            timestamp: targetTs,
            data,
            mimeType,
          });
          framesSent++;

          if (
            framesSent === 1 ||
            framesSent === targets.length ||
            framesSent % WEBCODECS_PROGRESS_EVERY_N_FRAMES === 0
          ) {
            callbacks.onProgress({
              phase: 'processing',
              currentFrame: framesSent,
              totalFrames: targets.length,
              percent: 5 + Math.round((framesSent / targets.length) * 90),
              message: `Extracted frame ${framesSent} of ${targets.length}...`,
            });
          }
        } catch (err) {
          console.warn(`[WebCodecs] Frame capture failed at ${targetTs}s:`, err);
          failedFrames++;
        }

        if (this.cancelled || callbacks.isCancelled()) {
          return;
        }
      }
    });

    callbacks.onProgress({
      phase: 'extracting',
      currentFrame: 0,
      totalFrames: targets.length,
      percent: 5,
      message: 'Decoding video...',
    });

    // Start slightly before trimStart so demuxer can land on a prior keyframe.
    // web-demuxer seek-backward handles the actual keyframe alignment.
    const streamStart = Math.max(0, trimStart);
    const stream = this.demuxer.readVideoChunks(streamStart, trimEnd);
    this.streamReader = stream.getReader();

    try {
      while (true) {
        if (this.cancelled || callbacks.isCancelled()) {
          break;
        }
        if (targetIndex >= targets.length) {
          break;
        }

        const { done, value: chunk } = await this.streamReader.read();
        if (done || !chunk) {
          break;
        }

        await this.decoder.waitForCapacity();
        if (this.cancelled || callbacks.isCancelled()) {
          break;
        }
        if (this.decoder.hasError) {
          throw this.decoder.hasError;
        }

        this.decoder.decode(chunk);
      }

      if (!this.cancelled && !callbacks.isCancelled()) {
        await this.decoder.flush();
      }
    } finally {
      if (this.streamReader) {
        try {
          await this.streamReader.cancel();
        } catch {
          // ignore
        }
        this.streamReader = null;
      }
    }

    if (this.cancelled || callbacks.isCancelled()) {
      return { framesExtracted: framesSent, cancelled: true, failedFrames };
    }

    if (framesSent === 0) {
      throw new Error(
        failedFrames > 0
          ? `Failed to extract any frames (${failedFrames} capture errors)`
          : 'Failed to extract any frames — codec may be unsupported'
      );
    }

    callbacks.onProgress({
      phase: 'complete',
      currentFrame: framesSent,
      totalFrames: framesSent,
      percent: 100,
      message:
        failedFrames > 0
          ? `Extracted ${framesSent} frames (${failedFrames} failed)`
          : `Extracted ${framesSent} frames`,
    });

    return { framesExtracted: framesSent, cancelled: false, failedFrames };
  }

  async dispose(): Promise<void> {
    this.cancelled = true;
    if (this.streamReader) {
      try {
        await this.streamReader.cancel();
      } catch {
        // ignore
      }
      this.streamReader = null;
    }
    this.decoder.close();
    this.demuxer.destroy();
    this.capture.dispose();
  }
}

function buildTargetTimestamps(
  trimStart: number,
  trimEnd: number,
  intervalSeconds: number,
  maxFrames?: number
): number[] {
  const targets: number[] = [];
  let t = trimStart;
  // Use a small epsilon so floating point doesn't overshoot the last slot
  const endLimit = trimEnd - 1e-9;

  while (t <= endLimit) {
    targets.push(t);
    if (maxFrames && targets.length >= maxFrames) {
      break;
    }
    t += intervalSeconds;
  }

  return targets;
}
