/**
 * Minimal Connect-JSON client for doko-server. Talks the same HTTP/1.1 JSON
 * encoding `curl` uses against `/doko.v1.SearchService/<Method>`, so the plugin
 * needs no protobuf runtime and no local `dokobot`.
 * @module dsh-web-search-doko/client
 */

import { WebError } from '@deepseek-ai/dsh-web'
import type { DokoOptions } from './options.js'

/** One normalized doko `ReadResult` (search and read share the shape). */
export interface DokoReadResult {
  /** The final URL (for search: the search-engine URL). */
  readonly url: string
  /** Extracted page text. */
  readonly text: string
  /** Screens captured. */
  readonly screens: number
  /** True when the server answered from its no-browser fast path. */
  readonly fast: boolean
  /** Continue handle, when the browser session is resumable. */
  readonly sessionId?: string
}

/** Per-call overrides a provider passes through. */
export interface DokoCallOptions {
  readonly engine?: string
  readonly screens?: number
  readonly tbs?: string
}

/** Connect error envelope (`google.rpc.Status`-like JSON). */
interface ConnectErrorBody {
  readonly code?: string
  readonly message?: string
}

/**
 * HTTP client for one doko-server. Stateless; safe to share across calls.
 */
export class DokoClient {
  private readonly options: DokoOptions
  private readonly fetchImpl: typeof fetch

  constructor(options: DokoOptions, fetchImpl: typeof fetch = fetch) {
    this.options = options
    this.fetchImpl = fetchImpl
  }

  /** Run one search through doko's browser-backed SERP reader. */
  async search(query: string, call: DokoCallOptions = {}, signal?: AbortSignal): Promise<DokoReadResult> {
    const raw = await this.call<Record<string, unknown>>('Search', {
      query,
      engine: call.engine ?? this.options.engine,
      ...call.screens !== undefined ? { screens: call.screens } : {},
      ...call.tbs ?? this.options.tbs !== undefined
        ? { tbs: call.tbs ?? this.options.tbs }
        : {},
    }, signal)
    return normalizeReadResult(raw)
  }

  /** Read one URL through doko's browser-backed extractor. */
  async read(url: string, screens: number, signal?: AbortSignal): Promise<DokoReadResult> {
    const raw = await this.call<Record<string, unknown>>('Read', { url, screens }, signal)
    return normalizeReadResult(raw)
  }

  /** Probe server health (used by the smoke script, not by providers). */
  async health(signal?: AbortSignal): Promise<{ status: string; dokobotVersion?: string }> {
    return this.call('Health', {}, signal)
  }

  private async call<T>(method: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
    const timeout = AbortSignal.timeout(this.options.timeoutMs)
    const combined = signal !== undefined ? AbortSignal.any([signal, timeout]) : timeout
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'accept': 'application/json',
    }
    if (this.options.apiKey.length > 0) headers['x-api-key'] = this.options.apiKey

    let response: Response
    try {
      response = await this.fetchImpl(`${this.options.baseURL}/doko.v1.SearchService/${method}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        ...combined !== undefined ? { signal: combined } : {},
      })
    } catch (error: unknown) {
      if (isAbortError(error)) {
        if (signal?.aborted === true) throw new WebError('doko request aborted', 'WEB_ABORTED', { cause: error })
        throw new WebError(`doko ${method} timed out after ${this.options.timeoutMs}ms`, 'WEB_PROVIDER_ERROR', { cause: error })
      }
      throw new WebError(`doko ${method} request failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }

    if (!response.ok) {
      let detail = `HTTP ${response.status}`
      try {
        const parsed = await response.json() as ConnectErrorBody
        if (parsed.message !== undefined && parsed.message.length > 0) detail = parsed.message
      } catch {
        // A non-JSON error body only costs a richer message.
      }
      throw new WebError(`doko ${method} failed: ${detail}`, 'WEB_PROVIDER_ERROR')
    }

    try {
      return await response.json() as T
    } catch (error: unknown) {
      if (isAbortError(error)) {
        if (signal?.aborted === true) throw new WebError('doko request aborted', 'WEB_ABORTED', { cause: error })
        throw new WebError(`doko ${method} timed out while reading the response`, 'WEB_PROVIDER_ERROR', { cause: error })
      }
      throw new WebError(`doko ${method} returned an unprocessable body: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }
  }
}

/**
 * Normalize one raw Connect-JSON `ReadResult` (camelCase or snake_case, since
 * proto3 JSON emits camelCase but legacy REST echoed snake_case) into the
 * client's canonical shape.
 *
 * Every field is coerced to its declared type here, so callers never receive
 * `undefined` where the seam expects a string. This matters for non-HTML URLs
 * (e.g. a PDF): doko completes the read but omits `text`, and leaking
 * `undefined` into a tool result fails DSH's lossless-JSON check
 * (`INVALID_TOOL_OUTPUT`).
 *
 * @param raw - the decoded response object.
 * @returns the normalized read result.
 */
export function normalizeReadResult(raw: Record<string, unknown> | null | undefined): DokoReadResult {
  if (raw === null || raw === undefined) {
    return { url: '', text: '', screens: 0, fast: false }
  }
  const sessionId = asString(raw['sessionId'] ?? raw['session_id'])
  return {
    url: asString(raw['url']) ?? '',
    text: asString(raw['text']) ?? '',
    screens: typeof raw['screens'] === 'number' ? raw['screens'] : 0,
    fast: raw['fast'] === true,
    ...sessionId !== undefined ? { sessionId } : {},
  }
}

/** Return a string field, or `undefined` when absent/not a string. */
function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/** True for a fetch or `AbortSignal` abort. */
function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}