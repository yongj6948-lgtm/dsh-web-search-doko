# dsh-web-search-doko

DeepSeek Harness plugin that powers web access with a local
[doko-server](https://github.com/) (Chrome + Dokobot). It registers a **search
provider** and a **fetch provider** on the `ctx.web` capability seam, so the
built-in `web_search` and `web_fetch` tools work unchanged while doko does the
browsing.

## What it provides

| Contribution | Kind | Backed by |
|---|---|---|
| `doko` search/fetch | `ctx.web` | doko `Search`/`Read` (browser SERP + page extractor) |
| `free` search/fetch | `ctx.web` | keyless public ring: Exa / Keenable / Parallel |
| `doko-first` search/fetch | `ctx.web` | doko primary, **one-shot `free` rescue** on hard failure |

The plugin talks to doko-server over **HTTP/1.1 Connect-JSON**
(`POST /doko.v1.SearchService/Search|Read`). It needs no local `dokobot`, no
protobuf runtime, and no child process.

The `free` providers are a **no-API-key** alternative borrowed from
[Hermes Agent](https://github.com/NousResearch/hermes-agent)'s keyless
free-tier rotation: requests walk the vendors in order and fail over past
them when one throttles. The ring is anonymous, rate-limited, and has no SLA —
set up a keyed provider for guaranteed service.

### Fallback semantics (`doko-first`)

The bundle patch selects **`doko-first`**: doko is the primary backend and the
`free` ring is a **one-shot rescue** invoked only when doko hard-fails
(unreachable, timeout, provider error) — never on a successful-but-thin result,
and never on caller cancellation. The rescue is **not sticky**: every call
starts at doko again. Each rescue is logged via `ctx.logger` (`web: doko <kind>
failed, rescued by free: …`).

This mirrors Hermes' "one-shot keyless rescue": the configured backend always
wins, and the anonymous tier is a safety net, not the default path. `ctx.web`
selects exactly one provider by id, so the chain lives inside one provider
rather than a hidden priority list. Pick `doko` (local only) or `free` (keyless
only) to opt out.

> `ctx.web` sources are text-only. Full-page screenshots (for image content the
> model must inspect) are a planned follow-up — see [Limitations](#known-limitations-and-deferred-work).

## Install

Prerequisites:

- A reachable doko-server running on a host with Chrome + the Dokobot bridge.
- A healthy profile: `dsh --profile <p> --dump-config` should already succeed
  before you add anything.

This is a source-only repo: a git install fetches the sources and runs the
package's `prepare` build, which pnpm gates behind an explicit allow. The allow
key must be the **resolved spec**, not the package name — a short key such as
`dsh-web-search-doko: true` is silently ignored and the install fails with
`ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`. That error prints the exact key; add it
verbatim:

```yaml
# <profile>/pnpm-workspace.yaml
allowBuilds:
  "dsh-web-search-doko@https://codeload.github.com/<owner>/dsh-web-search-doko/tar.gz/<sha>": true
```

```sh
dsh plugin --profile web add github:<owner>/dsh-web-search-doko#<sha>
dsh --profile web --dump-config | grep -A3 'id: web$'
dsh --profile web
```

Pin `#<sha>` for a reproducible install; omit it to follow the default branch.
The resolved spec embeds the commit sha, so the allow key changes whenever you
switch revisions — copy the key pnpm prints rather than guessing it.

The build runs `npm install`, pulling the full devDependency tree (TypeScript,
`@types/node`, several `@deepseek-ai/*`). On sandboxed machines that can fail
with `EPERM` under `~/.npm/_cacache` even when ownership is fine; run the install
outside the sandbox, or prebuild once and install from the local tarball.

`dsh plugin add` records the package in both the profile's `package.json` and
its `dsh.profile.bundles`. Both matter: a `cordis.patch.yml` `insert` alone is
composed into `--dump-config` but never resolved, because the loader builds its
package table from `dsh.profile.bundles`. If you install by hand, add the bundle
there too.

### Peer dependencies

This plugin (like `@deepseek-ai/dsh-web` itself) has `@deepseek-ai/cordis` as a
peer. Profiles with `autoInstallPeers: false` (the default) do not pull it in
automatically, and when it is missing the only symptom is a vague
`failed to import`. If you hit that, add it explicitly:

```sh
dsh plugin --profile web add @deepseek-ai/cordis@^4.0.4
```

The bundle patch registers the plugin and points the web service at it:

```yaml
- insert:
    - id: web-search-doko
      name: 'dsh-web-search-doko'
- id: web
  config:
    searchProvider: doko-first
    fetchProvider: doko-first
```

The target id is `web` (the `@deepseek-ai/dsh-web` service row from
`dsh-base`), **not** `dsh-web` — a wrong id fails the patch with
`entry "dsh-web" not found`. Drop the `web` override to keep the built-in
fetch provider and only switch search (or vice versa).

To override the endpoint without editing this package, add your own layer to
the profile's `cordis.patch.yml`:

```yaml
- id: web-search-doko
  name: 'dsh-web-search-doko'
  config:
    baseURL: 'http://127.0.0.1:8080'
```

### Troubleshooting

When the plugin fails to load, the harness log usually only says:

```
dsh: warning: 1 entry did not activate
web-search-doko (dsh-web-search-doko): failed to import
```

The real cause is swallowed. Import the built entry by hand to surface it (run
from the profile directory so `@deepseek-ai/*` peers resolve):

```sh
cd ~/.dsh/profiles/<p>
node --input-type=module -e "await import('dsh-web-search-doko').then(() => console.log('ok'))"
```

Common causes it reveals:

- `ERR_MODULE_NOT_FOUND: '@deepseek-ai/cordis'` → install the peer (above).
- The package is in `cordis.patch.yml` but not in `dsh.profile.bundles` → it is
  never resolved (see Install).
- `configured web provider "doko-first" is not registered` at tool-call time →
  the plugin did not load, or `freeVendors` is `[]` while the patch still selects
  `doko-first`. If you edited sources, rebuild `lib/` (see Development).

## Configure

All fields are optional. `cordis.yml`:

```yaml
- id: web-search-doko
  name: 'dsh-web-search-doko'
  config:
    baseURL: 'http://127.0.0.1:8080'
    engine: google
    screens: 1
    readScreens: 1
    timeoutMs: 90000
    tbs: qdr:y          # optional Google time range
    includeSerpText: false
```

| Field | Default | Env fallback | Meaning |
|---|---|---|---|
| `baseURL` | `http://127.0.0.1:8080` | `DOKO_SERVER_URL` | doko-server endpoint |
| `apiKey` | `''` | `DOKO_API_KEY` | `x-api-key` header when the server enables auth |
| `engine` | `google` | — | google, bing, duckduckgo, baidu, sogou, yandex, twitter |
| `screens` | `1` | — | screens captured for search |
| `readScreens` | `1` | — | screens for read; `1` is fast-path eligible |
| `timeoutMs` | `90000` | — | per-request timeout |
| `tbs` | — | — | Google `tbs` time-range parameter |
| `includeSerpText` | `false` | — | also return cleaned SERP text as `content` |
| `freeVendors` | `['exa','keenable','parallel']` | — | keyless ring order; `[]` disables the `free` providers (and leaves `doko-first` as doko-only) |
| `freeTimeoutMs` | `30000` | — | per-request timeout for keyless vendors |

### Keyless `free` ring

Registering the `free` providers is cheap (no network calls). They are the
rescue leg of `doko-first` by default; to use the ring on its own, override the
`web` row in your profile patch:

```yaml
- id: web
  config:
    searchProvider: free
    fetchProvider: free
```

Pin a single vendor (still keyless) or reorder the ring from this package's row:

```yaml
- id: web-search-doko
  name: 'dsh-web-search-doko'
  config:
    freeVendors: [keenable, exa]   # drop parallel; disable entirely with []
```

| Vendor | Wire protocol | Search | Fetch | Notes |
|---|---|---|---|---|
| `exa` | MCP over HTTP (`mcp.exa.ai/mcp`) | ✔ | ✔ | semantic search, markdown highlights |
| `keenable` | public REST (`api.keenable.ai`) | ✔ | ✔ | sends `X-Keenable-Title` app id only |
| `parallel` | MCP over HTTP (`search.parallel.ai/mcp`) | ✔ | ✔ | random per-process `session_id`, no user ids |
| `ddgs` | HTML scrape (`html.duckduckgo.com/html/`) | ✔ | — | **opt-in**; search-only; blocked on some networks (needs proxy) |

Smoke-test the ring without doko:

```sh
node scripts/live-smoke-free.mjs "rust web frameworks"            # default ring
node scripts/live-smoke-free.mjs "rust web frameworks" ddgs,exa  # custom ring
```

#### Proxy / blocked networks

The keyless HTTP calls use the runtime's global `fetch`. On a network where
DuckDuckGo (or any vendor) is blocked, start a proxy and make Node honour the
standard `HTTPS_PROXY` env vars:

```sh
source ~/proxy.sh                       # exports http_proxy/https_proxy
NODE_OPTIONS=--use-env-proxy dsh --profile headless "..."
```

`--use-env-proxy` is a Node flag (Node 24+); set it via `NODE_OPTIONS` so it also
reaches the `dsh` process. Without a proxy, a blocked `ddgs` fails and the ring
simply moves on to the next vendor. Note: plain `http_proxy` alone is **not**
read by Node's `fetch` unless the flag (or an explicit dispatcher) is used.

### Network exposure

The client uses plain HTTP. On the same host, leave `baseURL` at
`http://127.0.0.1:8080` so traffic never leaves the loopback interface. A
cross-host deployment sends search queries, fetched page text, and (later)
screenshots across the LAN in cleartext; keep it on a trusted network or front
the server with TLS and set `apiKey`.

The keyless `free` ring is different: it sends the query (and fetched URL) over
public **HTTPS** to Exa / Keenable / Parallel. No credentials or user
identifiers are attached — only Parallel's random per-process `session_id`,
which exists solely for its free-tier rate limiting. Queries leave your machine
when you select the `free` providers.

## How search results are structured

doko does not return structured search results — `read --format` is only
`text`/`chunks`. The provider therefore:

1. collects doko's trailing `[N] url` reference list into a number → URL map;
2. splits the rendered SERP into blocks and resolves each result's real URL;
3. drops search-engine navigation/pagination links and de-duplicates by
   fragment-stripped URL;
4. falls back to the cleaned page text as `content` when no source parses.

This is intentionally forgiving: an unparsable block is skipped, never an error.

## Development

```sh
npm install --legacy-peer-deps   # @deepseek-ai/* packages carry workspace peers
npm run build                    # tsc -> lib/  (gitignored; prepare runs it on install)
npm test                         # builds first, then runs the unit tests
node scripts/live-smoke.mjs http://127.0.0.1:8080   # needs a live doko-server
node scripts/live-smoke-free.mjs                     # needs only outbound HTTPS
node scripts/live-smoke-free.mjs "query" ddgs        # DDGS needs a proxy on blocked networks
```

## Model Experience

### `web_search`

#### What the model sees

The built-in `dsh-tool-web` schema (`queries`), rendered as a markdown source
list. This plugin only changes where the sources come from.

#### Token effect

Indirect — determined by `dsh-tool-web`'s `searchMaxResults` (default 8).

#### KV Cache effect

Independent — provider output does not alter the assembled request prefix.

### `web_fetch`

#### What the model sees

The built-in `dsh-tool-web` fetch schema (`url`), rendered from doko's extracted
text.

#### Token effect

Indirect — bounded by `dsh-tool-web`, not by this provider.

#### KV Cache effect

Independent.

## Known Limitations and Deferred Work

- **No screenshot delivery** — `ctx.web` has no image field, and doko-server has
  no screenshot RPC. Image-bearing results are deferred to a separate
  `web_screenshot` tool plus a doko-server `Screenshot` endpoint.
- **Heuristic SERP parsing** — source extraction is text-pattern based and may
  degrade when a search engine changes its rendered layout. `content` fallback
  keeps results usable; fixtures cover Google only.
- **Non-HTML payloads (PDF, etc.)** — doko's `Read` completes but returns no
  `text` for non-HTML URLs, so the `doko` fetch provider treats an empty body as
  a hard failure. Under `doko-first` this triggers the one-shot `free` rescue,
  which reads PDFs well (Exa extracts their text). The `doko` provider alone
  returns a clear `WEB_PROVIDER_ERROR` instead of invalid empty output.
- **No result-count control** — doko returns a fixed result set; the seam
  truncates to `maxResults` but the provider cannot ask for fewer at the source.
- **Plaintext transport** — see Network exposure.
- **Keyless ring is best-effort** — the `free` vendors are anonymous public
  tiers with no SLA; they may throttle or change shape. They fail over across
  the ring and the keyed/doko path is unaffected.