/**
 * Error vocabulary for the keyless (no-API-key) vendor ring borrowed from Hermes
 * Agent's public free-tier rotation. Anonymous endpoints throttle aggressively, so
 * the ring must distinguish "this vendor is rate-limited, try the next" from a
 * genuine parse/transport failure.
 * @module dsh-web-search-doko/keyless/errors
 */

/** Substrings that mark an anonymous free-tier throttle (HTTP 429 and friends). */
export const RATE_LIMIT_MARKERS = [
  'rate limit', 'rate-limit', 'ratelimit', 'too many requests', '429',
  'quota exceeded', 'slow down',
] as const

/** Heuristic: does an error/body message look like free-tier throttling? */
export function isRateLimitish(message: string): boolean {
  const lower = message.toLowerCase()
  return RATE_LIMIT_MARKERS.some((marker) => lower.includes(marker))
}

/** A keyless vendor call failed. `rateLimited` lets the ring advance to the next vendor. */
export class KeylessError extends Error {
  /** The vendor id that produced the failure. */
  readonly vendor: string
  /** True when the failure is anonymous free-tier throttling. */
  readonly rateLimited: boolean

  constructor(vendor: string, message: string, rateLimited = false, cause?: unknown) {
    super(message, cause !== undefined ? { cause } : undefined)
    this.name = 'KeylessError'
    this.vendor = vendor
    this.rateLimited = rateLimited
  }
}

/** True for a fetch or `AbortSignal` abort. */
export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}