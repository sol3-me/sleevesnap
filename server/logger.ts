/**
 * Minimal structured-ish console logging shared across the golden-path
 * routes (scan → vision → search → save). Every line is tagged with a scope
 * and a per-request id so concurrent requests can be told apart when tailing
 * server output — plain console.log otherwise interleaves unreadably.
 */

export function newRequestId(): string {
  return Math.random().toString(36).slice(2, 8);
}

export function logEvent(scope: string, requestId: string, message: string, data?: Record<string, unknown>): void {
  const suffix = data ? ` ${JSON.stringify(data)}` : '';
  console.log(`[${scope}] [${requestId}] ${message}${suffix}`);
}

export function logWarn(scope: string, requestId: string, message: string, data?: Record<string, unknown>): void {
  const suffix = data ? ` ${JSON.stringify(data)}` : '';
  console.warn(`[${scope}] [${requestId}] ${message}${suffix}`);
}
