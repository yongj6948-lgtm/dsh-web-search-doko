import { test } from 'node:test'
import assert from 'node:assert/strict'
import { apply, name } from '../lib/index.js'

test('plugin identity is stable', () => {
  assert.equal(name, 'web-search-doko')
})

test('apply registers both doko providers on ctx.web', () => {
  const registered: Array<{ kind: string; id: string }> = []
  const ctx = {
    get: () => undefined,
    web: {
      registerSearchProvider: (provider: { id: string }) => {
        registered.push({ kind: 'search', id: provider.id })
        return () => {}
      },
      registerFetchProvider: (provider: { id: string }) => {
        registered.push({ kind: 'fetch', id: provider.id })
        return () => {}
      },
    },
  } as never

  apply(ctx, { baseURL: 'http://127.0.0.1:8080' })

  assert.deepEqual(registered, [
    { kind: 'search', id: 'doko' },
    { kind: 'fetch', id: 'doko' },
    { kind: 'search', id: 'free' },
    { kind: 'fetch', id: 'free' },
    { kind: 'search', id: 'doko-first' },
    { kind: 'fetch', id: 'doko-first' },
  ])
})

test('apply skips the free ring (and rescue) when no vendors are configured', () => {
  const registered: Array<{ kind: string; id: string }> = []
  const ctx = {
    get: () => undefined,
    web: {
      registerSearchProvider: (provider: { id: string }) => {
        registered.push({ kind: 'search', id: provider.id })
        return () => {}
      },
      registerFetchProvider: (provider: { id: string }) => {
        registered.push({ kind: 'fetch', id: provider.id })
        return () => {}
      },
    },
  } as never

  apply(ctx, { baseURL: 'http://127.0.0.1:8080', freeVendors: [] })

  assert.deepEqual(registered, [
    { kind: 'search', id: 'doko' },
    { kind: 'fetch', id: 'doko' },
  ])
})