/**
 * Keyless Parallel vendor. Parallel's anonymous MCP endpoint (`search.parallel.ai/mcp`)
 * needs no API key; it correlates free-tier rate limits with a random per-process
 * `session_id` (no user identifiers are sent).
 * @module dsh-web-search-doko/keyless/parallel
 */

import { randomUUID } from 'node:crypto'
import { isRateLimitish, KeylessError } from './errors.js'
import { mcpCall } from './mcp.js'
import type { KeylessHit, KeylessPage, KeylessVendor } from './types.js'

/** Parallel's public, keyless MCP endpoint. */
export const PARALLEL_MCP_URL = 'https://search.parallel.ai/mcp'

/** Random per-process session id, used only for free-tier rate-limit correlation. */
const SESSION_ID = randomUUID().replace(/-/g, '')

/** Build the Parallel keyless vendor bound to a request timeout. */
export function parallelVendor(timeoutMs: number): KeylessVendor {
  return {
    id: 'parallel',
    async search(query: string, limit: number, signal?: AbortSignal): Promise<readonly KeylessHit[]> {
      const text = await mcpCall(
        PARALLEL_MCP_URL,
        'web_search',
        { objective: query, search_queries: [query], session_id: SESSION_ID },
        { vendor: 'parallel', timeoutMs, ...signal !== undefined ? { signal } : {} },
      )
      const parsed = parseJson(text, 'parallel')
      const results = Array.isArray(parsed['results']) ? parsed['results'] : []
      return results.slice(0, limit).flatMap((raw): KeylessHit[] => {
        const hit = asRecord(raw)
        const url = asString(hit['url'])
        if (url === undefined || url.length === 0) return []
        const title = asString(hit['title'])
        const excerpts = Array.isArray(hit['excerpts']) ? hit['excerpts'].filter((e): e is string => typeof e === 'string') : []
        const published = asString(hit['publish_date']) ?? asString(hit['publishedAt'])
        return [{
          url,
          ...title !== undefined && title.length > 0 ? { title } : {},
          ...excerpts.length > 0 ? { snippet: excerpts.join(' ') } : {},
          ...published !== undefined && published.length > 0 ? { publishedAt: published } : {},
        }]
      })
    },
    async fetch(url: string, signal?: AbortSignal): Promise<KeylessPage> {
      const text = await mcpCall(
        PARALLEL_MCP_URL,
        'web_fetch',
        { urls: [url], objective: 'Full page content', session_id: SESSION_ID },
        { vendor: 'parallel', timeoutMs, ...signal !== undefined ? { signal } : {} },
      )
      const parsed = parseJson(text, 'parallel')
      const results = Array.isArray(parsed['results']) ? parsed['results'] : []
      const match = results.map(asRecord).find((entry) => asString(entry['url']) === url) ?? asRecord(results[0])
      const full = asString(match['full_content']) ?? asString(match['content'])
      const excerpts = Array.isArray(match['excerpts']) ? match['excerpts'].filter((e): e is string => typeof e === 'string') : []
      const content = full ?? excerpts.join('\n\n')
      const title = asString(match['title'])
      const finalUrl = asString(match['url']) ?? url
      return { url: finalUrl, ...title !== undefined && title.length > 0 ? { title } : {}, content }
    },
  }
}

/** Parse a vendor JSON text payload, mapping parse failure to {@link KeylessError}. */
function parseJson(text: string, vendor: string): Record<string, unknown> {
  try {
    const value = JSON.parse(text) as unknown
    if (typeof value !== 'object' || value === null) throw new Error('not an object')
    return value as Record<string, unknown>
  } catch (error) {
    throw new KeylessError(vendor, `unexpected JSON payload: ${String(error)}`, isRateLimitish(text), error)
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