# dsh-web-search-doko

DeepSeek Harness plugin that powers web access with a local
[doko-server](https://github.com/) (Chrome + Dokobot). It registers a **search
provider** and a **fetch provider** on the `ctx.web` capability seam, so the
built-in `web_search` and `web_fetch` tools work unchanged while doko does the
browsing.

## What it provides

| Contribution | Kind | Backed by |
|---|---|---|
| `doko` search provider | `ctx.web` (`WebSearchProvider`) | doko `Search` (browser SERP reader) |
| `doko` fetch provider | `ctx.web` (`WebFetchProvider`) | doko `Read` (browser page extractor) |

The plugin talks to doko-server over **HTTP/1.1 Connect-JSON**
(`POST /doko.v1.SearchService/Search|Read`). It needs no local `dokobot`, no
protobuf runtime, and no child process.

> `ctx.web` sources are text-only. Full-page screenshots (for image content the
> model must inspect) are a planned follow-up — see [Limitations](#known-limitations-and-deferred-work).

## Install

Prerequisites: a reachable doko-server running on a host with Chrome + the
Dokobot bridge.

From GitHub (a git install fetches sources and runs the package's `prepare`
build, which needs an explicit pnpm allow):

```yaml
# <profile>/pnpm-workspace.yaml
allowBuilds:
  dsh-web-search-doko: true
```

```sh
dsh plugin --profile web add github:<you>/dsh-web-search-doko#<sha>
dsh --profile web --dump-config | grep -A2 dsh-web-search-doko
dsh --profile web
```

The bundle patch registers the plugin and points the web service at it:

```yaml
- insert:
    - id: web-search-doko
      name: 'dsh-web-search-doko'
- id: dsh-web
  config:
    searchProvider: doko
    fetchProvider: doko
```

Drop the `dsh-web` override to keep the built-in fetch provider and only switch
search (or vice versa).

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

### Network exposure

The client uses plain HTTP. On the same host, leave `baseURL` at
`http://127.0.0.1:8080` so traffic never leaves the loopback interface. A
cross-host deployment sends search queries, fetched page text, and (later)
screenshots across the LAN in cleartext; keep it on a trusted network or front
the server with TLS and set `apiKey`.

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
npm run build                    # tsc -> lib/
npm test                         # parse unit tests (fixture-driven)
node scripts/live-smoke.mjs http://127.0.0.1:8080   # needs a live doko-server
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
- **No result-count control** — doko returns a fixed result set; the seam
  truncates to `maxResults` but the provider cannot ask for fewer at the source.
- **Plaintext transport** — see Network exposure.