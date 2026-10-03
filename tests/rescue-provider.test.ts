import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DokoFirstSearchProvider, DokoFirstFetchProvider } from '../lib/rescue-provider.js'
import type {
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
  WebFetchProvider,
  WebFetchRequest,
  WebFetchResult,
} from '@deepseek-ai/dsh-web'
import type { RescueEvent } from '../lib/rescue-provider.js'

const request: WebSearchRequest = { query: 'x' }

/** Fake search provider with scripted success/failure/availability. */
function search(id: string, behavior: { ok?: boolean; available?: boolean } = {}): WebSearchProvider {
  return {
    id,
    available: () => behavior.available ?? true,
    async search(): Promise<WebSearchResult> {
      if ((behavior.ok ?? true) === false) throw new Error(`${id} boom`)
      return { sources: [{ url: `https://${id}` }], truncated: false }
    },
  }
}

function fetchProvider(id: string, behavior: { ok?: boolean; available?: boolean } = {}): WebFetchProvider {
  return {
    id,
    available: () => behavior.available ?? true,
    async fetch(): Promise<WebFetchResult> {
      if ((behavior.ok ?? true) === false) throw new Error(`${id} boom`)
      return { url: `https://${id}`, statusCode: 200, body: { kind: 'text', content: id }, truncated: false }
    },
  }
}

test('returns the primary result without rescuing on success', async () => {
  let rescued = false
  const provider = new DokoFirstSearchProvider(
    search('doko'),
    search('free'),
    { onRescue: () => { rescued = true } },
  )
  const result = await provider.search(request)
  assert.equal(result.sources[0]?.url, 'https://doko')
  assert.equal(rescued, false)
})

test('rescues the free ring when doko hard-fails', async () => {
  const events: RescueEvent[] = []
  const provider = new DokoFirstSearchProvider(
    search('doko', { ok: false }),
    search('free'),
    { onRescue: (event) => events.push(event) },
  )
  const result = await provider.search(request)
  assert.equal(result.sources[0]?.url, 'https://free')
  assert.equal(events.length, 1)
  assert.equal(events[0]?.kind, 'search')
  assert.equal(events[0]?.primary, 'doko')
  assert.equal(events[0]?.rescue, 'free')
})

test('goes straight to the rescue when the primary is unavailable', async () => {
  const provider = new DokoFirstSearchProvider(
    search('doko', { available: false }),
    search('free'),
  )
  const result = await provider.search(request)
  assert.equal(result.sources[0]?.url, 'https://free')
})

test('throws a combined WebError when both legs fail', async () => {
  const provider = new DokoFirstSearchProvider(search('doko', { ok: false }), search('free', { ok: false }))
  await assert.rejects(() => provider.search(request), /both doko and free search failed: doko boom; rescue: free boom/)
})

test('caller cancellation is never rescued', async () => {
  let rescued = false
  const controller = new AbortController()
  controller.abort()
  const primary: WebSearchProvider = {
    id: 'doko',
    available: () => true,
    async search(): Promise<WebSearchResult> { throw new Error('aborted') },
  }
  const provider = new DokoFirstSearchProvider(primary, search('free'), { onRescue: () => { rescued = true } })
  await assert.rejects(() => provider.search(request, controller.signal), /aborted/)
  assert.equal(rescued, false)
})

test('available() is true when either leg is usable', () => {
  assert.equal(new DokoFirstSearchProvider(search('doko', { available: false }), search('free')).available(), true)
  assert.equal(new DokoFirstSearchProvider(search('doko'), search('free', { available: false })).available(), true)
  assert.equal(new DokoFirstSearchProvider(search('doko', { available: false }), search('free', { available: false })).available(), false)
})

test('fetch rescue maps the free result', async () => {
  const provider = new DokoFirstFetchProvider(fetchProvider('doko', { ok: false }), fetchProvider('free'))
  const result = await provider.fetch({ url: 'https://example.com' } as WebFetchRequest)
  assert.equal(result.body.content, 'free')
})