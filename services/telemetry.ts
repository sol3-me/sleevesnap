/**
 * Lightweight browser-console logging for the golden path (capture → scan
 * result → search). Mirrors the server's bracket-tag style
 * (`server/logger.ts`) so log lines read consistently whether you're
 * tailing the Node process or watching devtools.
 */

export function logEvent(scope: string, message: string, data?: Record<string, unknown>): void {
  if (data) {
    console.log(`[${scope}] ${message}`, data);
  } else {
    console.log(`[${scope}] ${message}`);
  }
}

export function logWarn(scope: string, message: string, data?: Record<string, unknown>): void {
  if (data) {
    console.warn(`[${scope}] ${message}`, data);
  } else {
    console.warn(`[${scope}] ${message}`);
  }
}
