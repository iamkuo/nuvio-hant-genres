/**
 * nuvio-hant-genres — a Stremio/Nuvio metadata addon that proxies another
 * metadata addon and rewrites its `genres` into Traditional Chinese.
 *
 * Why this exists: Nuvio renders addon metadata verbatim
 * (`MetaDetailsParser` -> `genres = meta.stringList("genres")`), TMDB returns
 * Simplified genre names for every Chinese language code, and no addon can emit
 * Traditional ones. So the rewrite happens here instead, in front of the addon
 * that already gives you the titles you want.
 *
 * Usage: install `<worker-url>/manifest.json?upstream=<url-encoded upstream
 * manifest URL>` in Nuvio and move it to the top of the addon list. The first
 * enabled addon that serves `meta` for an item wins, so this one supplies the
 * metadata and its converted genres, while everything else (title, poster,
 * description, episodes, cast) is passed through untouched.
 *
 * Query options (all carried through by Nuvio, which appends the manifest URL's
 * query string to every resource request):
 *   upstream=<url>   required, the upstream addon's manifest URL (percent-encoded)
 *   english=0        only convert Simplified characters, leave English genres alone
 *
 * Runtime: Cloudflare Workers (module worker). No Node APIs, no bindings.
 */

const UA = 'nuvio-hant-genres/1.0 (+stremio metadata addon)';

/**
 * English genre names -> Traditional Chinese, keyed by a normalized form
 * (lowercase, "&" -> "and", every other non-alphanumeric character dropped), so
 * "Sci-Fi & Fantasy", "Sci-Fi and Fantasy" and "scifi&fantasy" all match.
 * Covers the TMDB movie/TV vocabularies, Cinemeta, and the AniList/MAL extras.
 */
const ENGLISH_GENRES = {
  action: '動作',
  adventure: '冒險',
  animation: '動畫',
  anime: '動畫',
  comedy: '喜劇',
  crime: '犯罪',
  documentary: '紀錄',
  drama: '劇情',
  family: '家庭',
  fantasy: '奇幻',
  history: '歷史',
  horror: '恐怖',
  music: '音樂',
  musical: '音樂劇',
  mystery: '懸疑',
  romance: '愛情',
  sciencefiction: '科幻',
  scifi: '科幻',
  tvmovie: '電視電影',
  thriller: '驚悚',
  war: '戰爭',
  western: '西部',
  actionandadventure: '動作與冒險',
  kids: '兒童',
  news: '新聞',
  reality: '真人秀',
  realitytv: '真人秀',
  scifiandfantasy: '科幻與奇幻',
  soap: '肥皂劇',
  talk: '脫口秀',
  talkshow: '脫口秀',
  warandpolitics: '戰爭與政治',
  gameshow: '遊戲節目',
  sport: '體育',
  sports: '運動',
  short: '短片',
  filmnoir: '黑色電影',
  biography: '傳記',
  sliceoflife: '日常',
  supernatural: '超自然',
  mecha: '機甲',
  psychological: '心理',
  adult: '成人',
};

/**
 * Simplified -> Traditional characters, for upstreams that already return
 * Chinese genre names (TMDB `zh-TW`/`zh-CN`, Douban-backed addons).
 * Add entries here (or swap in an OpenCC table) if you hit an uncovered name.
 */
const TRADITIONAL_CHARS = {
  动: '動', 险: '險', 画: '畫', 剧: '劇', 纪: '紀', 录: '錄', 历: '歷',
  乐: '樂', 悬: '懸', 爱: '愛', 惊: '驚', 战: '戰', 争: '爭', 儿: '兒',
  闻: '聞', 脱: '脫', 电: '電', 视: '視', 综: '綜', 艺: '藝', 装: '裝',
  与: '與', 为: '為', 类: '類', 说: '說', 话: '話', 记: '記', 谈: '談',
  娱: '娛', 众: '眾', 华: '華', 图: '圖', 书: '書', 长: '長', 韩: '韓',
  国: '國', 际: '際', 风: '風', 云: '雲', 马: '馬', 鸟: '鳥', 鱼: '魚',
  龙: '龍', 飞: '飛', 车: '車', 门: '門', 间: '間', 无: '無', 数: '數',
  学: '學', 术: '術', 医: '醫', 药: '藥', 疗: '療', 亲: '親', 独: '獨',
  网: '網', 习: '習', 员: '員', 团: '團', 队: '隊', 乡: '鄉', 岛: '島',
  湾: '灣', 状: '狀', 态: '態', 处: '處', 经: '經', 济: '濟', 财: '財',
   赏: '賞', 讯: '訊', 访: '訪', 节: '節', 丽: '麗', 戏: '戲',
};

/** Normalizes a genre name for lookup in ENGLISH_GENRES. */
function normalizeGenreKey(value) {
  return value
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]/g, '');
}

/** Converts the Simplified characters in a string; other characters pass through. */
function convertCharacters(value) {
  let result = '';
  for (const character of value) {
    result += TRADITIONAL_CHARS[character] ?? character;
  }
  return result;
}

/**
 * Converts one metadata string to Traditional Chinese.
 * English genre names are mapped first, then any Simplified characters are
 * converted, so both English (Cinemeta/TMDB) and Chinese (TMDB zh / Douban)
 * upstreams come out Traditional. Unknown values are returned unchanged.
 */
export function toHant(value, options = {}) {
  const { english = true } = options;
  if (typeof value !== 'string' || value.trim() === '') return value;
  if (english) {
    const mapped = ENGLISH_GENRES[normalizeGenreKey(value)];
    if (mapped) return mapped;
  }
  return convertCharacters(value);
}

/** Converts and de-duplicates a genre list, preserving order. */
export function convertGenres(genres, options = {}) {
  const seen = new Set();
  const result = [];
  for (const genre of genres) {
    const converted = typeof genre === 'string' ? toHant(genre, options) : genre;
    if (typeof converted === 'string') {
      if (seen.has(converted)) continue;
      seen.add(converted);
    }
    result.push(converted);
  }
  return result;
}

/**
 * Builds this addon's manifest. The upstream's `types` and `idPrefixes` are
 * copied so Nuvio's `supportsResource("meta", type, id)` matches exactly the
 * items the upstream handles. `catalogs` is empty on purpose: this addon must
 * never add home rows or duplicate the upstream's.
 */
export function buildManifest(upstreamManifest, upstreamManifestUrl) {
  const upstreamTypes = Array.isArray(upstreamManifest?.types) ? upstreamManifest.types : [];
  const upstreamPrefixes = Array.isArray(upstreamManifest?.idPrefixes) ? upstreamManifest.idPrefixes : [];
  const upstreamName = typeof upstreamManifest?.name === 'string' ? upstreamManifest.name : null;

  const manifest = {
    id: 'com.hant.genres.proxy',
    version: '1.0.0',
    name: '繁體類型 (Hant genres)',
    description: upstreamName
      ? `Proxies "${upstreamName}" and rewrites genres into Traditional Chinese.`
      : 'Proxies a metadata addon and rewrites genres into Traditional Chinese.',
    types: upstreamTypes.length > 0 ? upstreamTypes : ['movie', 'series'],
    resources: ['meta'],
    catalogs: [],
    behaviorHints: { configurable: false },
  };

  // Empty idPrefixes means "any id" in Nuvio's matching, so only copy a
  // non-empty list; that keeps us in sync if the upstream is prefix-restricted.
  if (upstreamPrefixes.length > 0) manifest.idPrefixes = upstreamPrefixes;
  return manifest;
}

/**
 * Maps a resource path onto the upstream addon, mirroring how Nuvio builds
 * resource URLs: strip `/manifest.json`, append the resource path, keep the
 * upstream manifest's own query string (AIOMetadata UUIDs/passwords live there).
 */
export function upstreamResourceUrl(upstreamManifestUrl, resourcePath) {
  const url = new URL(upstreamManifestUrl);
  const base = url.pathname
    .replace(/\/?manifest\.json\/?$/, '')
    .replace(/\/+$/, '');
  url.pathname = `${base}${resourcePath}`;
  return url.toString();
}

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
};

/**
 * Framework-agnostic request handler. Cloudflare Workers use it through the
 * default export below; any other host only needs to pass a standard Request
 * and return its Response.
 */
export async function handleRequest(request, options = {}) {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const upstream = (url.searchParams.get('upstream') || options.upstream || '').trim();

  if (upstream === '') {
    return jsonResponse(
      {
        error: 'Missing ?upstream= parameter',
        hint: 'Install this addon as <this-url>/manifest.json?upstream=<percent-encoded metadata addon manifest URL>',
      },
      400,
      CORS_HEADERS,
    );
  }

  let upstreamManifestUrl;
  try {
    upstreamManifestUrl = new URL(upstream).toString();
  } catch {
    return jsonResponse({ error: 'upstream is not a valid URL', upstream }, 400, CORS_HEADERS);
  }

  const english = url.searchParams.get('english') !== '0';
  const upstreamHeaders = { accept: 'application/json', 'user-agent': UA };

  if (path === '/manifest.json') {
    let upstreamManifest = null;
    try {
      const response = await fetchImpl(upstreamManifestUrl, { headers: upstreamHeaders });
      if (response.ok) upstreamManifest = await response.json();
    } catch {
      // Unreachable upstream still yields a usable manifest with safe defaults.
    }
    return jsonResponse(buildManifest(upstreamManifest, upstreamManifestUrl), 200, {
      ...CORS_HEADERS,
      'cache-control': 'public, max-age=300',
    });
  }

  const match = path.match(/^\/meta\/([^/]+)\/(.+)\.json$/);
  if (!match) {
    return jsonResponse(
      { error: `Unsupported path ${url.pathname}`, supported: ['/manifest.json', '/meta/{type}/{id}.json'] },
      404,
      CORS_HEADERS,
    );
  }

  const [, type, id] = match;
  const resourceUrl = upstreamResourceUrl(upstreamManifestUrl, `/meta/${type}/${id}.json`);

  let upstreamResponse;
  try {
    upstreamResponse = await fetchImpl(resourceUrl, { headers: upstreamHeaders });
  } catch (error) {
    return jsonResponse({ error: 'upstream fetch failed', resourceUrl, message: String(error) }, 502, CORS_HEADERS);
  }

  // Pass failures through unchanged: Nuvio then skips this addon for that item
  // and falls back to the next one, exactly as it would with the raw upstream.
  if (!upstreamResponse.ok) {
    return new Response(await upstreamResponse.text(), {
      status: upstreamResponse.status,
      headers: { ...CORS_HEADERS, 'content-type': 'application/json; charset=utf-8' },
    });
  }

  let payload;
  try {
    payload = await upstreamResponse.json();
  } catch {
    return jsonResponse({ error: 'upstream returned invalid JSON', resourceUrl }, 502, CORS_HEADERS);
  }

  const meta = payload && typeof payload === 'object' ? payload.meta : null;
  if (meta && typeof meta === 'object') {
    // `genres` is what Nuvio reads; `genre` is kept in step for other clients.
    for (const key of ['genres', 'genre']) {
      const value = meta[key];
      if (Array.isArray(value)) {
        meta[key] = convertGenres(value, { english });
      } else if (typeof value === 'string' && value.trim() !== '') {
        meta[key] = toHant(value, { english });
      }
    }
  }

  return jsonResponse(payload, 200, { ...CORS_HEADERS, 'cache-control': 'public, max-age=600' });
}

export default {
  fetch: (request) => handleRequest(request),
};
