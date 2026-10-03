/**
 * Live smoke test for the keyless `free` ring (Exa / Keenable / Parallel public
 * endpoints). No API key, no local server needed — just outbound HTTPS.
 *
 *   node scripts/live-smoke-free.mjs [query] [vendors]
 *
 * `vendors` is a comma-separated ring, e.g. `ddgs` or `exa,keenable`. DDGS needs
 * a reachable DuckDuckGo; behind a blocked network run with
 * `NODE_OPTIONS=--use-env-proxy` and `HTTPS_PROXY` set.
 */
import { FreeSearchProvider, FreeFetchProvider } from '../lib/free-provider.js'
import { resolveFreeOptions } from '../lib/options.js'

const query = process.argv[2] ?? 'rust web frameworks'
const vendorArg = process.argv[3]
const options = resolveFreeOptions(vendorArg !== undefined ? { freeVendors: vendorArg.split(',').filter(Boolean) } : {})
console.log(`ring: ${options.vendors.join(' -> ')} (timeout ${options.timeoutMs}ms)`)

const search = new FreeSearchProvider(options)
console.log(`search.available(): ${search.available()}`)
const result = await search.search({ query, maxResults: 5 })
console.log(`\n=== web_search via free ring (${result.sources.length} sources, truncated=${result.truncated}) ===`)
for (const s of result.sources) {
  console.log(`- ${s.title ?? '(no title)'}`)
  console.log(`  ${s.url}`)
  if (s.snippet) console.log(`  ${s.snippet.slice(0, 160)}`)
}

const fetchProvider = new FreeFetchProvider(options)
if (!fetchProvider.available()) {
  console.log('\n(fetch ring empty — search-only vendors selected)')
  process.exit(0)
}
const page = await fetchProvider.fetch({ url: 'https://example.com' })
console.log(`\n=== web_fetch via free ring ===`)
console.log(`url=${page.url} status=${page.statusCode} kind=${page.body.kind} chars=${page.body.content.length}`)
console.log(page.body.content.slice(0, 300))