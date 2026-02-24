/**
 * Scheduler utility for managing tasks and chunked processing to keep the main thread responsive.
 */

// Define RequestIdleCallback types if not available in TS environment
type IdleDeadline = {
  didTimeout: boolean;
  timeRemaining: () => number;
};

type IdleRequestOptions = {
  timeout?: number;
};

type IdleCallbackHandle = number;

// Extend Window interface for TS
interface WindowWithIdle extends Window {
  requestIdleCallback: (
    callback: (deadline: IdleDeadline) => void,
    options?: IdleRequestOptions
  ) => IdleCallbackHandle;
  cancelIdleCallback: (handle: IdleCallbackHandle) => void;
}

/**
 * Schedules a low-priority task to run when the browser is idle.
 * Falls back to setTimeout if requestIdleCallback is not supported.
 * 
 * @param callback Function to execute
 * @param options Options for the idle callback
 * @returns A handle that can be used to cancel the callback (or timeout id)
 */
export const scheduleIdleTask = (
  callback: () => void,
  options?: IdleRequestOptions
): number => {
  if (
    typeof window !== 'undefined' &&
    'requestIdleCallback' in window
  ) {
    return (window as unknown as WindowWithIdle).requestIdleCallback(
      () => callback(),
      options
    );
  }
  
  // Fallback: use setTimeout to yield to the event loop
  return window.setTimeout(callback, 1);
};

/**
 * Process a large array of items in chunks, yielding to the main thread between chunks.
 * This prevents the UI from freezing during heavy synchronous or main-thread operations.
 * 
 * @param items Array of items to process
 * @param processFn Async function to process a single item or a chunk of items
 * @param chunkSize Number of items to process in one go
 * @param onProgress Optional callback for progress updates
 * @returns Promise resolving to an array of results
 */
export async function processInChunks<T, R>(
  items: T[],
  processFn: (item: T) => Promise<R>,
  chunkSize: number = 10,
  onProgress?: (completed: number) => void
): Promise<R[]> {
  const results: R[] = [];
  
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    
    // Process current chunk in parallel
    const chunkResults = await Promise.all(
      chunk.map(item => processFn(item))
    );
    
    results.push(...chunkResults);
    
    if (onProgress) {
      onProgress(results.length);
    }
    
    // If there are more items, yield to main thread to allow UI updates
    if (i + chunkSize < items.length) {
      await new Promise<void>(resolve => {
        scheduleIdleTask(resolve, { timeout: 100 });
      });
    }
  }
  
  return results;
}
