/**
 * Edit-tab export via WebCodecs VideoEncoder (MediaCodec / VideoToolbox)
 * plus mediabunny muxing. FFmpeg WASM libx264 cannot use the phone GPU;
 * this path keeps unique-recipe stitch but encodes on hardware.
 */

import {
  BufferTarget,
  EncodedPacket,
  EncodedVideoPacketSource,
  Mp4OutputFormat,
  NullTarget,
  Output,
  QUALITY_VERY_HIGH,
  VideoSample,
  VideoSampleSource,
  canEncodeVideo,
} from 'mediabunny';
import type { ClipRenderSpec, TimelineRenderProgress } from '../../types/videoEdit';
import {
  planUniqueRenders,
  uniqueClipsShareOutputSize,
} from '../videoEdit/clipRenderFingerprint';
import { getHardwareExportReverseChunkFrames } from '../../constants/optimization';
import { DecoderSession } from './decoderSession';
import { DemuxerSession, arrayBufferToFile } from './demuxerSession';

const US_PER_SECOND = 1_000_000;
const RANGE_EPS = 1e-4;

type EncodedClipPackets = {
  packets: EncodedPacket[];
  meta?: EncodedVideoChunkMetadata;
};

export type HardwareExportCallbacks = {
  onProgress: (progress: TimelineRenderProgress) => void;
  isCancelled: () => boolean;
};

export class HardwareTimelineExportSession {
  private cancelled = false;
  private demuxer = new DemuxerSession();
  private canvas: OffscreenCanvas | null = null;
  private ctx: OffscreenCanvasRenderingContext2D | null = null;
  private outWidth = 0;
  private outHeight = 0;

  cancel(): void {
    this.cancelled = true;
  }

  async export(
    videoData: ArrayBuffer,
    fileName: string,
    clips: ClipRenderSpec[],
    callbacks: HardwareExportCallbacks
  ): Promise<Uint8Array> {
    this.cancelled = false;
    if (clips.length === 0) {
      throw new Error('No clips to export');
    }

    callbacks.onProgress({
      phase: 'loading',
      currentClip: 0,
      totalClips: clips.length,
      percent: 5,
      message: 'Preparing hardware encoder...',
    });

    const file = arrayBufferToFile(videoData, fileName);
    await this.demuxer.load(file);
    this.throwIfCancelled(callbacks);

    const probe = await this.demuxer.probe();
    const decoderConfig = await this.demuxer.getVideoDecoderConfig();
    const fps = Math.max(1, probe.frameRate || 30);

    const plan = planUniqueRenders(clips);
    const uniqueClips = plan.uniqueKeys.map((key) => plan.clipByKey.get(key)!);
    if (!uniqueClipsShareOutputSize(uniqueClips)) {
      throw new Error('Unique clips have different output sizes');
    }

    const sizeHint = outputSizeHint(uniqueClips[0], probe.width, probe.height);
    await assertCanEncodeAvc(sizeHint.width, sizeHint.height);
    this.throwIfCancelled(callbacks);

    const packets: EncodedPacket[] = [];
    let meta: EncodedVideoChunkMetadata | undefined;
    const output = new Output({
      format: new Mp4OutputFormat(),
      target: new NullTarget(),
    });
    const source = new VideoSampleSource({
      codec: 'avc',
      quality: QUALITY_VERY_HIGH,
      hardwareAcceleration: 'prefer-hardware',
      latencyMode: 'quality',
      keyFrameInterval: 2,
      sizeChangeBehavior: 'deny',
      onEncodedPacket: (packet, packetMeta) => {
        packets.push(packet.clone());
        if (!meta && packetMeta) meta = packetMeta;
      },
    });
    output.addVideoTrack(source);
    await output.start();

    const packetRanges: { key: string; startTs: number; endTs: number }[] = [];
    let encoderTs = 0;
    try {
      for (let i = 0; i < plan.uniqueKeys.length; i++) {
        this.throwIfCancelled(callbacks);
        const key = plan.uniqueKeys[i];
        const clip = plan.clipByKey.get(key)!;
        callbacks.onProgress({
          phase: 'rendering',
          currentClip: i + 1,
          totalClips: plan.uniqueKeys.length,
          percent: 15 + Math.round(((i + 0.5) / plan.uniqueKeys.length) * 65),
          message: `Hardware encoding unique clip ${i + 1} of ${plan.uniqueKeys.length}...`,
        });
        const startTs = encoderTs;
        encoderTs = await this.encodeClipOnto(
          decoderConfig,
          clip,
          fps,
          source,
          encoderTs,
          callbacks
        );
        packetRanges.push({ key, startTs, endTs: encoderTs });
      }
      source.close();
      await output.finalize();
    } catch (err) {
      await output.cancel().catch(() => undefined);
      throw err;
    }

    const packetsByKey = splitPacketsByRange(packets, packetRanges, meta);

    callbacks.onProgress({
      phase: 'concatenating',
      currentClip: clips.length,
      totalClips: clips.length,
      percent: 85,
      message: plan.keyByIndex.length === 1 ? 'Finishing...' : 'Joining timeline...',
    });

    const buffer = await muxTimelinePackets(packetsByKey, plan.keyByIndex, callbacks.isCancelled);
    this.throwIfCancelled(callbacks);
    return new Uint8Array(buffer);
  }

  async dispose(): Promise<void> {
    this.cancelled = true;
    this.demuxer.destroy();
    this.canvas = null;
    this.ctx = null;
  }

  private throwIfCancelled(callbacks: HardwareExportCallbacks): void {
    if (this.cancelled || callbacks.isCancelled()) {
      throw new HardwareExportCancelledError();
    }
  }

  private ensureCanvas(width: number, height: number): OffscreenCanvasRenderingContext2D {
    if (!this.canvas || this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas = new OffscreenCanvas(width, height);
      const ctx = this.canvas.getContext('2d', { alpha: false });
      if (!ctx) {
        throw new Error('OffscreenCanvas 2D context unavailable');
      }
      this.ctx = ctx;
    }
    if (!this.ctx) {
      throw new Error('OffscreenCanvas 2D context unavailable');
    }
    return this.ctx;
  }

  private lockOutputSize(width: number, height: number): void {
    const w = evenDim(width);
    const h = evenDim(height);
    if (this.outWidth === 0) {
      this.outWidth = w;
      this.outHeight = h;
      return;
    }
    if (this.outWidth !== w || this.outHeight !== h) {
      throw new Error(`Frame size ${w}x${h} does not match ${this.outWidth}x${this.outHeight}`);
    }
  }

  private drawFrame(frame: VideoFrame, clip: ClipRenderSpec): void {
    const srcW = frame.displayWidth || frame.codedWidth;
    const srcH = frame.displayHeight || frame.codedHeight;
    if (clip.crop && clip.crop.width > 0 && clip.crop.height > 0) {
      this.lockOutputSize(clip.crop.width, clip.crop.height);
    } else {
      this.lockOutputSize(srcW, srcH);
    }
    const ctx = this.ensureCanvas(this.outWidth, this.outHeight);
    if (clip.crop && clip.crop.width > 0 && clip.crop.height > 0) {
      ctx.drawImage(
        frame,
        clip.crop.x,
        clip.crop.y,
        clip.crop.width,
        clip.crop.height,
        0,
        0,
        this.outWidth,
        this.outHeight
      );
    } else {
      ctx.drawImage(frame, 0, 0, this.outWidth, this.outHeight);
    }
  }

  private blitToSample(
    frame: VideoFrame,
    clip: ClipRenderSpec,
    timestamp: number,
    duration: number
  ): VideoSample {
    this.drawFrame(frame, clip);
    return new VideoSample(this.canvas!, { timestamp, duration });
  }

  private async encodeClipOnto(
    decoderConfig: VideoDecoderConfig,
    clip: ClipRenderSpec,
    fps: number,
    source: VideoSampleSource,
    timeOffset: number,
    callbacks: HardwareExportCallbacks
  ): Promise<number> {
    if (clip.freeze) {
      return this.encodeFreeze(decoderConfig, clip, fps, source, timeOffset, callbacks);
    }
    if (clip.reversed) {
      return this.encodeReversed(decoderConfig, clip, fps, source, timeOffset, callbacks);
    }
    return this.encodeForward(decoderConfig, clip, fps, source, timeOffset, callbacks);
  }

  private async encodeForward(
    decoderConfig: VideoDecoderConfig,
    clip: ClipRenderSpec,
    fps: number,
    source: VideoSampleSource,
    timeOffset: number,
    callbacks: HardwareExportCallbacks
  ): Promise<number> {
    const speed = clip.speed > 0 ? clip.speed : 1;
    let encoded = 0;
    let lastEnd = timeOffset;
    await this.decodeRange(
      decoderConfig,
      clip.sourceStart,
      clip.sourceEnd,
      callbacks,
      async (frame) => {
        const srcTs = frame.timestamp / US_PER_SECOND;
        const duration = frameDurationSeconds(frame, fps) / speed;
        const timestamp = timeOffset + Math.max(0, srcTs - clip.sourceStart) / speed;
        const sample = this.blitToSample(frame, clip, timestamp, duration);
        if (encoded === 0) sample.setEncodeOptions({ keyFrame: true });
        encoded += 1;
        lastEnd = timestamp + duration;
        try {
          await source.add(sample);
        } finally {
          sample.close();
        }
      }
    );
    if (encoded === 0) {
      throw new Error('No frames decoded for clip');
    }
    return lastEnd;
  }

  private async encodeReversed(
    decoderConfig: VideoDecoderConfig,
    clip: ClipRenderSpec,
    fps: number,
    source: VideoSampleSource,
    timeOffset: number,
    callbacks: HardwareExportCallbacks
  ): Promise<number> {
    const speed = clip.speed > 0 ? clip.speed : 1;
    const windows = reverseWindows(clip.sourceStart, clip.sourceEnd, fps);
    let outTs = timeOffset;
    let encoded = 0;

    for (const window of windows) {
      this.throwIfCancelled(callbacks);
      const bitmaps: { bitmap: ImageBitmap; duration: number }[] = [];
      try {
        await this.decodeRange(decoderConfig, window.start, window.end, callbacks, async (frame) => {
          const duration = frameDurationSeconds(frame, fps);
          this.drawFrame(frame, clip);
          bitmaps.push({
            bitmap: await createImageBitmap(this.canvas!),
            duration,
          });
        });

        for (let i = bitmaps.length - 1; i >= 0; i--) {
          this.throwIfCancelled(callbacks);
          const held = bitmaps[i];
          const scaled = held.duration / speed;
          const sample = new VideoSample(held.bitmap, { timestamp: outTs, duration: scaled });
          if (encoded === 0) sample.setEncodeOptions({ keyFrame: true });
          encoded += 1;
          outTs += scaled;
          try {
            await source.add(sample);
          } finally {
            sample.close();
            held.bitmap.close();
          }
        }
        bitmaps.length = 0;
      } finally {
        for (const held of bitmaps) {
          try {
            held.bitmap.close();
          } catch {
            // already closed
          }
        }
      }
    }

    if (encoded === 0) {
      throw new Error('No frames decoded for reversed clip');
    }
    return outTs;
  }

  private async encodeFreeze(
    decoderConfig: VideoDecoderConfig,
    clip: ClipRenderSpec,
    fps: number,
    source: VideoSampleSource,
    timeOffset: number,
    callbacks: HardwareExportCallbacks
  ): Promise<number> {
    const freeze = clip.freeze!;
    const target = Math.max(0, freeze.sourceTime);
    const windowStart = Math.max(0, target - 0.25);
    const windowEnd = target + 0.25;
    const holder: { frame: VideoFrame | null; dist: number } = { frame: null, dist: Infinity };

    await this.decodeRange(decoderConfig, windowStart, windowEnd, callbacks, async (frame) => {
      const dist = Math.abs(frame.timestamp / US_PER_SECOND - target);
      if (dist < holder.dist) {
        holder.frame?.close();
        holder.frame = frame.clone();
        holder.dist = dist;
      }
    });

    if (!holder.frame) {
      throw new Error('Could not decode freeze frame');
    }

    const still = holder.frame;
    const duration = Math.max(0.05, freeze.durationSeconds);
    const frameDur = 1 / fps;
    const count = Math.max(1, Math.round(duration / frameDur));
    try {
      for (let i = 0; i < count; i++) {
        this.throwIfCancelled(callbacks);
        const sample = this.blitToSample(still, clip, timeOffset + i * frameDur, frameDur);
        if (i === 0) sample.setEncodeOptions({ keyFrame: true });
        try {
          await source.add(sample);
        } finally {
          sample.close();
        }
      }
    } finally {
      still.close();
    }
    return timeOffset + count * frameDur;
  }

  private async decodeRange(
    decoderConfig: VideoDecoderConfig,
    startSeconds: number,
    endSeconds: number,
    callbacks: HardwareExportCallbacks,
    onFrame: (frame: VideoFrame) => Promise<void>
  ): Promise<void> {
    const decoder = new DecoderSession();
    let streamReader: ReadableStreamDefaultReader<EncodedVideoChunk> | null = null;
    try {
      await decoder.configure(
        decoderConfig,
        async (frame) => {
          if (this.cancelled || callbacks.isCancelled()) return;
          const ts = frame.timestamp / US_PER_SECOND;
          if (ts < startSeconds - RANGE_EPS) return;
          if (ts >= endSeconds - RANGE_EPS) return;
          await onFrame(frame);
        },
        { optimizeForLatency: false }
      );

      const stream = this.demuxer.readVideoChunks(Math.max(0, startSeconds), Math.max(startSeconds, endSeconds));
      streamReader = stream.getReader();
      while (true) {
        this.throwIfCancelled(callbacks);
        const { done, value: chunk } = await streamReader.read();
        if (done || !chunk) break;
        await decoder.waitForCapacity();
        this.throwIfCancelled(callbacks);
        if (decoder.hasError) throw decoder.hasError;
        decoder.decode(chunk);
      }
      if (!this.cancelled && !callbacks.isCancelled()) {
        await decoder.flush();
      }
      if (decoder.hasError) throw decoder.hasError;
    } finally {
      if (streamReader) {
        try {
          await streamReader.cancel();
        } catch {
          // ignore
        }
      }
      decoder.close();
    }
  }
}

export class HardwareExportCancelledError extends Error {
  constructor() {
    super('Export cancelled');
    this.name = 'HardwareExportCancelledError';
  }
}

function evenDim(value: number): number {
  const rounded = Math.max(2, Math.round(value));
  return rounded % 2 === 0 ? rounded : rounded + 1;
}

function frameDurationSeconds(frame: VideoFrame, fps: number): number {
  if (typeof frame.duration === 'number' && frame.duration > 0) {
    return frame.duration / US_PER_SECOND;
  }
  return 1 / fps;
}

function outputSizeHint(
  clip: ClipRenderSpec,
  sourceWidth: number,
  sourceHeight: number
): { width: number; height: number } {
  if (clip.crop && clip.crop.width > 0 && clip.crop.height > 0) {
    return { width: evenDim(clip.crop.width), height: evenDim(clip.crop.height) };
  }
  return {
    width: evenDim(sourceWidth || 1280),
    height: evenDim(sourceHeight || 720),
  };
}

async function assertCanEncodeAvc(width: number, height: number): Promise<void> {
  const base = { width, height, quality: QUALITY_VERY_HIGH };
  const hardware = await canEncodeVideo('avc', {
    ...base,
    hardwareAcceleration: 'prefer-hardware',
  });
  if (hardware) return;
  const any = await canEncodeVideo('avc', base);
  if (any) return;
  throw new Error('This browser cannot encode H.264 with WebCodecs');
}

function reverseWindows(
  start: number,
  end: number,
  fps: number
): { start: number; end: number }[] {
  const span = Math.max(0, end - start);
  if (span <= 0) return [];
  const maxFrames = getHardwareExportReverseChunkFrames();
  const chunk = Math.max(1 / fps, maxFrames / fps);
  const windows: { start: number; end: number }[] = [];
  for (let t = start; t < end - RANGE_EPS; t += chunk) {
    windows.push({ start: t, end: Math.min(end, t + chunk) });
  }
  windows.reverse();
  return windows;
}

function splitPacketsByRange(
  packets: EncodedPacket[],
  ranges: { key: string; startTs: number; endTs: number }[],
  meta: EncodedVideoChunkMetadata | undefined
): Map<string, EncodedClipPackets> {
  const byKey = new Map<string, EncodedClipPackets>();
  for (let i = 0; i < ranges.length; i++) {
    const range = ranges[i];
    const isLast = i === ranges.length - 1;
    const slice = packets.filter((packet) => {
      if (packet.timestamp < range.startTs - RANGE_EPS) return false;
      if (isLast) return packet.timestamp <= range.endTs + RANGE_EPS;
      return packet.timestamp < range.endTs - RANGE_EPS;
    });
    if (slice.length === 0) {
      throw new Error('Hardware encoder produced no packets');
    }
    byKey.set(range.key, {
      packets: slice.map((packet) => packet.clone({ timestamp: Math.max(0, packet.timestamp - range.startTs) })),
      meta,
    });
  }
  return byKey;
}

async function muxTimelinePackets(
  packetsByKey: Map<string, EncodedClipPackets>,
  keyByIndex: string[],
  isCancelled: () => boolean
): Promise<ArrayBuffer> {
  const target = new BufferTarget();
  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
    target,
  });
  const source = new EncodedVideoPacketSource('avc');
  output.addVideoTrack(source);
  await output.start();

  try {
    let timeOffset = 0;
    let seq = 0;
    let passedMeta = false;

    for (const key of keyByIndex) {
      if (isCancelled()) throw new HardwareExportCancelledError();
      const stored = packetsByKey.get(key);
      if (!stored || stored.packets.length === 0) {
        throw new Error('Missing encoded clip for timeline stitch');
      }
      const firstTs = stored.packets[0].timestamp;
      let lastEnd = firstTs;
      for (const packet of stored.packets) {
        const clone = packet.clone({
          timestamp: packet.timestamp - firstTs + timeOffset,
          sequenceNumber: seq++,
        });
        lastEnd = Math.max(lastEnd, packet.timestamp + packet.duration);
        await source.add(clone, passedMeta ? undefined : stored.meta);
        passedMeta = true;
      }
      timeOffset += Math.max(0, lastEnd - firstTs);
    }

    source.close();
    await output.finalize();
  } catch (err) {
    await output.cancel().catch(() => undefined);
    throw err;
  }

  if (!target.buffer || target.buffer.byteLength === 0) {
    throw new Error('Hardware mux produced an empty file');
  }
  return target.buffer;
}

export function buildEditedVideoFileName(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  const base = dot > 0 ? fileName.slice(0, dot) : fileName;
  return `${base}_edited.mp4`;
}
