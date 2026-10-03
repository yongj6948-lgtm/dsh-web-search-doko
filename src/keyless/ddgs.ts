/**
 * Keyless DuckDuckGo (DDGS) vendor. Scrapes the no-JS `html.duckduckgo.com`
 * results page — no API key, but **search-only** (DuckDuckGo has no extract
 * endpoint) and subject to regional blocking, so it is opt-in and not part of
 * the default ring. Behind a blocked network, reach it by running the harness
 * with a proxy (e.g. `NODE_OPTIONS=--use-env-proxy` plus `HTTPS_PROXY`).
 * @module dsh-web-search-doko/keyless/ddgs
 */

import { isAbortError, isRateLimitish, KeylessError } from './errors.js'
import type { KeylessHit, KeylessVendor } from './types.js'

/** DuckDuckGo's server-rendered HTML results endpoint. */
export const DDGS_HTML_URL = 'https://html.duckduckgo.com/html/'

/** Browser-like UA; DDG serves a challenge page to default/empty agents. */
const DDGS_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

/** Build the DuckDuckGo keyless vendor bound to a request timeout. */
export function ddgsVendor(timeoutMs: number): KeylessVendor {
  return {
    id: 'ddgs',
    async search(query: string, limit: number, signal?: AbortSignal): Promise<readonly KeylessHit[]> {
      const url = `${DDGS_HTML_URL}?q=${encodeURIComponent(query)}`
      const timeout = AbortSignal.timeout(timeoutMs)
      const combined = signal !== undefined ? AbortSignal.any([signal, timeout]) : timeout

      let response: Response
      try {
        response = await fetch(url, {
          method: 'GET',
          headers: { accept: 'text/html', 'user-agent': DDGS_USER_AGENT },
          signal: combined,
        })
      } catch (error) {
        if (isAbortError(error)) {
          if (signal?.aborted === true) throw new KeylessError('ddgs', 'request aborted', false, error)
          throw new KeylessError('ddgs', `timed out after ${timeoutMs}ms`, false, error)
        }
        throw new KeylessError('ddgs', `request failed: ${String(error)}`, false, error)
      }

      const html = await response.text()
      if (!response.ok) {
        throw new KeylessError('ddgs', `HTTP ${response.status}`, response.status === 429 || isRateLimitish(html))
      }
      return parseDdgsResults(html, limit)
    },
  }
}

/** Anchor tag scanner shared by the title/snippet passes. */
const ANCHOR_RE = /<a\b([^>]*)>([\s\S]*?)<\/a>/g

/** Class check tolerant of extra classes and attribute ordering. */
function hasClass(attrs: string, name: string): boolean {
  const match = /class="([^"]*)"/.exec(attrs)
  return match !== null && match[1]!.split(/\s+/).includes(name)
}

/**
 * Parse a DDG HTML results page into normalized hits. Titles and snippets are
 * collected in document order and zipped; a missing snippet is simply omitted.
 *
 * @param html - the results page.
 * @param limit - max hits to return.
 */
export function parseDdgsResults(html: string, limit: number): KeylessHit[] {
  const titles: Array<{ url: string; title: string }> = []
  const snippets: string[] = []

  for (const match of html.matchAll(ANCHOR_RE)) {
    const attrs = match[1] ?? ''
    const inner = match[2] ?? ''
    if (hasClass(attrs, 'result__a')) {
      const rawHref = /href="([^"]*)"/.exec(attrs)?.[1] ?? ''
      const url = resolveDdgHref(decodeHtml(rawHref))
      const title = collapse(decodeHtml(stripTags(inner)))
      if (url.length > 0 && title.length > 0) titles.push({ url, title })
    } else if (hasClass(attrs, 'result__snippet')) {
      const snippet = collapse(decodeHtml(stripTags(inner)))
      if (snippet.length > 0) snippets.push(snippet)
    }
  }

  return titles.slice(0, limit).map((entry, index) => {
    const snippet = snippets[index]
    return {
      url: entry.url,
      title: entry.title,
      ...snippet !== undefined ? { snippet } : {},
    }
  })
}

/**
 * Resolve a DDG result href to its real target. DDG wraps results as
 * `//duckduckgo.com/l/?uddg=<encoded>`.
 *
 * @param href - the href attribute value (HTML entities already decoded).
 */
export function resolveDdgHref(href: string): string {
  let value = href.trim()
  if (value.length === 0) return ''
  if (value.startsWith('//')) value = `https:${value}`
  try {
    const parsed = new URL(value, 'https://duckduckgo.com')
    const uddg = parsed.searchParams.get('uddg')
    if (uddg !== null && uddg.length > 0) return uddg
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : ''
  } catch {
    return ''
  }
}

/** Strip HTML tags. */
function stripTags(value: string): string {
  return value.replace(/<[^>]*>/g, '')
}

/** Collapse runs of whitespace. */
function collapse(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

/** Decode the small HTML entity set DDG emits in hrefs and text. */
function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
}