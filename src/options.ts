/**
 * Plugin configuration and its resolved form. The Cordis `Config` schema keeps
 * every deployment-tunable value here so `cordis.yml` can change it without a
 * code edit; `apply` folds in environment fallbacks and constants.
 * @module dsh-web-search-doko/options
 */

import type { Context } from '@deepseek-ai/cordis'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import z from '@deepseek-ai/schemastery'

/** Search engines doko-server forwards to dokobot. */
export const DOKO_ENGINES = [
  'google', 'bing', 'duckduckgo', 'baidu', 'sogou', 'yandex', 'twitter',
] as const

/** One supported engine name. */
export type DokoEngine = (typeof DOKO_ENGINES)[number]

/** Stable provider id registered with `ctx.web`. */
export const DOKO_PROVIDER_ID = 'doko'

/** Default doko-server endpoint (same host as the harness unless configured). */
export const DOKO_DEFAULT_BASE_URL = 'http://127.0.0.1:8080'

/** Default engine. */
export const DOKO_DEFAULT_ENGINE: DokoEngine = 'google'

/** Default per-request timeout in milliseconds. */
export const DOKO_DEFAULT_TIMEOUT_MS = 90_000

/** Default screens captured for a plain read (fast path first; 1 = fast-eligible). */
export const DOKO_DEFAULT_READ_SCREENS = 1

/** Plugin config; every field optional, `apply` supplies env/constant defaults. */
export interface Config {
  /** doko-server base URL. Falls back to `$DOKO_SERVER_URL`. */
  baseURL?: string
  /** API key header when the server enables auth. Falls back to `$DOKO_API_KEY`. */
  apiKey?: string
  /** Default search engine. Defaults to `google`. */
  engine?: DokoEngine
  /** Screens captured for search. Defaults to `1`. */
  screens?: number
  /** Screens captured for read. Defaults to `1` (fast path first). */
  readScreens?: number
  /** Per-request timeout in milliseconds. Defaults to `90000`. */
  timeoutMs?: number
  /** Google `tbs` time-range parameter, e.g. `qdr:y`. */
  tbs?: string
  /**
   * Also return the cleaned SERP text as `content` even when structured sources
   * were recovered. Defaults to `false` (text is used only as a fallback when
   * parsing finds no sources).
   */
  includeSerpText?: boolean
}

/** Schemastery schema validating {@link Config} in `cordis.yml`. */
export const Config: z<Config> = z.object({
  baseURL: z.string(),
  apiKey: z.string(),
  engine: z.union(DOKO_ENGINES),
  screens: z.number().step(1).min(1),
  readScreens: z.number().step(1).min(1),
  timeoutMs: z.number().step(1).min(1),
  tbs: z.string(),
  includeSerpText: z.boolean(),
})

/** Fully resolved provider options (no optional tuning fields). */
export interface DokoOptions {
  readonly baseURL: string
  readonly apiKey: string
  readonly engine: DokoEngine
  readonly searchScreens: number
  readonly readScreens: number
  readonly timeoutMs: number
  readonly tbs?: string
  readonly includeSerpText: boolean
}

/**
 * Resolve plugin config against launch environment and constants.
 *
 * @param ctx - the consuming context, for the launch-environment snapshot.
 * @param config - validated plugin config.
 * @returns fully populated provider options.
 */
export function resolveOptions(ctx: Context, config: Config): DokoOptions {
  const env = launchEnvironmentOf(ctx)
  const baseURL = config.baseURL
    ?? env.get('DOKO_SERVER_URL')?.value
    ?? DOKO_DEFAULT_BASE_URL
  const apiKey = config.apiKey
    ?? env.get('DOKO_API_KEY')?.value
    ?? ''
  return {
    baseURL: baseURL.replace(/\/+$/, ''),
    apiKey,
    engine: config.engine ?? DOKO_DEFAULT_ENGINE,
    searchScreens: config.screens ?? 1,
    readScreens: config.readScreens ?? DOKO_DEFAULT_READ_SCREENS,
    timeoutMs: config.timeoutMs ?? DOKO_DEFAULT_TIMEOUT_MS,
    ...config.tbs !== undefined && config.tbs.length > 0 ? { tbs: config.tbs } : {},
    includeSerpText: config.includeSerpText ?? false,
  }
}