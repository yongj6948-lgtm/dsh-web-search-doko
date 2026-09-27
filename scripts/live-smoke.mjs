/**
 * Live smoke test against a running doko-server. Not part of the test suite:
 * it needs Chrome + Dokobot on the server host and a reachable HTTP endpoint.
 *
 *   node scripts/live-smoke.mjs [baseURL]
 */
import { DokoClient } from '../lib/client.js'
import { DokoSearchProvider } from '../lib/search-provider.js'
import { DokoFetchProvider } from '../lib/fetch-provider.js'

const baseURL = process.argv[2] ?? 'http://127.0.0.1:8080'
const options = {
  baseURL,
  apiKey: '',
  engine: 'google',
  searchScreens: 1,
  readScreens: 1,
  timeoutMs: 120_000,
  includeSerpText: false,
}

const client = new DokoClient(options)
console.log(`health: ${JSON.stringify(await client.health())}`)

const search = new DokoSearchProvider(options, client)
console.log(`search.available(): ${search.available()}`)
const result = await search.search({ query: 'rust web frameworks', maxResults: 8 })
console.log(`\n=== web_search via doko (${result.sources.length} sources, truncated=${result.truncated}) ===`)
for (const s of result.sources) {
  console.log(`- ${s.title ?? '(no title)'}`)
  console.log(`  ${s.url}`)
  if (s.snippet) console.log(`  ${s.snippet.slice(0, 160)}`)
}
if (result.content) console.log(`\n[content fallback ${result.content.length} chars]\n${result.content.slice(0, 400)}`)

const fetchProvider = new DokoFetchProvider(options, client)
const page = await fetchProvider.fetch({ url: 'https://example.com' })
console.log(`\n=== web_fetch via doko ===`)
console.log(`url=${page.url} status=${page.statusCode} kind=${page.body.kind} chars=${page.body.content.length}`)
console.log(page.body.content.slice(0, 300))