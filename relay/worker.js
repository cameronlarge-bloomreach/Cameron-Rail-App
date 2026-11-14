// Right Time relay — a tiny Cloudflare Worker (free plan) that lets the app read
// Realtime Trains data from an iPhone.
//
// Why it's needed: the Realtime Trains API needs a login and doesn't allow
// direct calls from web pages. This relay keeps the login secret and only
// forwards the two read-only requests the app uses.
//
// Setup: see README.md → "Set up the relay". You add two secrets to the Worker:
//   RTT_USERNAME  and  RTT_PASSWORD   (from https://api.rtt.io)
//
// Endpoints:
//   GET /search/{CRS}[/{yyyy}/{mm}/{dd}[/{hhmm}]]   departures from a station
//   GET /service/{serviceUid}/{yyyy}/{mm}/{dd}      one train's calling points
//   GET /ping                                       health check

const UPSTREAM = 'https://api.rtt.io/api/v1/json';
const ALLOWED = [
  /^\/search\/[A-Z]{3}(\/\d{4}\/\d{2}\/\d{2}(\/\d{4})?)?$/,
  /^\/service\/[A-Z0-9]{5,7}\/\d{4}\/\d{2}\/\d{2}$/,
];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

function reply(body, status = 200, extra = {}) {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS, ...extra },
  });
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (request.method !== 'GET') return reply('{"error":"method not allowed"}', 405);

    const path = new URL(request.url).pathname.replace(/\/+$/, '').toUpperCase()
      .replace(/^\/SEARCH/, '/search').replace(/^\/SERVICE/, '/service').replace(/^\/PING/, '/ping');

    if (path === '/ping') {
      const ok = Boolean(env.RTT_USERNAME && env.RTT_PASSWORD);
      return reply(JSON.stringify({ ok, app: 'right-time-relay' }), ok ? 200 : 500);
    }
    if (!ALLOWED.some(re => re.test(path))) return reply('{"error":"not found"}', 404);
    if (!env.RTT_USERNAME || !env.RTT_PASSWORD) {
      return reply('{"error":"relay has no Realtime Trains login set"}', 500);
    }

    // Short edge cache so two phones watching the same train share one lookup.
    const cache = caches.default;
    const cacheKey = new Request('https://relay.cache' + path);
    const hit = await cache.match(cacheKey);
    if (hit) return hit;

    const auth = 'Basic ' + btoa(`${env.RTT_USERNAME}:${env.RTT_PASSWORD}`);
    let upstream;
    try {
      upstream = await fetch(UPSTREAM + path, { headers: { Authorization: auth, Accept: 'application/json' } });
    } catch {
      return reply('{"error":"could not reach Realtime Trains"}', 502);
    }
    const body = await upstream.text();
    const res = reply(body, upstream.status, { 'Cache-Control': 'public, max-age=20' });
    if (upstream.ok) ctx.waitUntil(cache.put(cacheKey, res.clone()));
    return res;
  },
};
