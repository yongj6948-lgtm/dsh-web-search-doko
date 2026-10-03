/**
 * `doko-first` composite providers: doko is the primary, and the keyless `free`
 * ring is a **one-shot rescue** used only when doko hard-fails (unreachable,
 * timeout, provider error). The rescue is never sticky — the next call starts at
 * doko again — and caller cancellation is never treated as a failure.
 *
 * This mirrors Hermes Agent's "one-shot keyless rescue" semantics: the configured
 * backend always wins, and the anonymous tier exists purely as a safety net. The
 * DSH web seam selects exactly one provider by id, so the chain lives inside one
 * provider rather than in a hidden priority list.
 * @module dsh-web-search-doko/rescue-provider
 */

import { WebError } from '@deepseek-ai/dsh-web'
import type {
  WebFetchProvider,
  WebFetchRequest,
  WebFetchResult,
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
} from '@deepseek-ai/dsh-web'

/** Stable provider id registered with `ctx.web` for the doko→free rescue chain. */
export const DOKO_FIRST_PROVIDER_ID = 'doko-first'

/** Emitted when the primary provider fails and the rescue is invoked. */
export interface RescueEvent {
  readonly kind: 'search' | 'fetch'
  /** The primary provider id that failed. */
  readonly primary: string
  /** The rescue provider id being tried. */
  readonly rescue: string
  /** The primary failure (or a marker when the primary was unavailable). */
  readonly error: unknown
}

/** Observability hook; the plugin wires this to `ctx.logger`. */
export interface RescueHooks {
  readonly onRescue?: (event: RescueEvent) => void
}

/** Minimal provider surface the rescue logic needs. */
interface Providerish {
  readonly id: string
  available(): boolean
}

/** doko-primary search provider with a one-shot keyless rescue. */
export class DokoFirstSearchProvider implements WebSearchProvider {
  readonly id = DOKO_FIRST_PROVIDER_ID

  private readonly primary: WebSearchProvider
  private readonly rescue: WebSearchProvider | undefined
  private readonly hooks: RescueHooks

  constructor(primary: WebSearchProvider, rescue?: WebSearchProvider, hooks: RescueHooks = {}) {
    this.primary = primary
    this.rescue = rescue
    this.hooks = hooks
  }

  /** Usable when either leg is usable; no network call. */
  available(): boolean {
    return this.primary.available() || this.rescue?.available() === true
  }

  search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    return withRescue('search', this.primary, this.rescue, signal, this.hooks,
      (provider) => provider.search(request, signal))
  }
}

/** doko-primary fetch provider with a one-shot keyless rescue. */
export class DokoFirstFetchProvider implements WebFetchProvider {
  readonly id = DOKO_FIRST_PROVIDER_ID

  private readonly primary: WebFetchProvider
  private readonly rescue: WebFetchProvider | undefined
  private readonly hooks: RescueHooks

  constructor(primary: WebFetchProvider, rescue?: WebFetchProvider, hooks: RescueHooks = {}) {
    this.primary = primary
    this.rescue = rescue
    this.hooks = hooks
  }

  /** Usable when either leg is usable; no network call. */
  available(): boolean {
    return this.primary.available() || this.rescue?.available() === true
  }

  fetch(request: WebFetchRequest, signal?: AbortSignal): Promise<WebFetchResult> {
    return withRescue('fetch', this.primary, this.rescue, signal, this.hooks,
      (provider) => provider.fetch(request, signal))
  }
}

/**
 * Run the primary; on a hard failure invoke the rescue once. Returns the rescue
 * result if it succeeds, otherwise a combined {@link WebError}. Cancellation and
 * rescue unavailability never trigger a rescue.
 */
async function withRescue<P extends Providerish, T>(
  kind: 'search' | 'fetch',
  primary: P,
  rescue: P | undefined,
  signal: AbortSignal | undefined,
  hooks: RescueHooks,
  run: (provider: P) => Promise<T>,
): Promise<T> {
  // No rescue leg configured: the chain degrades to the primary alone.
  if (rescue === undefined) return run(primary)

  // A missing primary (e.g. doko not configured) is itself a hard failure.
  if (!primary.available()) {
    if (!rescue.available()) return run(primary)
    hooks.onRescue?.({ kind, primary: primary.id, rescue: rescue.id, error: new Error('primary unavailable') })
    return run(rescue)
  }

  let primaryError: unknown
  try {
    return await run(primary)
  } catch (error) {
    // Caller cancellation is intent, not a failure: never fall through.
    if (signal?.aborted === true) throw error
    primaryError = error
  }

  if (!rescue.available()) throw primaryError
  hooks.onRescue?.({ kind, primary: primary.id, rescue: rescue.id, error: primaryError })

  try {
    return await run(rescue)
  } catch (rescueError) {
    throw new WebError(
      `both ${primary.id} and ${rescue.id} ${kind} failed: ${messageOf(primaryError)}; rescue: ${messageOf(rescueError)}`,
      'WEB_PROVIDER_ERROR',
      { cause: primaryError },
    )
  }
}

/** Best-effort human-readable error text. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}