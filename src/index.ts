/**
 * doko web-access plugin for DeepSeek Harness. Registers web search/fetch
 * providers on the `ctx.web` capability seam:
 *
 * - `doko`      — local doko-server (Chrome + Dokobot), the primary backend
 * - `free`      — keyless public ring (Exa/Keenable/Parallel/…), no server needed
 * - `doko-first`— doko primary with a one-shot `free` rescue on hard failure
 *
 * Select one via the `web` row's `searchProvider` / `fetchProvider`.
 * @module dsh-web-search-doko
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-web'
import { Config, resolveOptions, resolveFreeOptions, type Config as DokoConfig } from './options.js'
import { DokoSearchProvider } from './search-provider.js'
import { DokoFetchProvider } from './fetch-provider.js'
import { FreeSearchProvider, FreeFetchProvider } from './free-provider.js'
import {
  DokoFirstFetchProvider,
  DokoFirstSearchProvider,
  type RescueHooks,
} from './rescue-provider.js'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-search-doko'

/** The web capability seam these providers register into. */
export const inject = ['web']

export { Config }
export type { DokoConfig }

/** Register the doko, keyless-free, and doko→free rescue providers with `ctx.web`. */
export function apply(ctx: Context, config: DokoConfig): void {
  const options = resolveOptions(ctx, config)
  const dokoSearch = new DokoSearchProvider(options)
  const dokoFetch = new DokoFetchProvider(options)
  ctx.web.registerSearchProvider(dokoSearch)
  ctx.web.registerFetchProvider(dokoFetch)

  const free = resolveFreeOptions(config)

  // The keyless ring is only registered when vendors remain enabled. `doko-first`
  // is registered unconditionally: with an empty ring it degrades to doko alone,
  // so `freeVendors: []` disables the ring without leaving a `doko-first` gap
  // that the bundle patch would otherwise select.
  let freeSearch: FreeSearchProvider | undefined
  let freeFetch: FreeFetchProvider | undefined
  if (free.vendors.length > 0) {
    freeSearch = new FreeSearchProvider(free)
    freeFetch = new FreeFetchProvider(free)
    ctx.web.registerSearchProvider(freeSearch)
    ctx.web.registerFetchProvider(freeFetch)
  }

  const hooks: RescueHooks = {
    onRescue: (event) => {
      ctx.logger?.warn?.(
        `web: ${event.primary} ${event.kind} failed, rescued by ${event.rescue}: `
        + (event.error instanceof Error ? event.error.message : String(event.error)),
      )
    },
  }
  ctx.web.registerSearchProvider(new DokoFirstSearchProvider(dokoSearch, freeSearch, hooks))
  ctx.web.registerFetchProvider(new DokoFirstFetchProvider(dokoFetch, freeFetch, hooks))
}