/**
 * Keyless Exa vendor. Talks to Exa's anonymous MCP endpoint (`mcp.exa.ai/mcp`),
 * which needs no API key and returns human/LLM-friendly text blocks. Used by the
 * `free` provider ring (and pinnable on its own).
 * @module dsh-web-search-doko/keyless/exa
 */

import { mcpCall } from './mcp.js'
import type { KeylessHit, KeylessPage, KeylessVendor } from './types.js'

/** Exa's public, keyless MCP endpoint. */
export const EXA_MCP_URL = 'https://mcp.exa.ai/mcp'

/** Labels that delimit Exa's `Title:/URL:/Published:/Author:/Highlights:` blocks. */
const EXA_LABELS = ['Title:', 'URL:', 'Published:', 'Author:', 'Highlights:'] as const

/** Build the Exa keyless vendor bound to a request timeout. */
export function exaVendor(timeoutMs: number): KeylessVendor {
  return {
    id: 'exa',
    async search(query: string, limit: number, signal?: AbortSignal): Promise<readonly KeylessHit[]> {
      const text = await mcpCall(
        EXA_MCP_URL,
        'web_search_exa',
        { query, numResults: Math.max(1, limit) },
        { vendor: 'exa', timeoutMs, ...signal !== undefined ? { signal } : {} },
      )
      return parseExaSearch(text, limit)
    },
    async fetch(url: string, signal?: AbortSignal): Promise<KeylessPage> {
      const text = await mcpCall(
        EXA_MCP_URL,
        'web_fetch_exa',
        { urls: [url] },
        { vendor: 'exa', timeoutMs, ...signal !== undefined ? { signal } : {} },
      )
      const title = parseExaTitle(text)
      return { url, ...title.length > 0 ? { title } : {}, content: text }
    },
  }
}

/**
 * Parse Exa's `---`-separated search text into normalized hits. Tolerant by
 * design: missing fields are simply omitted.
 *
 * @param text - the MCP text payload.
 * @param limit - max hits to return.
 */
export function parseExaSearch(text: string, limit: number): KeylessHit[] {
  const hits: KeylessHit[] = []
  for (const block of text.split('\n---\n')) {
    let title = ''
    let url = ''
    let published = ''
    let inHighlights = false
    const highlights: string[] = []

    for (const raw of block.split(/\r\n|\r|\n/)) {
      const line = raw.trim()
      if (line.startsWith('Title:')) {
        title = line.slice('Title:'.length).trim()
        inHighlights = false
      } else if (line.startsWith('URL:')) {
        url = line.slice('URL:'.length).trim()
        inHighlights = false
      } else if (line.startsWith('Published:')) {
        published = line.slice('Published:'.length).trim()
        inHighlights = false
      } else if (line.startsWith('Author:')) {
        inHighlights = false
      } else if (line.startsWith('Highlights:')) {
        inHighlights = true
      } else if (inHighlights && !EXA_LABELS.some((label) => line.startsWith(label)) && line.length > 0) {
        highlights.push(line)
      }
    }

    if (url.length > 0) {
      hits.push({
        url,
        ...title.length > 0 ? { title } : {},
        ...highlights.length > 0 ? { snippet: highlights.join(' ') } : {},
        ...published.length > 0 && published !== 'N/A' ? { publishedAt: published } : {},
      })
    }
    if (hits.length >= limit) break
  }
  return hits
}

/** First markdown H1 or `Title:` line in an Exa extraction payload, else `''`. */
export function parseExaTitle(text: string): string {
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = raw.trim()
    if (line.startsWith('# ')) return line.slice(2).trim()
    if (line.startsWith('Title:')) return line.slice('Title:'.length).trim()
  }
  return ''
}