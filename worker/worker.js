// Cloudflare Worker : fait le lien entre la page (GitHub Pages) et l'API IVAO.
// La cle d'API IVAO reste ici, cote serveur (secret Cloudflare), jamais dans le navigateur.
//
// Deploiement : voir le README a la racine du projet.

const IVAO_API = 'https://api.ivao.aero/v2';
const CACHE_TTL = 600; // secondes : on evite de refaire tout l'historique a chaque clic

// Origine(s) autorisee(s) a appeler ce worker. Mets l'adresse de ta page GitHub Pages ici,
// ou '*' pendant les tests (moins strict, mais sans risque puisque la cle reste cachee).
const ALLOWED_ORIGIN = '*';

function cors(resp) {
  const h = new Headers(resp.headers);
  h.set('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  h.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  h.set('Access-Control-Allow-Headers', 'Content-Type');
  return new Response(resp.body, { status: resp.status, headers: h });
}

async function ivaoFetch(path, env) {
  const r = await fetch(IVAO_API + path, { headers: { apiKey: env.IVAO_API_KEY } });
  if (!r.ok) throw { status: r.status, message: await r.text().catch(() => r.statusText) };
  return r.json();
}

// Indicatif -> terrain (OACI) + position. Ex. "LFBD_TWR" -> {airport:"LFBD", position:"TWR"}.
// "LFBD_N_APP" -> {airport:"LFBD", position:"N_APP"}. Un indicatif sans code OACI en tete
// (ex. "BORDEAUX_CTR") est classe a part, dans "centers".
function parseCallsign(callsign) {
  const parts = callsign.split('_');
  const first = parts[0];
  if (/^[A-Z]{4}$/.test(first) && parts.length > 1) {
    return { airport: first, position: parts.slice(1).join('_') };
  }
  return { center: callsign };
}

function durationSeconds(session, now) {
  const start = new Date(session.createdAt).getTime();
  const end = session.completedAt ? new Date(session.completedAt).getTime() : now;
  return Math.max(0, Math.round((end - start) / 1000));
}

async function fetchAllSessions(vid, env) {
  const now = Date.now();
  let page = 1;
  const all = [];
  for (;;) {
    const data = await ivaoFetch(`/tracker/sessions?userId=${vid}&connectionType=ATC&perPage=100&page=${page}`, env);
    const items = data.items || data.data || [];
    all.push(...items);
    const hasMore = items.length === 100 && (data.totalPages ? page < data.totalPages : true);
    if (!hasMore || items.length === 0) break;
    page++;
    if (page > 50) break; // garde-fou : 5000 sessions, largement suffisant
  }
  return all.map((s) => ({ ...s, seconds: durationSeconds(s, now) }));
}

function aggregate(sessions) {
  const airports = {}; // { LFBD: { total, positions: { TWR: n, GND: n } } }
  const centers = {}; // { BORDEAUX_CTR: n }
  for (const s of sessions) {
    const parsed = parseCallsign(s.callsign);
    if (parsed.airport) {
      const a = (airports[parsed.airport] ||= { total: 0, positions: {} });
      a.total += s.seconds;
      a.positions[parsed.position] = (a.positions[parsed.position] || 0) + s.seconds;
    } else {
      centers[parsed.center] = (centers[parsed.center] || 0) + s.seconds;
    }
  }
  return { airports, centers };
}

async function handleStats(vid, env) {
  const cacheKey = new Request(`https://cache.internal/stats/${vid}`);
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const [user, sessions] = await Promise.all([
    ivaoFetch(`/users/${vid}`, env),
    fetchAllSessions(vid, env),
  ]);

  const hoursByType = {};
  for (const h of user.hours || []) hoursByType[h.type] = h.hours; // deja en secondes

  const { airports, centers } = aggregate(sessions);
  const dates = sessions.map((s) => s.createdAt).sort();
  const oldestSession = dates[0] || null;
  const newestSession = dates[dates.length - 1] || null;

  const body = JSON.stringify({
    vid,
    division: user.divisionId,
    rating: user.rating,
    hoursByType,
    atcHoursFromSessions: sessions.reduce((s, x) => s + x.seconds, 0),
    airports,
    centers,
    sessionCount: sessions.length,
    oldestSession,
    newestSession,
  });

  const resp = new Response(body, { headers: { 'Content-Type': 'application/json' } });
  resp.headers.set('Cache-Control', `public, max-age=${CACHE_TTL}`);
  await cache.put(cacheKey, resp.clone());
  return resp;
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return cors(new Response(null, { status: 204 }));

    const url = new URL(request.url);
    if (url.pathname !== '/api/stats') return cors(new Response('Not found', { status: 404 }));

    const vid = (url.searchParams.get('vid') || '').trim();
    if (!/^\d{5,7}$/.test(vid)) {
      return cors(new Response(JSON.stringify({ error: 'VID invalide (5 à 7 chiffres attendus).' }), { status: 400, headers: { 'Content-Type': 'application/json' } }));
    }

    try {
      const resp = await handleStats(vid, env);
      return cors(resp);
    } catch (e) {
      console.error('stats error', e && e.status, e && e.message, e && e.stack);
      const status = e && e.status ? e.status : 502;
      const message = status === 404 ? 'VID introuvable sur IVAO.' : "Erreur en contactant l'API IVAO.";
      return cors(new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } }));
    }
  },
};
