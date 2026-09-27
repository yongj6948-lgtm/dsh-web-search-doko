/**
 * Best-effort conversion of doko's rendered SERP text into the web seam's
 * structured `WebSearchSource[]`. doko offers no structured output, so this
 * parser:
 *
 * 1. collects the trailing `[N] url` reference list into a number → URL map;
 * 2. splits the body on `---` separators into result blocks;
 * 3. resolves each block's smallest non-search-engine reference to a real URL;
 * 4. treats a reference-less block as a snippet for the preceding result.
 *
 * It is deliberately forgiving: a block it cannot resolve is skipped, never an
 * error, and `cleanSerpText` always yields usable text for the `content` field.
 * @module dsh-web-search-doko/parse
 */

import type { WebSearchSource } from '@deepseek-ai/dsh-web'

/** Parsed SERP: cleaned text plus whatever structured sources were recovered. */
export interface ParsedSerp {
  /** Cleaned, human-readable SERP text (used as `WebSearchResult.content`). */
  readonly content: string
  /** Recovered citeable sources, de-duplicated by fragment-stripped URL. */
  readonly sources: WebSearchSource[]
}

/** Navigation noise not worth feeding the model. */
const NOISE = new Set([
  '登录', '全部', '图片', '视频', '购物', '新闻', '短视频', '更多', '工具', '搜索', 'AI 模式',
  '设置', '反馈', '显示', '隐藏', '展开', '收起', '复制', '链接', '帖子',
  'Images', 'Videos', 'News', 'Shopping', 'Maps', 'More', 'Tools', 'Web', 'Flights',
  'Settings', 'Feedback', 'AI Mode', 'All', 'Forums', 'Short videos', 'Next', 'Previous',
])

/** One trailing reference line: `[8] https://…`. */
const REF_LINE = /^\[(\d+)\]\s+(https?:\/\/\S+)\s*$/

/** A `---` block separator (ASCII or em dash). */
const SEPARATOR = /^(?:-{3,}|—+)$/

/** A line that is only reference markers, e.g. `[8]` or `[8][9]`. */
const ONLY_REFS = /^(?:\[\d+\]\s*)+$/

/** A breadcrumb line, e.g. `github.com › user › repo` or `A » B`. */
const BREADCRUMB = /[›»]/

/** Relative-time / engagement metadata, e.g. `7 months ago`, `20+ comments`. */
const META = /^(?:\d+\+?\s*(?:comments?|results?|votes?|reactions?)|(?:\d+\s+)?(?:second|minute|hour|day|month|year)s?\s+ago|(?:\d+\s+)?(?:秒|分钟|小时|天|个月|年)前).*$/i

/**
 * Parse doko SERP text into cleaned content and best-effort sources.
 *
 * @param raw - the `text` field of a doko `Search` result.
 * @returns cleaned text and recovered sources.
 */
export function parseSerp(raw: string): ParsedSerp {
  const lines = raw.replace(/\r\n?/g, '\n').split('\n')

  const refs = new Map<number, string>()
  const bodyLines: string[] = []
  for (const line of lines) {
    const match = REF_LINE.exec(line.trim())
    if (match !== null) {
      const n = Number(match[1])
      if (!refs.has(n)) refs.set(n, match[2])
      continue
    }
    bodyLines.push(line)
  }

  return {
    content: cleanSerpText(bodyLines),
    sources: parseSources(bodyLines, refs),
  }
}

/**
 * Clean SERP body lines into model-facing text: drop the search-engine header
 * and URL, navigation noise, bare separators, and reference-only lines.
 *
 * @param bodyLines - lines with the trailing reference list already removed.
 * @returns the cleaned text.
 */
export function cleanSerpText(bodyLines: readonly string[]): string {
  const out: string[] = []
  for (const line of bodyLines) {
    const text = line.trim().replace(/^>\s*/, '').replace(/^#{1,6}\s*/, '').replace(/\s*\[\d+\]/g, '').trim()
    if (text.length === 0) continue
    if (SEPARATOR.test(text) || ONLY_REFS.test(text)) continue
    // Drop the "<query> - Google Search" header and its URL line.
    if (/-\s*Google Search$/i.test(text)) continue
    if (/^https?:\/\/\S+$/.test(text) && /google\.[a-z.]+\/search/i.test(text)) continue
    if (NOISE.has(text) || NOISE.has(text.replace(/\s*\[\d+\]\s*$/, ''))) continue
    if (/^\d+\s+Page\b/i.test(text) || /^Page\s+\d+$/i.test(text)) continue
    if (/无障碍|跳到主要|跳过|skip (to )?main|main content|accessibility/i.test(text)) continue
    out.push(text)
  }
  return out.join('\n').replace(/\n{2,}/g, '\n').trim()
}

/**
 * Recover structured sources from SERP body lines and the reference map.
 *
 * @param bodyLines - lines without the trailing reference list.
 * @param refs - reference number → URL.
 * @returns de-duplicated sources in first-seen order.
 */
export function parseSources(bodyLines: readonly string[], refs: ReadonlyMap<number, string>): WebSearchSource[] {
  const blocks: string[][] = []
  let current: string[] = []
  for (const line of bodyLines) {
    if (SEPARATOR.test(line.trim())) {
      blocks.push(current)
      current = []
      continue
    }
    current.push(line)
  }
  blocks.push(current)

  const sources: WebSearchSource[] = []
  const byUrl = new Map<string, number>()
  let lastIndex = -1

  for (const block of blocks) {
    const refNumbers = collectRefs(block)
    const url = resolveBlockUrl(refNumbers, refs)
    const textLines = block
      .map(line => line.trim().replace(/\[\d+\]/g, '').replace(/^>\s*/, '').replace(/^#{1,6}\s*/, '').trim())
      .filter(line => line.length > 0
        && !ONLY_REFS.test(line)
        && !NOISE.has(line)
        && !/^\d+\s+Page\b/i.test(line)
        && !/^Page\s+\d+$/i.test(line))

    if (url === undefined) {
      // A reference-less block extends the previous source's snippet.
      const text = textLines.join(' ').trim()
      if (text.length > 0) appendSnippet(sources[lastIndex], text)
      continue
    }

    const key = stripFragment(url)
    const existing = byUrl.get(key)
    if (existing !== undefined) {
      const source = sources[existing]
      const title = pickTitle(textLines)
      if (title !== undefined && (source.title === undefined || title.length > source.title.length)) {
        sources[existing] = { ...source, title }
      }
      continue
    }

    const title = pickTitle(textLines)
    const snippet = pickSnippet(textLines, title)
    const source: WebSearchSource = {
      url: key,
      ...title !== undefined ? { title } : {},
      ...snippet !== undefined ? { snippet } : {},
    }
    byUrl.set(key, sources.length)
    lastIndex = sources.length
    sources.push(source)
  }

  // Drop the trailing "no source yet" sentinel the snippet-attach branch may use.
  return sources.filter(source => source.url.length > 0)
}

/** Collect the reference numbers a block mentions. */
function collectRefs(block: readonly string[]): number[] {
  const found: number[] = []
  for (const line of block) {
    for (const match of line.matchAll(/\[(\d+)\]/g)) found.push(Number(match[1]))
  }
  return found
}

/**
 * Resolve a block's URL: its smallest reference that maps to a non-search-engine
 * URL (search-engine refs are navigation/pagination noise).
 */
function resolveBlockUrl(refNumbers: readonly number[], refs: ReadonlyMap<number, string>): string | undefined {
  const candidates = refNumbers
    .map(n => refs.get(n))
    .filter((url): url is string => url !== undefined && !isSearchEngineUrl(url))
  if (candidates.length === 0) return undefined
  // The smallest reference number is the primary result link; anchors are
  // numbered later.
  return candidates[0]
}

/** True for Google/Bing/etc. navigation and pagination URLs. */
export function isSearchEngineUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname
    return /(^|\.)google\.[a-z.]+$/i.test(host)
      || /(^|\.)bing\.com$/i.test(host)
      || /(^|\.)duckduckgo\.com$/i.test(host)
      || /(^|\.)baidu\.com$/i.test(host)
      || /(^|\.)sogou\.com$/i.test(host)
      || /(^|\.)yandex\.[a-z.]+$/i.test(host)
  } catch {
    return false
  }
}

/** Remove a URL fragment (anchor) — result links rarely need it. */
export function stripFragment(url: string): string {
  const hash = url.indexOf('#')
  return hash === -1 ? url : url.slice(0, hash)
}

/**
 * Choose a display title from a block: the last meaningful, non-breadcrumb,
 * non-metadata line (SERP lists the site name/breadcrumb before the title).
 */
function pickTitle(lines: readonly string[]): string | undefined {
  const candidates = lines.filter(line =>
    !BREADCRUMB.test(line)
    && !META.test(line)
    && !/^https?:\/\//.test(line)
    && line.length > 1)
  if (candidates.length === 0) return undefined
  return candidates[candidates.length - 1]
}

/**
 * Take the lines after the chosen title as a snippet; SERP descriptions follow
 * their title, while a site-name line before it is not a description.
 */
function pickSnippet(lines: readonly string[], title: string | undefined): string | undefined {
  if (title === undefined) return undefined
  const index = lines.lastIndexOf(title)
  if (index === -1) return undefined
  const rest = lines.slice(index + 1).filter(line =>
    !BREADCRUMB.test(line)
    && !META.test(line)
    && !/^https?:\/\//.test(line))
  const snippet = rest.join(' ').trim()
  return snippet.length > 0 ? snippet : undefined
}

/** Append text to a source's snippet, if the source exists. */
function appendSnippet(source: WebSearchSource | undefined, text: string): void {
  if (source === undefined) return
  const merged = source.snippet === undefined ? text : `${source.snippet} ${text}`
  // WebSearchSource is readonly; mutate the array slot instead.
  Object.assign(source, { snippet: merged })
}

