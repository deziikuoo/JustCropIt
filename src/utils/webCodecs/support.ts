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
