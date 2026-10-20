const API_BASE = 'https://ivao-stats-proxy.quentinrault0.workers.dev';

const $ = (id) => document.getElementById(id);
const fmt = (seconds) => {
  const h = Math.floor(seconds / 3600), m = Math.round((seconds % 3600) / 60);
  return `${h}h${String(m).padStart(2, '0')}`;
};

const dateFmt = (iso) => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

function renderCoverage(data) {
  const el = $('coverage');
  if (!data.oldestSession) { el.textContent = ''; return; }
  el.textContent = `Détail par terrain basé sur les sessions du ${dateFmt(data.oldestSession)} au ${dateFmt(data.newestSession)} (l'API IVAO ne conserve pas tout l'historique).`;
}

function renderTotals(data) {
  const types = { pilot: 'Pilote', atc: 'ATC', staff: 'Staff' };
  $('totals').innerHTML = Object.entries(types).map(([k, label]) => `
    <div class="tile"><div class="label">${label}</div><div class="value">${fmt(data.hoursByType[k] || 0)}</div></div>
  `).join('');
}

function renderAirports(data) {
  const entries = Object.entries(data.airports).sort((a, b) => b[1].total - a[1].total);
  $('airports').innerHTML = entries.length
    ? entries.map(([icao, a]) => `
      <div class="card">
        <div class="head"><span>${icao}</span><span>${fmt(a.total)}</span></div>
        <div class="positions">${Object.entries(a.positions).sort((x, y) => y[1] - x[1])
          .map(([pos, s]) => `<span class="pos">${pos} · ${fmt(s)}</span>`).join('')}</div>
      </div>`).join('')
    : '<p class="hint">Aucune session ATC trouvée pour ce VID.</p>';
}

function renderCenters(data) {
  const entries = Object.entries(data.centers || {});
  $('centersSection').hidden = entries.length === 0;
  $('centers').innerHTML = entries.sort((a, b) => b[1] - a[1])
    .map(([name, s]) => `<div class="card"><div class="head"><span>${name}</span><span>${fmt(s)}</span></div></div>`).join('');
}

async function search(vid) {
  const state = $('state');
  state.className = ''; state.textContent = 'Recherche…';
  $('result').hidden = true;
  try {
    const r = await fetch(`${API_BASE}/api/stats?vid=${encodeURIComponent(vid)}`);
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Erreur inconnue.');
    renderCoverage(data);
    renderTotals(data);
    renderAirports(data);
    renderCenters(data);
    state.textContent = '';
    $('result').hidden = false;
  } catch (e) {
    state.className = 'error';
    state.textContent = e.message || 'Impossible de récupérer les statistiques.';
  }
}

$('form').addEventListener('submit', (e) => {
  e.preventDefault();
  const vid = $('vid').value.trim();
  if (/^\d{5,7}$/.test(vid)) search(vid);
  else { $('state').className = 'error'; $('state').textContent = 'VID invalide (5 à 7 chiffres).'; }
});
