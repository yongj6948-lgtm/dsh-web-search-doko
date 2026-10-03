/**
 * doko-server performance benchmark. Ad-hoc, not part of the test suite.
 *
 *   node scripts/bench-doko.mjs [baseURL]
 *
 * Measures:
 *  - Health round-trip (pure HTTP overhead)
 *  - Search latency, screens=1 (fast path) and screens=2 (browser)
 *  - Read latency, screens=1 (fast) vs screens=2 (browser)
 *  - Concurrent throughput (N parallel searches)
 */
const baseURL = process.argv[2] ?? 'http://127.0.0.1:8080'
const RPC = (m) => `${baseURL}/doko.v1.SearchService/${m}`

async function call(method, body) {
  const t0 = performance.now()
  const res = await fetch(RPC(method), {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  const ms = performance.now() - t0
  if (!res.ok) throw new Error(`${method} HTTP ${res.status}: ${text}`)
  return { ms, data: JSON.parse(text), bytes: text.length }
}

function stats(xs) {
  const s = [...xs].sort((a, b) => a - b)
  const sum = s.reduce((a, b) => a + b, 0)
  const pct = (p) => s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]
  return {
    n: s.length,
    min: s[0],
    p50: pct(50),
    p90: pct(90),
    max: s[s.length - 1],
    mean: sum / s.length,
  }
}

function fmt(name, r) {
  const f = (x) => x.toFixed(0).padStart(6)
  return `${name.padEnd(34)} n=${r.n}  min=${f(r.min)}  p50=${f(r.p50)}  p90=${f(r.p90)}  max=${f(r.max)}  mean=${f(r.mean)} ms`
}

const queries = [
  'rust web frameworks',
  'python asyncio tutorial',
  'sqlite vector search',
  'postgres vs mysql',
  'linux kernel scheduler',
]

async function benchHealth(n) {
  const xs = []
  for (let i = 0; i < n; i++) {
    const { ms } = await call('Health', {})
    xs.push(ms)
  }
  return stats(xs)
}

async function benchSearch(screens, n) {
  const xs = []
  let textLen = 0
  for (let i = 0; i < n; i++) {
    const q = queries[i % queries.length]
    const { ms, data } = await call('Search', { query: q, engine: 'google', screens })
    xs.push(ms)
    textLen += (data.text ?? '').length
  }
  return { ...stats(xs), avgChars: Math.round(textLen / n) }
}

async function benchRead(screens, n) {
  const xs = []
  let textLen = 0
  // varied lightweight pages to avoid trivially cached same page
  const urls = [
    'https://example.com',
    'https://example.org',
    'https://www.rust-lang.org',
    'https://nodejs.org/en',
    'https://www.python.org',
  ]
  for (let i = 0; i < n; i++) {
    const { ms, data } = await call('Read', { url: urls[i % urls.length], screens })
    xs.push(ms)
    textLen += (data.text ?? '').length
  }
  return { ...stats(xs), avgChars: Math.round(textLen / n) }
}

async function benchConcurrent(screens, concurrency) {
  const t0 = performance.now()
  const tasks = []
  for (let i = 0; i < concurrency; i++) {
    tasks.push(call('Search', { query: queries[i % queries.length], engine: 'google', screens }))
  }
  const results = await Promise.allSettled(tasks)
  const total = performance.now() - t0
  const ok = results.filter((r) => r.status === 'fulfilled').length
  return { concurrency, ok, wallMs: total, throughput: (ok / total) * 1000 }
}

console.log(`doko-server benchmark @ ${baseURL}`)
console.log(`health: ${JSON.stringify((await call('Health', {})).data)}\n`)

console.log('--- Health (pure HTTP overhead) ---')
console.log(fmt('Health x20', await benchHealth(20)))
console.log()

console.log('--- Search ---')
const s1 = await benchSearch(1, 5)
console.log(fmt('Search google screens=1', s1), `\n    avg ${s1.avgChars} chars text`)
const s2 = await benchSearch(2, 5)
console.log(fmt('Search google screens=2', s2), `\n    avg ${s2.avgChars} chars text`)
console.log()

console.log('--- Read ---')
const r1 = await benchRead(1, 5)
console.log(fmt('Read screens=1', r1), `\n    avg ${r1.avgChars} chars text`)
const r2 = await benchRead(2, 5)
console.log(fmt('Read screens=2', r2), `\n    avg ${r2.avgChars} chars text`)
console.log()

console.log('--- Concurrent Search (screens=1) ---')
for (const c of [1, 4, 8]) {
  const r = await benchConcurrent(1, c)
  console.log(`concurrency=${String(r.concurrency).padStart(2)}  ok=${r.ok}/${c}  wall=${r.wallMs.toFixed(0)}ms  throughput=${r.throughput.toFixed(2)} req/s`)
}
console.log()
console.log('--- Concurrent Search (screens=2, real browser) ---')
for (const c of [1, 4]) {
  const r = await benchConcurrent(2, c)
  console.log(`concurrency=${String(r.concurrency).padStart(2)}  ok=${r.ok}/${c}  wall=${r.wallMs.toFixed(0)}ms  throughput=${r.throughput.toFixed(2)} req/s`)
}