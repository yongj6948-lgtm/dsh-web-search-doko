/**
 * doko-backed `WebFetchProvider`. Reads a URL through doko's browser extractor,
 * preferring the server's no-browser fast path and re-reading with a full
 * browser pass when a fast result looks partial (the page needed JavaScript).
 * @module dsh-web-search-doko/fetch-provider
 */

import { WebError } from '@deepseek-ai/dsh-web'
import type {
  WebFetchProvider,
  WebFetchRequest,
  WebFetchResult,
} from '@deepseek-ai/dsh-web'
import { DokoClient } from './client.js'
import { DOKO_PROVIDER_ID, type DokoOptions } from './options.js'

/**
 * A fast-path result shorter than this (non-whitespace characters) is treated
 * as partial and re-read with `screens: 2`, which forces the browser path.
 */
export const FAST_PARTIAL_CHARS = 800

/** The doko fetch provider registered under {@link DOKO_PROVIDER_ID}. */
export class DokoFetchProvider implements WebFetchProvider {
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

  async fetch(request: WebFetchRequest, signal?: AbortSignal): Promise<WebFetchResult> {
    let result = await this.client.read(request.url, this.options.readScreens, signal)

    // Fast path is only chosen for a single screen; a short result on that path
    // usually means JS-rendered content the browser would still surface. One
    // retry at two screens forces the browser and never loops (screens >= 2 is
    // not fast-eligible on the server).
    if (result.fast && meaningfulChars(result.text) < FAST_PARTIAL_CHARS && this.options.readScreens < 2) {
      const retried = await this.client.read(request.url, 2, signal)
      if (meaningfulChars(retried.text) >= meaningfulChars(result.text)) result = retried
    }

    // An empty body is a hard failure, not a valid result: doko completes the
    // read but returns no `text` for non-HTML payloads such as PDFs. Throwing
    // lets `doko-first` rescue with the keyless ring (Exa extracts PDF text),
    // and avoids leaking `undefined` content that trips INVALID_TOOL_OUTPUT.
    if (meaningfulChars(result.text) === 0) {
      throw new WebError(
        `doko returned no readable text for ${request.url}`,
        'WEB_PROVIDER_ERROR',
      )
    }

    return toFetchResult(request.url, result)
  }
}

/** Map one doko `ReadResult` to the seam's fetch result. */
function toFetchResult(requestUrl: string, result: { url: string; text: string }): WebFetchResult {
  return {
    url: result.url.length > 0 ? result.url : requestUrl,
    statusCode: 200,
    body: { kind: 'text', content: result.text ?? '' },
    truncated: false,
  }
}

/** Non-whitespace character count, for the fast-path partial heuristic. */
function meaningfulChars(text: string): number {
  return text.replace(/\s+/g, '').length
}