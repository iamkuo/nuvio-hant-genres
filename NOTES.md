# Notes: why this addon exists, and how Nuvio resolves metadata

Collected by reading the public Nuvio sources (`NuvioMedia/NuvioTV`, `NuvioMedia/NuvioMobile`, default branch, read on 2026-10-28) and by measuring the live services. Paths are relative to each repository root.

## The original problem

Nuvio renders addon metadata verbatim: `MetaDetailsParser` reads `genres = meta.stringList("genres")`. TMDB returns Simplified genre names for every Chinese language code, so with an AIOMetadata instance set to Chinese (Taiwan) the titles come back Traditional but the genres come back 简体中文. No addon locale can fix that, so this proxy rewrites only the `genres` array in front of the addon that already supplies the good titles.

## How Nuvio picks the metadata addon

`NuvioMobile/composeApp/src/commonMain/kotlin/com/nuvio/app/features/details/MetaDetailsRepository.kt`

* `findMetaManifests()` returns enabled addons in installed order, filtered by `manifest.supportsResource("meta", type, id)`.
* `fetch(type, id)` walks that list and returns the **first success**, then falls back to `getMetaFromPrimaryAddon`-style lookup and finally to TMDB.

`.../features/addons/AddonModels.kt`

```kotlin
fun AddonManifest.supportsResource(name: String, type: String, id: String): Boolean =
    resources.any { resource ->
        resource.name == name &&
            resource.types.contains(type) &&
            (resource.idPrefixes.isEmpty() || resource.idPrefixes.any { id.startsWith(it) })
    }
```

`.../features/addons/AddonManifestParser.kt` parses the short form `"resources": ["meta"]` by filling `types` and `idPrefixes` from the manifest's top-level fields, so this addon's shape matches. Note that the check is per resource, not on the top-level fields.

`NuvioTV/app/src/main/java/com/nuvio/tv/data/repository/MetaRepositoryImpl.kt` mirrors this: `selectPrimaryMetaCandidate()` takes the first installed addon that supports the requested type; `getMetaFromAllAddons()` prioritises addons that match both type and id prefix, again in installed order.

**Consequence: addon order decides everything. Anything above this proxy serves `meta` instead of it.**

## Where Continue Watching titles come from

Trakt supplies only a seed — content id, progress, season and episode:

`NuvioMobile/.../features/trakt/TraktProgressRepository.kt` builds entries as `title = show.title ?: parentMetaId`, `episodeTitle = episode.title`, and leaves `poster` and `background` null. `TraktIdUtils.normalizeTraktContentId()` prefers `tt…`, then `tmdb:<id>`, then `trakt:<id>`.

The app then enriches those entries from the addon `meta` resource:

`NuvioMobile/.../features/watchprogress/WatchProgressMetadataProjection.kt` sets `title = meta.name` and `episodeTitle = episodeVideo?.title`.

`NuvioMobile/.../features/watchprogress/WatchProgressRepository.kt` gates that work on `needsRemoteMetadataEnrichment()` — true when the title is blank, equals `parentMetaId`, or the poster/background is blank — and resolves through `MetaDetailsRepository.fetch(key.metaType, key.metaId)` with 3 attempts, concurrency 4 and a limit of 64 entries. Because Trakt entries carry no artwork, they qualify.

Two paths skip the resolution when the active progress provider claims complete metadata: `TraktTrackingProgressProvider` declares `providesCompleteMetadata = true`, and `activateSource()` only calls `resolveRemoteMetadata()` when that flag is false. `applyExternalProgress()` does not trigger resolution either, so freshly synced Trakt rows can keep their English seed title until the next profile load or playback.

`NuvioMobile/.../features/home/components/HomeContinueWatchingSection.kt` renders only `item.title` plus `localizedEpisodeTitle(item.episodeTitle, item.episodeNumber)`; the card shows no genres.

`NuvioTV/.../ui/screens/home/HomeViewModelContinueWatching.kt` always enriches, and sets:

```kotlin
name   = if (settings.useBasicInfo) tmdbData?.name ?: meta.name else meta.name
genres = meta.genres.take(3)
```

So on both platforms the Continue Watching card follows whichever addon answers `meta`, and the English seen in the field came from Cinemeta being the upstream of this proxy.

## The user's AIOMetadata instance

* Manifest: `https://aiometadata.elfhosted.com/stremio/YOUR-AIOMETADATA-UUID/manifest.json`
* `name`: `AIOMetadata  | ElfHosted`, `version`: `3.8.1`
* `types`: `movie`, `series`, `anime.movie`, `anime.series`, `anime`, `Trakt`, `collection`, `person`
* `idPrefixes`: `tmdb:`, `tt`, `tvdb:`, `mal:`, `tvmaze:`, `kitsu:`, `anidb:`, `anilist:`, `tvdbc:`, `upnext_`, `unwatched_`, `mdblist_upnext_`, `pmdb_resume_`, `simkl_upnext_`, `aiom.error.`, `aiom.collection:`
* `resources`: `["catalog", "meta"]`
* `catalogs`: 38, including `Trending Anime Shows` and `Trending Anime Movies` — the home rows in the user's screenshot. AIO must stay installed to keep them; this proxy declares `catalogs: []`.
* Response time from the sandbox: roughly 3.3–3.8 s per metadata request, so the proxy adds only ~0.2 s on top.

Observed through the proxy: `tt13293588` → name `無職轉生～到了異世界就拿出真本事～`, genres `["動作冒險","動畫","科幻與奇幻"]` converted from AIO's `["动作冒险","动画","Sci-Fi & Fantasy"]`, S1 E1 `無職轉生`. `tt0111161` → `刺激1995`, `["劇情","犯罪"]`.

## Published service

* Base URL: `https://hantgenres-spjgde6d.manus.space`
* Install URL: `<base>/manifest.json?upstream=<percent-encoded AIO manifest URL>`
* Routes: `/manifest.json`, `/meta/{type}/{id}.json`, plus `/api/health` and `/manus-routes.json` for the platform.
* `worker.js` is byte-identical to the file supplied by the user; `server.js` is the only host-specific code and logs one line per request (path, upstream host, status, latency, returned name and genres — never the query string, which can carry a password).
