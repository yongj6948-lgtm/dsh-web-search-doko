/**
 * `free` provider ring — keyless web search and fetch over vendors that need no
 * API key. Borrowed from Hermes Agent's free-tier rotation: try vendors in order,
 * advancing past throttled ones, and surface a single normalized result. The ring
 * is last-resort by design (rate-limited, no SLA); configure it explicitly with
 * `searchProvider: free` / `fetchProvider: free`.
 * @module dsh-web-search-doko/free-provider
 */

import { WebError } from '@deepseek-ai/dsh-web'
import type {
  WebFetchProvider,
  WebFetchRequest,
  WebFetchResult,
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
  WebSearchSource,
} from '@deepseek-ai/dsh-web'
import { buildVendors, type KeylessHit, type KeylessPage, type KeylessVendor } from './keyless/index.js'
import { FREE_PROVIDER_ID, type FreeOptions } from './options.js'

/** Default number of results requested from a vendor when the caller omits `maxResults`. */
export const FREE_DEFAULT_LIMIT = 5

/** Keyless-backed `WebSearchProvider` that fails over across the configured ring. */
export class FreeSearchProvider implements WebSearchProvider {
  readonly id = FREE_PROVIDER_ID

  private readonly vendors: readonly KeylessVendor[]

  constructor(options: FreeOptions, vendors?: readonly KeylessVendor[]) {
    this.vendors = vendors ?? buildVendors(options)
  }

  /** Usable when at least one vendor is configured; no network call. */
  available(): boolean {
    return this.vendors.length > 0
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const hits = await tryVendors('search', this.vendors, signal, (vendor) =>
      vendor.search(request.query, request.maxResults ?? FREE_DEFAULT_LIMIT, signal))
    const max = request.maxResults
    const limited = max !== undefined ? hits.slice(0, max) : hits
    return {
      sources: limited.map(toSource),
      truncated: max !== undefined && hits.length > limited.length,
    }
  }
}

/** Keyless-backed `WebFetchProvider` that fails over across the configured ring. */
export class FreeFetchProvider implements WebFetchProvider {
  readonly id = FREE_PROVIDER_ID

  private readonly vendors: readonly FetchVendor[]

  constructor(options: FreeOptions, vendors?: readonly KeylessVendor[]) {
    // Search-only vendors (DDGS) have no fetch; drop them from the fetch ring.
    this.vendors = (vendors ?? buildVendors(options)).filter(hasFetch)
  }

  /** Usable when at least one extract-capable vendor is configured; no network call. */
  available(): boolean {
    return this.vendors.length > 0
  }

  async fetch(request: WebFetchRequest, signal?: AbortSignal): Promise<WebFetchResult> {
    const page = await tryVendors('fetch', this.vendors, signal, (vendor) => vendor.fetch(request.url, signal))
    return {
      url: page.url.length > 0 ? page.url : request.url,
      statusCode: 200,
      body: { kind: 'text', content: page.content },
      truncated: false,
    }
  }
}

/**
 * Call vendors in ring order until one succeeds, collecting failures. The last
 * error is thrown as a {@link WebError} when every vendor fails. Empty vendor
 * lists are a configuration error, not a silent success.
 */
async function tryVendors<V extends KeylessVendor, T>(
  kind: 'search' | 'fetch',
  vendors: readonly V[],
  signal: AbortSignal | undefined,
  call: (vendor: V) => Promise<T>,
): Promise<T> {
  const failures: string[] = []
  for (const vendor of vendors) {
    try {
      return await call(vendor)
    } catch (error) {
      // Caller cancellation is not a vendor failure: stop the ring and report it.
      if (signal?.aborted === true) {
        throw new WebError('free provider request aborted', 'WEB_ABORTED', { cause: error })
      }
      failures.push(`${vendor.id}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (failures.length === 0) {
    throw new WebError(`free ${kind} provider has no vendors configured`, 'WEB_PROVIDER_UNAVAILABLE')
  }
  throw new WebError(`all free ${kind} vendors failed (${failures.join('; ')})`, 'WEB_PROVIDER_ERROR')
}

/** Map one normalized vendor hit onto the seam's source shape. */
function toSource(hit: KeylessHit): WebSearchSource {
  return {
    url: hit.url,
    ...hit.title !== undefined && hit.title.length > 0 ? { title: hit.title } : {},
    ...hit.snippet !== undefined && hit.snippet.length > 0 ? { snippet: hit.snippet } : {},
    ...hit.publishedAt !== undefined && hit.publishedAt.length > 0 ? { publishedAt: hit.publishedAt } : {},
  }
}

/** Vendor that exposes the optional `fetch` capability. */
type FetchVendor = KeylessVendor & { fetch: NonNullable<KeylessVendor['fetch']> }

/** Type guard for vendors that implement `fetch`. */
function hasFetch(vendor: KeylessVendor): vendor is FetchVendor {
  return typeof vendor.fetch === 'function'
}