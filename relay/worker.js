// Right Time relay: a small Cloudflare Worker (free plan) that lets the app read
// Realtime Trains data from an iPhone.
//
// Why it's needed: Realtime Trains requires that API tokens are never put inside
// an app. Apps must call through a server that keeps the token secret. This
// relay does exactly that, and only forwards the read-only requests the app
// uses.
//
// API: Realtime Trains "next generation" API, https://data.rtt.io
// Spec: https://github.com/realtimetrains/api-specification
//
// Setup (see README.md → "Set up the relay"): add ONE secret to the Worker,
// whichever kind the RTT API portal (https://api-portal.rtt.io) gave you:
//   RTT_REFRESH_TOKEN  a long-life refresh token (most personal accounts), or
//   RTT_ACCESS_TOKEN   a long-life access token (then also set the plain
//                      variable RTT_DETAILED=true if your plan includes
//                      detailed mode)
//
// Endpoints the app calls:
//   GET /ping                                     checks the token, lists entitlements
//   GET /location?code=LDS[&timeFrom=…][&filterTo=…]   trains at a station
//   GET /service?uniqueIdentity=gb-nr:P12345:2026-11-14   one train in full
//
// Free API limits are low (October 2026: 10 per minute, 100 per hour, 1000 per
// day), so responses are cached briefly. Two phones watching the same train
// share one lookup, and if the limit is hit the last good answer is returned.

const API = 'https://data.rtt.io';
const FRESH_SECONDS = 45;          // how long a live answer is reused
const STALE_SECONDS = 6 * 3600;    // fallback copy kept for rate-limit / outage

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Expose-Headers': 'X-Relay-Cache, X-Relay-Detailed, X-RateLimit-Remaining-Hour, X-RateLimit-Remaining-Day',
  'Access-Control-Max-Age': '86400',
};

const json = (obj, status = 200, extra = {}) =>
  new Response(typeof obj === 'string' ? obj : JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS, ...extra },
  });

/* ---------- Token handling ---------- */
let memToken = null; // { token, validUntil(ms), detailed }

async function accessToken(env, force = false) {
  if (env.RTT_ACCESS_TOKEN) return { token: env.RTT_ACCESS_TOKEN, detailed: env.RTT_DETAILED === 'true' };
  if (!env.RTT_REFRESH_TOKEN) throw new Error('no-token');
  if (!force && memToken && memToken.validUntil - Date.now() > 60_000) return memToken;

  const cache = caches.default;
  const key = new Request('https://relay.internal/access-token');
  if (!force) {
    const hit = await cache.match(key);
    if (hit) {
      const t = await hit.json();
      if (t.validUntil - Date.now() > 60_000) return (memToken = t);
    }
  }
  const res = await fetch(`${API}/api/get_access_token`, {
    headers: { Authorization: `Bearer ${env.RTT_REFRESH_TOKEN}`, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(res.status === 401 || res.status === 403 ? 'bad-token' : `token-${res.status}`);
  const body = await res.json();
  const validUntil = Date.parse(body.validUntil) || Date.now() + 15 * 60_000;
  const detailed = Array.isArray(body.entitlements) && body.entitlements.includes('allowDetailed');
  memToken = { token: body.token, validUntil, detailed };
  const ttl = Math.max(60, Math.floor((validUntil - Date.now()) / 1000) - 60);
  await cache.put(key, new Response(JSON.stringify(memToken), { headers: { 'Cache-Control': `max-age=${ttl}` } }));
  return memToken;
}

async function callApi(env, path, params) {
  let tok = await accessToken(env);
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') url.searchParams.set(k, v);
  if (tok.detailed && path.startsWith('/gb-nr/')) url.searchParams.set('detailed', 'true');
  let res = await fetch(url, { headers: { Authorization: `Bearer ${tok.token}`, Accept: 'application/json' } });
  if (res.status === 401 && env.RTT_REFRESH_TOKEN) {
    tok = await accessToken(env, true);
    res = await fetch(url, { headers: { Authorization: `Bearer ${tok.token}`, Accept: 'application/json' } });
  }
  return { res, detailed: !!tok.detailed };
}

/* ---------- Request routing ---------- */
const ALLOWED = {
  '/location': {
    upstream: '/gb-nr/location',
    params: { code: /^[A-Za-z0-9]{3,7}$/, timeFrom: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/, filterTo: /^[A-Za-z0-9]{3,7}$/, filterFrom: /^[A-Za-z0-9]{3,7}$/ },
    required: ['code'],
  },
  '/service': {
    upstream: '/gb-nr/service',
    params: { uniqueIdentity: /^[a-z-]+:[A-Za-z0-9]{4,8}:\d{4}-\d{2}-\d{2}$|^[A-Za-z0-9]{4,8}:\d{4}-\d{2}-\d{2}$/ },
    required: ['uniqueIdentity'],
  },
};

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (request.method !== 'GET') return json({ error: 'method not allowed' }, 405);

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (path === '/ping') {
      try {
        const { res, detailed } = await callApi(env, '/api/info', {});
        if (!res.ok) return json({ ok: false, app: 'right-time-relay', error: `rtt-${res.status}` }, 502);
        const info = await res.json();
        return json({ ok: true, app: 'right-time-relay', detailed, apiVersion: info.api_version || null });
      } catch (e) {
        return json({ ok: false, app: 'right-time-relay', error: e.message }, e.message === 'no-token' ? 500 : 502);
      }
    }

    const route = ALLOWED[path];
    if (!route) return json({ error: 'not found' }, 404);
    const params = {};
    for (const [k, re] of Object.entries(route.params)) {
      const v = url.searchParams.get(k);
      if (v == null || v === '') continue;
      if (!re.test(v)) return json({ error: `bad ${k}` }, 400);
      params[k] = k === 'code' || k === 'filterTo' || k === 'filterFrom' ? v.toUpperCase() : v;
    }
    for (const k of route.required) if (!params[k]) return json({ error: `missing ${k}` }, 400);

    // Short shared cache, plus a long-lived stale copy for when RTT says "slow down".
    const cache = caches.default;
    const qs = new URLSearchParams(Object.entries(params).sort()).toString();
    const freshKey = new Request(`https://relay.internal/fresh${path}?${qs}`);
    const staleKey = new Request(`https://relay.internal/stale${path}?${qs}`);
    const fresh = await cache.match(freshKey);
    if (fresh) return withHeaders(fresh, { 'X-Relay-Cache': 'hit' });

    let res, detailed;
    try {
      ({ res, detailed } = await callApi(env, route.upstream, params));
    } catch (e) {
      const stale = await cache.match(staleKey);
      if (stale) return withHeaders(stale, { 'X-Relay-Cache': 'stale' });
      return json({ error: e.message === 'no-token' ? 'relay has no Realtime Trains token set' : 'could not reach Realtime Trains' }, e.message === 'no-token' ? 500 : 502);
    }

    if (res.status === 204) return json({ services: [] }, 200, { 'X-Relay-Detailed': String(detailed) });
    if (res.status === 429 || res.status >= 500) {
      const stale = await cache.match(staleKey);
      if (stale) return withHeaders(stale, { 'X-Relay-Cache': 'stale' });
      return json({ error: res.status === 429 ? 'rate-limited' : 'upstream-error', retryAfter: res.headers.get('Retry-After') }, res.status);
    }
    const body = await res.text();
    const out = json(body, res.status, {
      'X-Relay-Detailed': String(detailed),
      'X-RateLimit-Remaining-Hour': res.headers.get('X-RateLimit-Remaining-Hour') || '',
      'X-RateLimit-Remaining-Day': res.headers.get('X-RateLimit-Remaining-Day') || '',
    });
    if (res.ok) {
      ctx.waitUntil(Promise.all([
        cache.put(freshKey, withHeaders(out.clone(), { 'Cache-Control': `public, max-age=${FRESH_SECONDS}` })),
        cache.put(staleKey, withHeaders(out.clone(), { 'Cache-Control': `public, max-age=${STALE_SECONDS}` })),
      ]));
    }
    return out;
  },
};

function withHeaders(res, extra) {
  const r = new Response(res.body, res);
  for (const [k, v] of Object.entries(extra)) r.headers.set(k, v);
  if (!extra['Cache-Control']) r.headers.set('Cache-Control', 'no-store');
  return r;
}
