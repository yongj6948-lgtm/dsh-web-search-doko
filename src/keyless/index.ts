/**
 * Vendor registry for the keyless ring. Kept separate from the provider so the
 * ring order is pure configuration and tests can inject fake vendors.
 * @module dsh-web-search-doko/keyless/index
 */

import { exaVendor } from './exa.js'
import { ddgsVendor } from './ddgs.js'
import { keenableVendor } from './keenable.js'
import { parallelVendor } from './parallel.js'
import type { KeylessVendor } from './types.js'
import { FREE_VENDORS, type FreeVendor, type FreeOptions } from '../options.js'

export type { KeylessHit, KeylessPage, KeylessVendor } from './types.js'
export { KeylessError, isRateLimitish } from './errors.js'

/** One factory per known vendor, bound to a request timeout. */
const FACTORIES: Record<FreeVendor, (timeoutMs: number) => KeylessVendor> = {
  exa: exaVendor,
  keenable: keenableVendor,
  parallel: parallelVendor,
  ddgs: ddgsVendor,
}

/** True when a string names a supported keyless vendor. */
export function isFreeVendor(value: string): value is FreeVendor {
  return (FREE_VENDORS as readonly string[]).includes(value)
}

/** Instantiate the configured vendor ring in order. */
export function buildVendors(options: FreeOptions): KeylessVendor[] {
  return options.vendors.map((vendor) => FACTORIES[vendor](options.timeoutMs))
}