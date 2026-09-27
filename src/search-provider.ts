/**
 * doko-backed `WebSearchProvider`. Runs doko's browser SERP reader and maps the
 * rendered result into the seam's normalized search shape. doko has no
 * structured output, so `sources` come from {@link parseSerp}; the cleaned page
 * text is supplied as `content` when parsing finds nothing (or when configured).
 * @module dsh-web-search-doko/search-provider
 */

import type {
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
} from '@deepseek-ai/dsh-web'
import { DokoClient } from './client.js'
import { DOKO_PROVIDER_ID, type DokoOptions } from './options.js'
import { parseSerp } from './parse.js'

/** The doko search provider registered under {@link DOKO_PROVIDER_ID}. */
export class DokoSearchProvider implements WebSearchProvider {
  readonly id = DOKO_PROVIDER_ID

  private readonly options: DokoOptions
  private readonly client: DokoClient

  constructor(options: DokoOptions, client?: DokoClient) {
    this.options = options
    this.client = client ?? new DokoClient(options)
  }

  /** Usable when the configured server URL parses; no network call. */
  available(): boolean {
    return this.options.baseURL.length > 0 && URL.canParse(this.options.baseURL)
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const result = await this.client.search(
      request.query,
      { screens: this.options.searchScreens },
      signal,
    )

    const { content, sources } = parseSerp(result.text)
    const max = request.maxResults
    const limited = max !== undefined ? sources.slice(0, max) : sources
    const truncated = max !== undefined && sources.length > limited.length
    const useText = this.options.includeSerpText || limited.length === 0

    return {
      ...useText && content.length > 0 ? { content } : {},
      sources: limited,
      truncated,
    }
  }
}