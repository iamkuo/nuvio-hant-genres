/**
 * HTTP host for the `nuvio-hant-genres` addon.
 *
 * `worker.js` is deliberately host-agnostic and is deployed byte-for-byte as
 * supplied: it takes a standard `Request` and returns a `Response`. This file is
 * the only host-specific code — it turns a Node `IncomingMessage` into a
 * `Request`, calls `handleRequest`, writes the `Response` back out, and records
 * one structured log line per request so the deployed service can be observed
 * from the platform log viewer. No dependencies, no storage, no secrets.
 *
 * The service is private plumbing for one person's media client: it is excluded
 * from search engines both by `X-Robots-Tag` on every response (which also covers
 * the JSON endpoints, where an HTML `<meta>` tag cannot be used) and by the
 * `robots.txt` document below, which the platform gateway prefers over its
 * generated default.
 *
 * Published routes:
 *   GET /manifest.json                 the addon manifest
 *   GET /meta/{type}/{id}.json         proxied + genre-converted metadata
 *   GET /robots.txt                    crawler exclusion
 *   GET /manus-routes.json             platform page-route manifest
 *   GET /api/health                    deployment health probe
 */

import { createServer } from 'node:http';
import { handleRequest } from './worker.js';

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? '0.0.0.0';

/** Applies to JSON endpoints too, where a `<meta name="robots">` tag cannot be used. */
const NO_INDEX = 'noindex, nofollow, noarchive, nosnippet, noimageindex';

/** Served for `/robots.txt`; the gateway prefers this over its generated default. */
const ROBOTS_TXT = ['User-agent: *', 'Disallow: /', ''].join('\n');

/** No user-facing pages exist, so the platform page-route set is empty. */
const ROUTE_MANIFEST = { routes: [] };

const HEALTH = { status: 'ok', addon: 'com.hant.genres.proxy', version: '1.0.0' };

function noIndex(headers) {
  return { ...headers, 'x-robots-tag': NO_INDEX };
}

function sendJson(response, status, body) {
  const payload = Buffer.from(JSON.stringify(body));
  response.writeHead(
    status,
    noIndex({
      'content-type': 'application/json; charset=utf-8',
      'content-length': payload.length,
      'access-control-allow-origin': '*',
      'cache-control': 'no-store',
    }),
  );
  response.end(payload);
}

function sendText(response, status, text) {
  const payload = Buffer.from(text);
  response.writeHead(
    status,
    noIndex({
      'content-type': 'text/plain; charset=utf-8',
      'content-length': payload.length,
      'cache-control': 'public, max-age=86400',
    }),
  );
  response.end(payload);
}

/**
 * The upstream addon URL travels in the query string and may carry a password,
 * so the query string is never logged. Only the upstream host is recorded.
 */
function upstreamHostOf(requestUrl) {
  const raw = requestUrl.searchParams.get('upstream');
  if (!raw) return 'none';
  try {
    return new URL(raw).host;
  } catch {
    return 'invalid';
  }
}

function clip(value, max = 120) {
  if (typeof value !== 'string') return value;
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

/**
 * Describes what the addon actually answered, so a client's behaviour can be
 * compared against the metadata it was served.
 */
function describePayload(pathname, body) {
  if (!pathname.startsWith('/meta/')) return '';
  try {
    const meta = JSON.parse(body.toString('utf8'))?.meta;
    if (!meta || typeof meta !== 'object') return ' meta=<none>';
    const genres = Array.isArray(meta.genres) ? JSON.stringify(meta.genres) : String(meta.genres);
    return ` name="${clip(meta.name)}" genres=${genres}`;
  } catch {
    return ' meta=<unparseable>';
  }
}

const server = createServer(async (request, response) => {
  const startedAt = Date.now();
  try {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    // Host-owned endpoints that never reach the addon.
    if (path === '/robots.txt') {
      sendText(response, 200, ROBOTS_TXT);
      return;
    }
    if (path === '/api/health') {
      sendJson(response, 200, HEALTH);
      return;
    }
    if (path === '/manus-routes.json') {
      sendJson(response, 200, ROUTE_MANIFEST);
      return;
    }

    const addonRequest = new Request(url, {
      method: request.method ?? 'GET',
      headers: { accept: request.headers.accept ?? 'application/json' },
    });
    const addonResponse = await handleRequest(addonRequest);

    const headers = {};
    for (const [key, value] of addonResponse.headers) headers[key] = value;
    const body = Buffer.from(await addonResponse.arrayBuffer());

    console.log(
      `[req] ${request.method ?? 'GET'} ${path} -> ${addonResponse.status}` +
        ` upstream=${upstreamHostOf(url)} ${Date.now() - startedAt}ms` +
        describePayload(path, body),
    );

    response.writeHead(
      addonResponse.status,
      noIndex({ ...headers, 'content-length': body.length }),
    );
    response.end(body);
  } catch (error) {
    // Never leak a stack trace to the phone; the addon itself only ever needs
    // to fail closed so Nuvio falls back to the next addon.
    console.log(`[req] failed ${Date.now() - startedAt}ms error=${String(error)}`);
    sendJson(response, 500, { error: 'internal error', message: String(error) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`hant-genres addon listening on http://${HOST}:${PORT}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
