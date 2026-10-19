/**
 * WebCodecs capability checks for main thread and workers.
 */

export function isWebCodecsSupported(): boolean {
  return (
    typeof Worker !== 'undefined' &&
    typeof VideoDecoder !== 'undefined' &&
    typeof EncodedVideoChunk !== 'undefined' &&
    typeof OffscreenCanvas !== 'undefined' &&
    typeof VideoFrame !== 'undefined'
  );
}

/** Native H.264 encode (MediaCodec / VideoToolbox) — used for Edit-tab export. */
export function isVideoEncoderSupported(): boolean {
  return typeof VideoEncoder !== 'undefined' && typeof VideoEncoder.isConfigSupported === 'function';
}

export async function isVideoDecoderConfigSupported(
  config: VideoDecoderConfig
): Promise<boolean> {
  if (typeof VideoDecoder === 'undefined' || typeof VideoDecoder.isConfigSupported !== 'function') {
    return false;
  }

  try {
    const result = await VideoDecoder.isConfigSupported(config);
    return Boolean(result.supported);
  } catch {
    return false;
  }
}
