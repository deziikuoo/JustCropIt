/**
 * Hide SAM / ORT messages that are expected and unactionable.
 */

const IGNORE = [
  /\[SAM\] Loaded .+ from cache/,
  /\[SAM\] Session created with /,
  /\[SAM\] Cached /,
  /powerPreference option is currently ignored/i,
  /crbug\.com\/369219127/,
  /Some nodes were not assigned to the preferred execution providers/,
  /VerifyEachNodeIsAssignedToAnEp/,
  /Unknown CPU vendor/,
  /LogEarlyWarning/,
];

function shouldIgnore(args: unknown[]): boolean {
  const text = args
    .map((value) => (typeof value === 'string' ? value : ''))
    .join(' ');
  return IGNORE.some((pattern) => pattern.test(text));
}

export function quietIgnorableSamLogs(
  scope: { console: Console } = globalThis
): void {
  const flagged = scope as { __justCropItQuietSamLogs?: boolean };
  if (flagged.__justCropItQuietSamLogs) return;
  flagged.__justCropItQuietSamLogs = true;

  const methods = ['log', 'info', 'warn', 'debug'] as const;
  for (const method of methods) {
    const original = scope.console[method].bind(scope.console);
    scope.console[method] = (...args: unknown[]) => {
      if (shouldIgnore(args)) return;
      original(...args);
    };
  }
}

export function quietOrtLogs(env: object): void {
  (env as { logLevel: string }).logLevel = 'error';
}

quietIgnorableSamLogs();
