/**
 * doko web-access plugin for DeepSeek Harness. Registers a search provider and
 * a fetch provider on the `ctx.web` capability seam, both backed by a local
 * doko-server (Chrome + Dokobot). Set `searchProvider: doko` /
 * `fetchProvider: doko` on the `dsh-web` row to select them.
 * @module dsh-web-search-doko
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-web'
import { Config, resolveOptions, type Config as DokoConfig } from './options.js'
import { DokoSearchProvider } from './search-provider.js'
import { DokoFetchProvider } from './fetch-provider.js'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-search-doko'

/** The web capability seam these providers register into. */
export const inject = ['web']

export { Config }
export type { DokoConfig }

/** Register the doko search and fetch providers with `ctx.web`. */
export function apply(ctx: Context, config: DokoConfig): void {
  const options = resolveOptions(ctx, config)
  ctx.web.registerSearchProvider(new DokoSearchProvider(options))
  ctx.web.registerFetchProvider(new DokoFetchProvider(options))
}