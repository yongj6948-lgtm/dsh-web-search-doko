/**
 * Vendor-neutral shapes for the keyless ring. Each vendor adapter normalizes its
 * own wire format (MCP SSE text, public JSON, ...) into these so the provider
 * layer never learns about Exa/Parallel/Keenable specifics.
 * @module dsh-web-search-doko/keyless/types
 */

/** One normalized keyless search hit. */
export interface KeylessHit {
  readonly url: string
  readonly title?: string
  readonly snippet?: string
  readonly publishedAt?: string
}

/** One normalized keyless page extraction. */
export interface KeylessPage {
  readonly url: string
  readonly title?: string
  readonly content: string
}

/** One anonymous free-tier backend the ring can call. */
export interface KeylessVendor {
  readonly id: string
  /** Search the vendor's index. Throws {@link KeylessError} on failure. */
  search(query: string, limit: number, signal?: AbortSignal): Promise<readonly KeylessHit[]>
  /**
   * Extract one URL, when the vendor supports it. Search-only vendors (e.g.
   * DuckDuckGo) omit this; the fetch ring skips them.
   */
  fetch?(url: string, signal?: AbortSignal): Promise<KeylessPage>
}