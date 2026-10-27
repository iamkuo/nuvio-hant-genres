# 繁體類型 (Hant genres) — Nuvio/Stremio metadata addon

A stateless, public metadata proxy for Nuvio / Stremio. It forwards the chosen upstream metadata and converts only `genres` (and the parallel `genre` field when present) to Traditional Chinese. Titles, posters, descriptions, cast, episodes and ratings pass through unchanged.

## Published service

Base URL: <https://hantgenres-spjgde6d.manus.space>

Upstream: the user's AIOMetadata instance
`https://aiometadata.elfhosted.com/stremio/YOUR-AIOMETADATA-UUID/manifest.json`

Final install URL (paste into Nuvio → 附加元件 → 以 URL 新增):

```
https://hantgenres-spjgde6d.manus.space/manifest.json?upstream=https%3A%2F%2Faiometadata.elfhosted.com%2Fstremio%2FYOUR-AIOMETADATA-UUID%2Fmanifest.json
```

To point at a different upstream, replace the value of `upstream` with that addon's entire manifest URL percent-encoded. Its own query parameters must be included in the encoded value:

```sh
node -e "console.log('https://hantgenres-spjgde6d.manus.space/manifest.json?upstream=' + encodeURIComponent(process.argv[1]))" "https://your-metadata-addon.example/manifest.json?password=..."
```

The upstream is supplied per request and is never hardcoded in the service. Which upstream an installed URL uses is visible in its own manifest `description` (`Proxies "<upstream name>" and rewrites genres into Traditional Chinese.`).

## Verified behaviour through the AIO upstream

The upstream AIO returns a mix of Simplified and English genre names; the addon converts all of them. Measured against the published URL:

| Request | Upstream value | Served value |
| --- | --- | --- |
| `tt13293588` genres | `["动作冒险","动画","Sci-Fi & Fantasy"]` | `["動作冒險","動畫","科幻與奇幻"]` |
| `tt13293588` name | `無職轉生～到了異世界就拿出真本事～` | unchanged |
| `tt13293588` S1 E1 title | `無職轉生` | unchanged |

Earlier Cinemeta-upstream checks also pass: manifest 200 with `resources: ["meta"]`, `catalogs: []`; `tt0388629` → `["動畫","動作","冒險"]`; `tt0111161` → `["劇情"]`; name, description, poster and IMDb rating byte-identical to the upstream; missing `upstream` → 400 with a hint. Offline suite: 25/25 checks pass.

## Public endpoints

- `GET /manifest.json?upstream=<percent-encoded upstream manifest URL>`
- `GET /meta/{type}/{id}.json?upstream=<percent-encoded upstream manifest URL>[&english=0]`
- `GET /api/health` (deployment probe)

The metadata id may contain dots and colons (`tt0388629`, `tt0388629:1:2`, `tmdb:45706`). The addon has no login, database, bindings or secrets, adds no catalogs or home rows, and answers with CORS `*`.

## Install in Nuvio

1. **附加元件 → 以 URL 新增**, paste the install URL, install. It appears as **繁體類型 (Hant genres)**.
2. Move it to the top of the enabled addon list. Nuvio uses the first enabled addon that serves `meta` for an item, so anything above it wins instead.
3. Keep **Settings → Integrations → TMDB metadata** off, or TMDB can re-derive genres.

No APK rebuild is required. Adding `&english=0` leaves English genre names in English while still converting Simplified characters.

## Operations

Each request is logged by the host adapter as one line, for example:

```
[req] GET /meta/series/tt13293588.json -> 200 upstream=aiometadata.elfhosted.com 3487ms name="無職轉生～到了異世界就拿出真本事～" genres=["動作冒險","動畫","科幻與奇幻"]
```

The query string is never logged, because the upstream URL may carry a password. Read the lines from the platform's published log viewer.

## Local verification

```sh
npm test
```

The offline suite calls the host-agnostic `handleRequest` directly with an upstream stub; it starts no server.
