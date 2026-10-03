import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FreeSearchProvider, FreeFetchProvider } from '../lib/free-provider.js'
import { parseExaSearch, parseExaTitle } from '../lib/keyless/exa.js'
import { parseDdgsResults, resolveDdgHref } from '../lib/keyless/ddgs.js'
import { parseMcpBody } from '../lib/keyless/mcp.js'
import { KeylessError } from '../lib/keyless/errors.js'
import type { KeylessVendor, KeylessHit, KeylessPage } from '../lib/keyless/types.js'
import type { FreeOptions } from '../lib/options.js'

const options: FreeOptions = { vendors: ['exa', 'keenable', 'parallel'], timeoutMs: 1000 }

/** Fake vendor that returns scripted results or throws. */
function vendor(id: string, behavior: { hits?: KeylessHit[]; page?: KeylessPage; error?: unknown }): KeylessVendor {
  return {
    id,
    async search(): Promise<readonly KeylessHit[]> {
      if (behavior.error !== undefined) throw behavior.error
      return behavior.hits ?? []
    },
    async fetch(): Promise<KeylessPage> {
      if (behavior.error !== undefined) throw behavior.error
      return behavior.page ?? { url: '', content: '' }
    },
  }
}

test('search returns hits from the first vendor and slices to maxResults', async () => {
  const provider = new FreeSearchProvider(options, [
    vendor('exa', { hits: [
      { url: 'https://a', title: 'A', snippet: 'sa' },
      { url: 'https://b', title: 'B' },
      { url: 'https://c', title: 'C' },
    ] }),
  ])
  const result = await provider.search({ query: 'x', maxResults: 2 })
  assert.equal(result.sources.length, 2)
  assert.deepEqual(result.sources[0], { url: 'https://a', title: 'A', snippet: 'sa' })
  assert.equal(result.truncated, true)
})

test('search falls over to the next vendor on a rate limit', async () => {
  const provider = new FreeSearchProvider(options, [
    vendor('exa', { error: new KeylessError('exa', 'rate limit exceeded', true) }),
    vendor('keenable', { hits: [{ url: 'https://k', title: 'K' }] }),
  ])
  const result = await provider.search({ query: 'x' })
  assert.equal(result.sources[0]?.url, 'https://k')
})

test('search throws a WebError when every vendor fails', async () => {
  const provider = new FreeSearchProvider(options, [
    vendor('exa', { error: new KeylessError('exa', 'boom', false) }),
    vendor('keenable', { error: new KeylessError('keenable', 'bang', false) }),
  ])
  await assert.rejects(
    () => provider.search({ query: 'x' }),
    /all free search vendors failed.*exa: boom.*keenable: bang/,
  )
})

test('available() reflects the configured ring', () => {
  assert.equal(new FreeSearchProvider(options, [vendor('exa', {})]).available(), true)
  assert.equal(new FreeSearchProvider(options, []).available(), false)
})

test('caller cancellation stops the ring instead of failing over', async () => {
  const controller = new AbortController()
  controller.abort()
  const provider = new FreeSearchProvider(options, [
    vendor('exa', { error: new KeylessError('exa', 'request aborted', false) }),
    vendor('keenable', { hits: [{ url: 'https://k' }] }),
  ])
  await assert.rejects(() => provider.search({ query: 'x' }, controller.signal), /aborted/)
})

test('fetch maps a vendor page to a fetch result and fails over', async () => {
  const provider = new FreeFetchProvider(options, [
    vendor('exa', { error: new KeylessError('exa', 'throttled', true) }),
    vendor('keenable', { page: { url: 'https://example.com', title: 'Example', content: 'body' } }),
  ])
  const result = await provider.fetch({ url: 'https://example.com' })
  assert.equal(result.statusCode, 200)
  assert.equal(result.body.kind, 'text')
  assert.equal(result.body.content, 'body')
  assert.equal(result.url, 'https://example.com')
})

test('parseExaSearch parses labelled blocks into hits', () => {
  const text = [
    'Title: First',
    'URL: https://first',
    'Published: 2026-01-02',
    'Author: N/A',
    'Highlights:',
    'line one',
    'line two',
    '',
    '---',
    '',
    'Title: Second',
    'URL: https://second',
    'Published: N/A',
    'Highlights:',
    'only line',
  ].join('\n')
  const hits = parseExaSearch(text, 5)
  assert.equal(hits.length, 2)
  assert.deepEqual(hits[0], { url: 'https://first', title: 'First', snippet: 'line one line two', publishedAt: '2026-01-02' })
  assert.deepEqual(hits[1], { url: 'https://second', title: 'Second', snippet: 'only line' })
})

test('parseExaSearch honors the limit', () => {
  const block = 'Title: T\nURL: https://x\nHighlights:\n\n---\n\nTitle: T\nURL: https://y\nHighlights:\n'
  assert.equal(parseExaSearch(block, 1).length, 1)
})

test('parseExaTitle prefers the first H1', () => {
  assert.equal(parseExaTitle('# Example Domain\nURL: https://example.com\n\nbody'), 'Example Domain')
})

test('parseMcpBody accepts SSE frames and reports tool errors', () => {
  const ok = 'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"hello"}]}}'
  assert.equal(parseMcpBody('exa', ok), 'hello')
  const err = 'event: message\ndata: {"result":{"content":[{"type":"text","text":"rate limit exceeded"}],"isError":true}}'
  assert.throws(() => parseMcpBody('exa', err), /rate limit exceeded/)
})

test('fetch ring skips search-only vendors like DDGS', async () => {
  const searchOnly = { id: 'ddgs', async search() { return [] } }
  const provider = new FreeFetchProvider(options, [
    searchOnly,
    vendor('exa', { page: { url: 'https://example.com', content: 'body' } }),
  ])
  assert.equal(provider.available(), true)
  const result = await provider.fetch({ url: 'https://example.com' })
  assert.equal(result.body.content, 'body')
})

test('parseDdgsResults extracts titles, redirect targets, and snippets', () => {
  const html = [
    '<div class="result">',
    '<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa&amp;rut=abc">First &amp; Title</a>',
    '<a class="result__snippet" href="#">first snippet</a>',
    '<a class="result__a" href="https://example.com/b">Second</a>',
    '</div>',
  ].join('\n')
  const hits = parseDdgsResults(html, 5)
  assert.deepEqual(hits, [
    { url: 'https://example.com/a', title: 'First & Title', snippet: 'first snippet' },
    { url: 'https://example.com/b', title: 'Second' },
  ])
})

test('resolveDdgHref decodes the uddg redirect and keeps direct URLs', () => {
  assert.equal(resolveDdgHref('//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fx&rut=1'), 'https://example.com/x')
  assert.equal(resolveDdgHref('https://example.com/y'), 'https://example.com/y')
})