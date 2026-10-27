/**
 * Offline checks for the addon. No network, no server: `handleRequest` is a
 * plain function and the upstream is a stub.
 *
 * Run with `npm test`.
 */

import assert from 'node:assert/strict';
import {
  toHant,
  convertGenres,
  buildManifest,
  upstreamResourceUrl,
  handleRequest,
} from '../worker.js';

const UPSTREAM = 'https://v3-cinemeta.strem.io/manifest.json';

const results = [];
function check(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, message: error.message });
  }
}

async function checkAsync(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, message: error.message });
  }
}

/* ---------------------------------------------------------------- conversion */

// The Simplified -> Traditional path: what a TMDB-zh or Douban upstream sends.
check('簡→繁 动作冒险 -> 動作冒險', () => assert.equal(toHant('动作冒险'), '動作冒險'));
check('簡→繁 动画 -> 動畫', () => assert.equal(toHant('动画'), '動畫'));
check('簡→繁 喜剧 -> 喜劇', () => assert.equal(toHant('喜剧'), '喜劇'));
check('簡→繁 电视电影 -> 電視電影', () => assert.equal(toHant('电视电影'), '電視電影'));
check('簡→繁 惊悚 -> 驚悚', () => assert.equal(toHant('惊悚'), '驚悚'));

// The English path: what Cinemeta and TMDB-en send.
check('EN  Animation -> 動畫', () => assert.equal(toHant('Animation'), '動畫'));
check('EN  Science Fiction -> 科幻', () => assert.equal(toHant('Science Fiction'), '科幻'));
check('EN  Sci-Fi & Fantasy -> 科幻與奇幻', () => assert.equal(toHant('Sci-Fi & Fantasy'), '科幻與奇幻'));
check('EN  TV Movie -> 電視電影', () => assert.equal(toHant('TV Movie'), '電視電影'));

// `english=0` leaves English names alone but still converts Chinese characters.
check('english=0 keeps English', () => assert.equal(toHant('Animation', { english: false }), 'Animation'));
check('english=0 still converts 动作冒险', () =>
  assert.equal(toHant('动作冒险', { english: false }), '動作冒險'));

// Unknown values and non-strings pass through untouched.
check('unknown genre unchanged', () => assert.equal(toHant('Telenovela'), 'Telenovela'));
check('non-string unchanged', () => assert.equal(toHant(null), null));

// De-duplication after conversion, order preserved.
check('convertGenres de-duplicates', () =>
  assert.deepEqual(convertGenres(['Animation', '动画', 'Action']), ['動畫', '動作']));

/* ------------------------------------------------------------------ manifest */

check('buildManifest copies upstream types/idPrefixes', () => {
  const manifest = buildManifest(
    { name: 'Cinemeta', types: ['movie', 'series'], idPrefixes: ['tt'] },
    UPSTREAM,
  );
  assert.deepEqual(manifest.resources, ['meta']);
  assert.deepEqual(manifest.catalogs, []);
  assert.deepEqual(manifest.types, ['movie', 'series']);
  assert.deepEqual(manifest.idPrefixes, ['tt']);
  assert.equal(manifest.id, 'com.hant.genres.proxy');
});

check('buildManifest tolerates an unreachable upstream', () => {
  const manifest = buildManifest(null, UPSTREAM);
  assert.deepEqual(manifest.types, ['movie', 'series']);
  assert.equal('idPrefixes' in manifest, false);
});

/* ------------------------------------------------------------ upstream paths */

check('upstreamResourceUrl strips manifest.json and keeps the query string', () => {
  const url = upstreamResourceUrl(
    'https://aiometadata.example.com/abc/manifest.json?password=secret',
    '/meta/series/tt0388629.json',
  );
  assert.equal(url, 'https://aiometadata.example.com/abc/meta/series/tt0388629.json?password=secret');
});

/* --------------------------------------------------- handleRequest, stubbed */

const CINEMETA_MANIFEST = {
  id: 'com.linvo.cinemeta',
  version: '3.0.11',
  name: 'Cinemeta',
  types: ['movie', 'series'],
  resources: ['catalog', 'meta'],
  idPrefixes: ['tt'],
};

const SERIES_META = {
  meta: {
    id: 'tt0388629',
    type: 'series',
    name: 'One Piece',
    description: 'Gold Roger was known as the Pirate King.',
    poster: 'https://images.metahub.space/poster/medium/tt0388629/img',
    imdbRating: '8.7',
    releaseInfo: '1999-',
    genres: ['Animation', 'Action', 'Adventure'],
  },
};

const MOVIE_META = {
  meta: {
    id: 'tt0111161',
    type: 'movie',
    name: 'The Shawshank Redemption',
    description: 'Framed in the 1940s for the double murder of his wife.',
    poster: 'https://images.metahub.space/poster/medium/tt0111161/img',
    imdbRating: '9.3',
    genres: ['Drama'],
  },
};

const seen = [];
async function stubFetch(url) {
  const target = String(url);
  seen.push(target);
  if (target.includes('manifest.json')) {
    return new Response(JSON.stringify(CINEMETA_MANIFEST), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }
  if (target.includes('/meta/series/tt0388629.json')) {
    return new Response(JSON.stringify(SERIES_META), { status: 200 });
  }
  if (target.includes('/meta/movie/tt0111161.json')) {
    return new Response(JSON.stringify(MOVIE_META), { status: 200 });
  }
  if (target.includes('/meta/movie/tt9999999.json')) {
    return new Response('{"error":"not found"}', { status: 404 });
  }
  return new Response('{"error":"unexpected"}', { status: 500 });
}

const encoded = encodeURIComponent(UPSTREAM);
const call = (pathAndQuery) =>
  handleRequest(new Request(`https://addon.example.com${pathAndQuery}`), { fetch: stubFetch });

await checkAsync('GET /manifest.json -> 200 meta-only manifest', async () => {
  const response = await call(`/manifest.json?upstream=${encoded}`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.resources, ['meta']);
  assert.deepEqual(body.catalogs, []);
  assert.deepEqual(body.idPrefixes, ['tt']);
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
});

await checkAsync('GET /meta/series/tt0388629.json -> 動畫/動作/冒險', async () => {
  const response = await call(`/meta/series/tt0388629.json?upstream=${encoded}`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.meta.genres, ['動畫', '動作', '冒險']);
  assert.equal(body.meta.name, SERIES_META.meta.name);
  assert.equal(body.meta.description, SERIES_META.meta.description);
  assert.equal(body.meta.poster, SERIES_META.meta.poster);
  assert.equal(body.meta.imdbRating, SERIES_META.meta.imdbRating);
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
});

await checkAsync('GET /meta/movie/tt0111161.json -> 劇情', async () => {
  const response = await call(`/meta/movie/tt0111161.json?upstream=${encoded}`);
  const body = await response.json();
  assert.deepEqual(body.meta.genres, ['劇情']);
});

await checkAsync('ids with colons survive the regex match', async () => {
  await call(`/meta/series/tt0388629:1:2.json?upstream=${encoded}`);
  assert.equal(
    seen.at(-1),
    'https://v3-cinemeta.strem.io/meta/series/tt0388629:1:2.json',
  );
});

await checkAsync('missing ?upstream= -> 400 with a hint', async () => {
  const response = await call('/manifest.json');
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.match(body.error, /upstream/);
  assert.ok(body.hint);
});

await checkAsync('upstream failure status is passed through', async () => {
  const response = await call(`/meta/movie/tt9999999.json?upstream=${encoded}`);
  assert.equal(response.status, 404);
});

await checkAsync('unsupported path -> 404', async () => {
  const response = await call(`/catalog/movie/top.json?upstream=${encoded}`);
  assert.equal(response.status, 404);
});

await checkAsync('english=0 leaves English genres as English', async () => {
  const response = await call(`/meta/series/tt0388629.json?upstream=${encoded}&english=0`);
  const body = await response.json();
  assert.deepEqual(body.meta.genres, ['Animation', 'Action', 'Adventure']);
});

/* -------------------------------------------------------------------- report */

for (const result of results) {
  console.log(`${result.ok ? 'ok  ' : 'FAIL'}  ${result.name}${result.ok ? '' : `\n      ${result.message}`}`);
}

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
