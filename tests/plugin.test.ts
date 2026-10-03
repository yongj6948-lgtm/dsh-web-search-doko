import { test } from 'node:test'
import assert from 'node:assert/strict'
import { apply, name, Config } from '../lib/index.js'

test('plugin identity is stable', () => {
  assert.equal(name, 'web-search-doko')
})

function collectingCtx(): { ctx: never; registered: Array<{ kind: string; id: string }> } {
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
  return { ctx, registered }
}

test('apply registers both doko providers on ctx.web', () => {
  const { ctx, registered } = collectingCtx()

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

// Regression: schemastery materialises an omitted array field as `[]`, not
// `undefined`, so a missing schema default silently disabled the whole free
// ring and left `doko-first` unregistered (the bundle patch default). Exercise
// the real `Config` validation path, which `apply(rawObject)` alone does not.
test('Config({}) defaults freeVendors to the ring and registers doko-first', () => {
  const config = Config({ baseURL: 'http://127.0.0.1:8080' })
  assert.deepEqual(config.freeVendors, ['exa', 'keenable', 'parallel'])

  const { ctx, registered } = collectingCtx()
  apply(ctx, config)

  assert.deepEqual(registered, [
    { kind: 'search', id: 'doko' },
    { kind: 'fetch', id: 'doko' },
    { kind: 'search', id: 'free' },
    { kind: 'fetch', id: 'free' },
    { kind: 'search', id: 'doko-first' },
    { kind: 'fetch', id: 'doko-first' },
  ])
})

test('apply skips the free ring but still registers doko-first when no vendors are configured', () => {
  const { ctx, registered } = collectingCtx()

  apply(ctx, { baseURL: 'http://127.0.0.1:8080', freeVendors: [] })

  assert.deepEqual(registered, [
    { kind: 'search', id: 'doko' },
    { kind: 'fetch', id: 'doko' },
    { kind: 'search', id: 'doko-first' },
    { kind: 'fetch', id: 'doko-first' },
  ])
})