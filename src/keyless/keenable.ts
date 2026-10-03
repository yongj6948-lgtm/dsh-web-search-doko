/**
 * Keyless Keenable vendor. Keenable exposes a public search + fetch tier that
 * only requires the `X-Keenable-Title` app-id header (no account), per Hermes
 * Agent's free-tier ring.
 * @module dsh-web-search-doko/keyless/keenable
 */

import { isAbortError, isRateLimitish, KeylessError } from './errors.js'
import type { KeylessHit, KeylessPage, KeylessVendor } from './types.js'

/** Keenable's public API base URL. */
export const KEENABLE_API_URL = 'https://api.keenable.ai'

/** App identifier sent in `X-Keenable-Title` (mandatory on public endpoints). */
export const KEENABLE_TITLE = 'dsh-web-search-doko'

/** Build the Keenable keyless vendor bound to a request timeout. */
export function keenableVendor(timeoutMs: number): KeylessVendor {
  return {
    id: 'keenable',
    async search(query: string, limit: number, signal?: AbortSignal): Promise<readonly KeylessHit[]> {
      const data = await request('POST', '/v1/search/public', {
        body: JSON.stringify({ query, max_results: Math.max(1, limit) }),
        timeoutMs,
        ...signal !== undefined ? { signal } : {},
      })
      const results = Array.isArray(data['results']) ? data['results'] : []
      return results.slice(0, limit).flatMap((raw): KeylessHit[] => {
        const hit = asRecord(raw)
        const url = asString(hit['url'])
        if (url === undefined || url.length === 0) return []
        const title = asString(hit['title'])
        const snippet = asString(hit['snippet']) ?? asString(hit['description'])
        const published = asString(hit['published_at']) ?? asString(hit['publishedAt'])
        return [{
          url,
          ...title !== undefined && title.length > 0 ? { title } : {},
          ...snippet !== undefined && snippet.length > 0 ? { snippet } : {},
          ...published !== undefined && published.length > 0 ? { publishedAt: published } : {},
        }]
      })
    },
    async fetch(url: string, signal?: AbortSignal): Promise<KeylessPage> {
      const data = await request('GET', `/v1/fetch/public?url=${encodeURIComponent(url)}`, {
        timeoutMs,
        ...signal !== undefined ? { signal } : {},
      })
      const finalUrl = asString(data['url']) ?? url
      const title = asString(data['title'])
      const content = asString(data['content']) ?? ''
      return { url: finalUrl, ...title !== undefined && title.length > 0 ? { title } : {}, content }
    },
  }
}

/** One Keenable public request with the mandatory app-id header. */
async function request(
  method: 'GET' | 'POST',
  path: string,
  options: { body?: string; timeoutMs: number; signal?: AbortSignal },
): Promise<Record<string, unknown>> {
  const timeout = AbortSignal.timeout(options.timeoutMs)
  const signal = options.signal !== undefined ? AbortSignal.any([options.signal, timeout]) : timeout
  const headers: Record<string, string> = {
    'x-keenable-title': KEENABLE_TITLE,
    accept: 'application/json',
  }
  if (options.body !== undefined) headers['content-type'] = 'application/json'

  let response: Response
  try {
    response = await fetch(`${KEENABLE_API_URL}${path}`, {
      method,
      headers,
      ...options.body !== undefined ? { body: options.body } : {},
      signal,
    })
  } catch (error) {
    if (isAbortError(error)) {
      if (options.signal?.aborted === true) throw new KeylessError('keenable', 'request aborted', false, error)
      throw new KeylessError('keenable', `timed out after ${options.timeoutMs}ms`, false, error)
    }
    throw new KeylessError('keenable', `request failed: ${String(error)}`, false, error)
  }

  const body = await response.text()
  if (!response.ok) {
    throw new KeylessError('keenable', `HTTP ${response.status}: ${body.slice(0, 300)}`, response.status === 429 || isRateLimitish(body))
  }
  try {
    return JSON.parse(body) as Record<string, unknown>
  } catch (error) {
    throw new KeylessError('keenable', `unprocessable body: ${String(error)}`, false, error)
  }
}

/** Narrow an unknown JSON value to a record. */
function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
}

/** Return a string field, or `undefined` when absent/not a string. */
function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}