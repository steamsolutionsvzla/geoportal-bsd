// admin-catalogo.js
// Catálogo completo GeoServer ↔ PostGIS para el panel gerencial:
// estado de publicación (encender/apagar), registros y filtro por zona.
import { apiFetch } from './utils.js';

const fmt = (n) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('es'));

const state = {
  catalog: null,
  zone: null,          // { counts: {id: n}, label }
  radioKm: 15,
  confirm: null,       // { id, name, enabled }
};

function $(id) {
  return document.getElementById(id);
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const TIPO = {
  fill: 'polígono', circle: 'punto', point: 'punto', line: 'línea', raster: 'ráster',
};

function setStatus(text, isError = false) {
  const el = $('cat-status');
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('is-error', isError);
}

function estadoBadge(capa) {
  if (capa.enabled === null || capa.enabled === undefined) {
    return '<span class="badge gray">—</span>';
  }
  return capa.enabled
    ? '<span class="badge green">publicada</span>'
    : '<span class="badge red">desactivada</span>';
}

function tablaBadge(capa) {
  if (capa.type === 'raster') return '<span class="badge gray">ráster</span>';
  if (!capa.table_present) return '<span class="badge amber">sin datos</span>';
  return `<code class="cat-src">${esc(capa.table)}</code>`;
}

function filaCapa(capa) {
  const enZona = state.zone ? state.zone.counts[capa.id] : null;
  const switchEl = capa.type === 'raster'
    ? '<span class="cat-na" title="Ráster: el cambio de publicación no está soportado">—</span>'
    : `<button type="button" class="cat-switch${capa.enabled ? ' on' : ''}"
         data-id="${esc(capa.id)}" data-enabled="${capa.enabled ? '1' : '0'}"
         title="${capa.enabled ? 'Apagar capa (deja de servirse)' : 'Publicar capa'}"
         aria-label="${capa.enabled ? 'Apagar' : 'Publicar'} ${esc(capa.name)}"></button>`;

  return `<tr>
    <td class="cat-name">${esc(capa.name)}</td>
    <td>${tablaBadge(capa)}</td>
    <td class="cat-type">${esc(TIPO[capa.type] || capa.type || '')}</td>
    <td class="cat-num">${fmt(capa.rows)}</td>
    ${state.zone ? `<td class="cat-num${enZona > 0 ? ' cat-hit' : ''}">${fmt(enZona ?? 0)}</td>` : ''}
    <td>${estadoBadge(capa)}</td>
    <td class="cat-action">${switchEl}</td>
  </tr>`;
}

function render() {
  const cont = $('cat-workspaces');
  if (!cont || !state.catalog) return;

  const soloConDatos = $('cat-only')?.checked && state.zone;
  let total = 0;
  const secciones = [];

  state.catalog.workspaces.forEach((ws) => {
    let capas = ws.layers || [];
    if (soloConDatos) {
      capas = capas.filter((c) => (state.zone.counts[c.id] || 0) > 0);
    }
    if (state.zone) {
      capas = [...capas].sort(
        (a, b) => (state.zone.counts[b.id] || 0) - (state.zone.counts[a.id] || 0),
      );
    }
    if (!capas.length) return;
    total += capas.length;

    secciones.push(`
      <section class="cat-ws">
        <header class="cat-ws-head">
          <h3>${esc(ws.name)}</h3>
          <span class="cat-ws-count">${capas.length} capa${capas.length === 1 ? '' : 's'}</span>
        </header>
        <div class="admin-table-wrap">
          <table class="admin-table">
            <thead>
              <tr>
                <th>Capa GeoServer</th>
                <th>Tabla PostGIS</th>
                <th>Tipo</th>
                <th>Registros</th>
                ${state.zone ? '<th>En zona</th>' : ''}
                <th>Estado</th>
                <th>Acción</th>
              </tr>
            </thead>
            <tbody>${capas.map(filaCapa).join('')}</tbody>
          </table>
        </div>
      </section>`);
  });

  cont.innerHTML = secciones.join('') || '<p class="admin-table-empty">Sin capas que mostrar.</p>';
  const resumen = state.zone
    ? `${total} capas · zona «${state.zone.label}»`
    : `${total} capas en el catálogo`;
  setStatus(resumen);
}

async function cargarCatalogo() {
  setStatus('Cargando catálogo de GeoServer…');
  try {
    const res = await apiFetch('/api/v1/admin/catalog');
    if (!res.ok) throw new Error(`Error ${res.status}`);
    state.catalog = await res.json();

    const sel = $('cat-state');
    if (sel) {
      const actual = sel.value;
      sel.innerHTML = '<option value="">Estado…</option>' +
        (state.catalog.states || []).map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
      if (actual) sel.value = actual;
    }
    render();
  } catch (e) {
    setStatus(`No se pudo cargar el catálogo (${e.message})`, true);
  }
}

function parseCoords(texto) {
  const m = String(texto || '').toUpperCase().replace(/[°º]/g, ' ').replace(/,/g, ' ').match(/-?\d+(?:\.\d+)?/g);
  if (!m || m.length < 2) return null;
  let [a, b] = [Number(m[0]), Number(m[1])];
  if (Math.abs(a) > 90 && Math.abs(b) <= 90) [a, b] = [b, a];
  if (Math.abs(a) > 90 || Math.abs(b) > 180) return null;
  return { lat: a, lng: b };
}

async function analizarZona() {
  if (!state.catalog) return;
  const estado = $('cat-state')?.value || '';
  const coords = parseCoords($('cat-coords')?.value || '');

  let body;
  let label;
  if (estado) {
    body = { estado };
    label = estado;
  } else if (coords) {
    body = { lat: coords.lat, lng: coords.lng, radius_km: state.radioKm };
    label = `${coords.lat}, ${coords.lng} · ${state.radioKm || 0} km`;
  } else {
    setStatus('Indica un estado o unas coordenadas para analizar la zona.', true);
    return;
  }

  setStatus('Analizando zona…');
  try {
    const res = await apiFetch('/api/v1/admin/catalog/zone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      let det = `Error ${res.status}`;
      try { det = (await res.json()).detail || det; } catch (_) { /* ignorar */ }
      throw new Error(det);
    }
    const data = await res.json();
    state.zone = { counts: data.counts || {}, label };
    render();
  } catch (e) {
    setStatus(`No se pudo analizar la zona (${e.message})`, true);
  }
}

function limpiarZona() {
  state.zone = null;
  const coords = $('cat-coords');
  if (coords) coords.value = '';
  const sel = $('cat-state');
  if (sel) sel.value = '';
  render();
}

async function cambiarEstado(capa, enabled) {
  try {
    const res = await apiFetch(
      `/api/v1/admin/catalog/${encodeURIComponent(capa.id)}/enabled`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      },
    );
    if (!res.ok) {
      let det = `Error ${res.status}`;
      try { det = (await res.json()).detail || det; } catch (_) { /* ignorar */ }
      throw new Error(det);
    }
    capa.enabled = enabled;
    render();
  } catch (e) {
    setStatus(`No se pudo cambiar el estado de «${capa.name}» (${e.message})`, true);
  }
}

function abrirConfirm(capa) {
  const modal = $('cat-confirm');
  if (!modal) return;
  state.confirm = capa;
  $('cat-confirm-name').textContent = capa.name;
  modal.hidden = false;
}

function cerrarConfirm() {
  const modal = $('cat-confirm');
  if (modal) modal.hidden = true;
  state.confirm = null;
}

function init() {
  if (!$('cat-workspaces')) return;

  $('cat-analyze')?.addEventListener('click', analizarZona);
  $('cat-clear')?.addEventListener('click', limpiarZona);
  $('cat-only')?.addEventListener('change', render);
  $('cat-coords')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); analizarZona(); }
  });
  $('cat-state')?.addEventListener('change', () => {
    if ($('cat-state').value) analizarZona();
  });
  document.querySelectorAll('.cat-radius .cat-chip[data-km]').forEach((chip) => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.cat-radius .cat-chip').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      state.radioKm = Number(chip.dataset.km) || 0;
    });
  });

  $('cat-workspaces')?.addEventListener('click', (e) => {
    const sw = e.target.closest('.cat-switch[data-id]');
    if (!sw) return;
    const capa = findCapa(sw.dataset.id);
    if (!capa) return;
    if (capa.enabled) abrirConfirm(capa);
    else cambiarEstado(capa, true);
  });

  $('cat-confirm-cancel')?.addEventListener('click', cerrarConfirm);
  $('cat-confirm-ok')?.addEventListener('click', () => {
    const capa = state.confirm;
    cerrarConfirm();
    if (capa) cambiarEstado(capa, false);
  });
  $('cat-confirm')?.addEventListener('click', (e) => {
    if (e.target === $('cat-confirm')) cerrarConfirm();
  });

  cargarCatalogo();
}

function findCapa(id) {
  for (const ws of state.catalog?.workspaces || []) {
    const found = (ws.layers || []).find((l) => l.id === id);
    if (found) return found;
  }
  return null;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
