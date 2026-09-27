import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isSearchEngineUrl, parseSerp, stripFragment } from '../lib/parse.js'

const raw = readFileSync(new URL('./fixtures/google-rust.txt', import.meta.url), 'utf8')
const { content, sources } = parseSerp(raw)

test('recovers a source list from a rendered Google SERP', () => {
  assert.ok(sources.length >= 8, `expected >= 8 sources, got ${sources.length}`)
})

test('never emits search-engine navigation/pagination URLs', () => {
  for (const source of sources) {
    assert.equal(isSearchEngineUrl(source.url), false, `unexpected engine URL: ${source.url}`)
  }
})

test('maps the primary GitHub result to its real URL and title', () => {
  const github = sources.find(source => source.url === 'https://github.com/flosse/rust-web-framework-comparison')
  assert.ok(github, 'flosse comparison source missing')
  assert.equal(github.title, 'flosse/rust-web-framework-comparison')
})

test('strips URL fragments so anchor links dedupe', () => {
  const medium = sources.filter(source => source.url.includes('aarambhdevhub.medium.com'))
  assert.equal(medium.length, 1)
  assert.equal(medium[0].url.includes('#'), false)
})

test('carries a snippet for a reference-less description block', () => {
  const reddit = sources.find(source => source.url.includes('reddit.com'))
  assert.ok(reddit)
  assert.ok((reddit.snippet ?? '').includes('feet wet'), `snippet was: ${reddit.snippet}`)
})

test('cleaned content removes reference markers and engine header', () => {
  assert.equal(/\[\d+\]/.test(content), false, 'reference markers leaked into content')
  assert.equal(/Google Search/.test(content), false, 'engine header leaked into content')
})

test('stripFragment leaves fragment-free URLs untouched', () => {
  assert.equal(stripFragment('https://rocket.rs/'), 'https://rocket.rs/')
  assert.equal(stripFragment('https://x.dev/a#b'), 'https://x.dev/a')
})