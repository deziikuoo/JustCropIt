/**
 * Captures a single frame from a video URL at a given timestamp as an
 * object URL (JPEG). Used for timeline thumbnails and to seed the crop tool.
 */
export function captureVideoFrameAsUrl(
  videoUrl: string,
  sourceTime: number,
  options?: { maxEdgePx?: number; quality?: number }
): Promise<string> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.src = videoUrl;
    const maxEdgePx = options?.maxEdgePx;
    const quality = options?.quality ?? 0.9;

    const cleanup = () => {
      video.removeEventListener('loadeddata', onLoadedData);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
    };

    const onError = () => {
      cleanup();
      reject(new Error('Failed to load video for frame capture'));
    };

    const onSeeked = () => {
      try {
        let width = video.videoWidth || 1;
        let height = video.videoHeight || 1;
        if (maxEdgePx && maxEdgePx > 0) {
          const longest = Math.max(width, height);
          if (longest > maxEdgePx) {
            const scale = maxEdgePx / longest;
            width = Math.max(1, Math.round(width * scale));
            height = Math.max(1, Math.round(height * scale));
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas 2D context unavailable');
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(
          (blob) => {
            cleanup();
            video.removeAttribute('src');
            video.load();
            if (!blob) {
              reject(new Error('Failed to encode captured frame'));
              return;
            }
            resolve(URL.createObjectURL(blob));
          },
          'image/jpeg',
          quality
        );
      } catch (err) {
        cleanup();
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    };

    const onLoadedData = () => {
      const target = Math.max(0, sourceTime);
      if (Math.abs(video.currentTime - target) < 0.01) {
        onSeeked();
        return;
      }
      video.currentTime = target;
    };

    video.addEventListener('loadeddata', onLoadedData);
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('error', onError);
  });
}
