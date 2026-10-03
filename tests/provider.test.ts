import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DokoSearchProvider } from '../lib/search-provider.js'
import { DokoFetchProvider, FAST_PARTIAL_CHARS } from '../lib/fetch-provider.js'
import type { DokoClient, DokoReadResult } from '../lib/client.js'
import type { DokoOptions } from '../lib/options.js'

const serp = readFileSync(new URL('./fixtures/google-rust.txt', import.meta.url), 'utf8')

const options: DokoOptions = {
  baseURL: 'http://127.0.0.1:8080',
  apiKey: '',
  engine: 'google',
  searchScreens: 1,
  readScreens: 1,
  timeoutMs: 1000,
  includeSerpText: false,
}

/** Minimal fake whose only job is to return scripted read results. */
function fakeClient(readResults: DokoReadResult[]): DokoClient {
  let i = 0
  return {
    read: async () => readResults[Math.min(i++, readResults.length - 1)],
    search: async () => readResults[0],
  } as unknown as DokoClient
}

test('search provider maps a SERP into sources and applies maxResults', async () => {
  const provider = new DokoSearchProvider(options, fakeClient([
    { url: 'https://www.google.com/search?q=x', text: serp, screens: 1, fast: false },
  ]))
  const result = await provider.search({ query: 'rust web frameworks', maxResults: 3 })
  assert.equal(result.sources.length, 3)
  assert.equal(result.truncated, true)
  assert.equal(result.content, undefined, 'text is not surfaced when sources parsed')
})

test('search provider falls back to cleaned text when no source parses', async () => {
  const provider = new DokoSearchProvider(options, fakeClient([
    { url: 'https://x', text: '# title\n> url\n\nsome prose without references', screens: 1, fast: false },
  ]))
  const result = await provider.search({ query: 'x' })
  assert.equal(result.sources.length, 0)
  assert.ok((result.content ?? '').includes('some prose'))
})

test('available() is a pure local check', () => {
  const good = new DokoSearchProvider(options, fakeClient([]))
  assert.equal(good.available(), true)
  const bad = new DokoSearchProvider({ ...options, baseURL: 'not a url' }, fakeClient([]))
  assert.equal(bad.available(), false)
})

test('fetch provider maps doko text to a fetch result', async () => {
  const provider = new DokoFetchProvider(options, fakeClient([
    { url: 'https://example.com', text: 'Example body', screens: 1, fast: false },
  ]))
  const result = await provider.fetch({ url: 'https://example.com' })
  assert.equal(result.statusCode, 200)
  assert.equal(result.body.kind, 'text')
  assert.equal(result.body.content, 'Example body')
})

test('fetch provider re-reads a short fast result with the browser', async () => {
  const short = 'x'.repeat(FAST_PARTIAL_CHARS - 1)
  const long = 'y'.repeat(FAST_PARTIAL_CHARS + 500)
  const provider = new DokoFetchProvider(options, fakeClient([
    { url: 'https://js.example', text: short, screens: 1, fast: true },
    { url: 'https://js.example', text: long, screens: 2, fast: false },
  ]))
  const result = await provider.fetch({ url: 'https://js.example' })
  assert.equal(result.body.content, long)
})

test('fetch provider keeps the first result when the retry is not better', async () => {
  const short = 'x'.repeat(FAST_PARTIAL_CHARS - 1)
  const provider = new DokoFetchProvider(options, fakeClient([
    { url: 'https://js.example', text: short, screens: 1, fast: true },
    { url: 'https://js.example', text: 'short', screens: 2, fast: false },
  ]))
  const result = await provider.fetch({ url: 'https://js.example' })
  assert.equal(result.body.content, short)
})

test('fetch provider hard-fails when doko returns no text (e.g. a PDF)', async () => {
  const provider = new DokoFetchProvider(options, fakeClient([
    { url: 'https://example.com/file.pdf', text: '', screens: 1, fast: false },
  ]))
  await assert.rejects(
    () => provider.fetch({ url: 'https://example.com/file.pdf' }),
    /no readable text/,
  )
})

test('normalizeReadResult coerces a missing text field to an empty string', async () => {
  const { normalizeReadResult } = await import('../lib/client.js')
  const result = normalizeReadResult({ url: 'https://example.com/file.pdf', screens: 1 })
  assert.equal(result.text, '')
  assert.equal(result.url, 'https://example.com/file.pdf')
})