// attr-table.js
// Tabla de atributos por capa: vista filtrable y ordenable de los features
// cargados (o descargados bajo demanda), con exportación CSV, enlaces de
// servicio OGC y "volar a la entidad" al hacer clic en una fila.
import '../styles/attr-table.css';
import * as turf from '@turf/turf';
import { getMap } from './map-config.js';
import { apiFetch } from './utils.js';
import {
  getLayerDisplayName, getLayerRawData,
  setLayerRawData, GEOSERVER_WMS_BASE,
} from './layer-manager.js';

const MAX_ROWS = 500;

function norm(texto) {
  return String(texto ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function escAttr(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ---------------------------------------------------------------
// Construcción única del modal
// ---------------------------------------------------------------
let els = null;

function ensureModal() {
  if (els) return els;
  const host = document.createElement('div');
  host.className = 'at-overlay';
  host.hidden = true;
  host.innerHTML = `
    <div class="at-modal" role="dialog" aria-modal="true" aria-labelledby="atTitle">
      <header class="at-head">
        <div class="at-head-text">
          <div class="at-eyebrow">Tabla de atributos</div>
          <h3 class="at-title" id="atTitle">—</h3>
        </div>
        <div class="at-head-actions">
          <span class="at-count" id="atCount"></span>
          <button type="button" class="at-btn" id="atSvcBtn" title="Enlaces de servicio (WMS/WFS/GeoJSON)">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
            <span>Servicios</span>
          </button>
          <button type="button" class="at-btn" id="atCsvBtn" title="Exportar CSV">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v12"/><polyline points="7 13 12 18 17 13"/><path d="M4 20h16"/></svg>
            <span>CSV</span>
          </button>
          <button type="button" class="at-close" id="atCloseBtn" title="Cerrar" aria-label="Cerrar">✕</button>
        </div>
      </header>
      <div class="at-services" id="atServices" hidden></div>
      <div class="at-search">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
        <input type="search" id="atFilter" placeholder="Filtrar registros…" autocomplete="off" aria-label="Filtrar registros" />
      </div>
      <div class="at-table-wrap" id="atTableWrap">
        <table class="at-table"><thead id="atHead"></thead><tbody id="atBody"></tbody></table>
      </div>
      <footer class="at-foot">
        <span id="atNote"></span>
        <span class="at-hint">Clic en una fila para ir a la entidad · Esc para cerrar</span>
      </footer>
    </div>`;
  document.body.appendChild(host);

  els = {
    host,
    title: host.querySelector('#atTitle'),
    count: host.querySelector('#atCount'),
    services: host.querySelector('#atServices'),
    filter: host.querySelector('#atFilter'),
    head: host.querySelector('#atHead'),
    body: host.querySelector('#atBody'),
    note: host.querySelector('#atNote'),
    wrap: host.querySelector('#atTableWrap'),
  };

  host.addEventListener('click', (e) => { if (e.target === host) cerrar(); });
  host.querySelector('#atCloseBtn').addEventListener('click', cerrar);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !host.hidden) cerrar();
  });
  els.filter.addEventListener('input', () => { state.query = norm(els.filter.value); renderTable(); });
  host.querySelector('#atSvcBtn').addEventListener('click', () => {
    els.services.hidden = !els.services.hidden;
  });
  host.querySelector('#atCsvBtn').addEventListener('click', exportarCsv);

  return els;
}

function cerrar() {
  if (!els) return;
  els.host.hidden = true;
}

// ---------------------------------------------------------------
// Estado de la tabla
// ---------------------------------------------------------------
const state = {
  table: null,       // id de la capa
  columns: [],       // nombres de columnas
  rows: [],          // features (orden original)
  view: [],          // filtradas + ordenadas
  query: '',
  sortCol: null,
  sortDir: 1,
};

async function obtenerDatos(tableName) {
  let data = getLayerRawData(tableName);
  if (data) return data;
  const res = await apiFetch(`/api/v1/layers/${encodeURIComponent(tableName)}`);
  if (!res.ok) throw new Error(`Error ${res.status}`);
  data = await res.json();
  setLayerRawData(tableName, data);
  return data;
}

function columnasDe(features) {
  const seen = [];
  const set = new Set();
  for (const f of features.slice(0, 50)) {
    Object.keys(f.properties || {}).forEach((k) => {
      if (!set.has(k) && k !== 'geom' && !k.startsWith('_')) { set.add(k); seen.push(k); }
    });
  }
  return seen;
}

function centroFeature(f) {
  try {
    const [minX, minY, maxX, maxY] = turf.bbox(f);
    return { bbox: [minX, minY, maxX, maxY] };
  } catch (_) {
    return null;
  }
}

function volarARow(idx) {
  const f = state.view[idx];
  const map = getMap();
  if (!f || !map) return;
  const c = centroFeature(f);
  cerrar();
  if (c) {
    map.fitBounds([[c.bbox[0], c.bbox[1]], [c.bbox[2], c.bbox[3]]],
      { padding: 90, maxZoom: 13, duration: 1200 });
  }
}

// ---------------------------------------------------------------
// Render
// ---------------------------------------------------------------
function vistaFiltrada() {
  let rows = state.rows;
  if (state.query) {
    const q = state.query;
    rows = rows.filter((r) => state.columns.some(
      (col) => norm(valorCelula(r, col)).includes(q),
    ));
  }
  if (state.sortCol !== null) {
    const col = state.columns[state.sortCol];
    const dir = state.sortDir;
    rows = [...rows].sort((a, b) => {
      const va = valorCelula(a, col);
      const vb = valorCelula(b, col);
      const na = Number(va), nb = Number(vb);
      if (va !== '' && vb !== '' && Number.isFinite(na) && Number.isFinite(nb)) return (na - nb) * dir;
      return String(va).localeCompare(String(vb), 'es') * dir;
    });
  }
  return rows;
}

function valorCelula(feature, col) {
  const v = feature.properties?.[col];
  if (v === null || v === undefined) return '';
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
}

function renderTable() {
  state.view = vistaFiltrada();

  els.head.innerHTML = `<tr><th class="at-th-num">#</th>${state.columns.map((col, i) => {
    const sorted = state.sortCol === i;
    return `<th class="at-th${sorted ? ' sorted' : ''}${sorted && state.sortDir === -1 ? ' desc' : ''}"
              data-col="${i}" title="${escAttr(col)}">${escAttr(col)}</th>`;
  }).join('')}</tr>`;

  const shown = state.view.slice(0, MAX_ROWS);
  els.body.innerHTML = shown.map((f, r) => {
    return `<tr data-row="${r}"><td class="at-td-num">${r + 1}</td>${state.columns.map((col) => {
      const v = valorCelula(f, col);
      return `<td title="${escAttr(v)}">${escAttr(v)}</td>`;
    }).join('')}</tr>`;
  }).join('');

  els.note.textContent = state.view.length > MAX_ROWS
    ? `Mostrando ${MAX_ROWS} de ${state.view.length} registros — afina el filtro.`
    : (state.query && state.view.length
      ? `${state.view.length} de ${state.rows.length} registros coinciden.`
      : '');
  els.count.textContent = `${state.rows.length} registro${state.rows.length === 1 ? '' : 's'}`;
}

// Delegación: orden por columna + clic en fila.
function bindTableEvents() {
  els.head.addEventListener('click', (e) => {
    const th = e.target.closest('.at-th');
    if (!th) return;
    const col = Number(th.dataset.col);
    if (state.sortCol === col) state.sortDir = -state.sortDir;
    else { state.sortCol = col; state.sortDir = 1; }
    renderTable();
  });
  els.body.addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-row]');
    if (tr) volarARow(Number(tr.dataset.row));
  });
}

// ---------------------------------------------------------------
// Enlaces de servicio
// ---------------------------------------------------------------
function baseAbsoluta() {
  const base = GEOSERVER_WMS_BASE || '/geoserver';
  return base.startsWith('http') ? base : `${window.location.origin}${base}`;
}

function renderServices(tableName) {
  const enc = encodeURIComponent(tableName);
  const filas = [
    ['WMS', `${baseAbsoluta()}/wms?service=WMS&layers=${enc}`],
    ['WFS', `${baseAbsoluta()}/wfs?service=WFS&typeName=${enc}`],
    ['GeoJSON', `${window.location.origin}/api/v1/layers/${enc}`],
  ];
  els.services.innerHTML = filas.map(([etiqueta, url]) => `
    <div class="at-svc-row">
      <span class="at-svc-tag">${etiqueta}</span>
      <code class="at-svc-url">${escAttr(url)}</code>
      <button type="button" class="at-svc-copy" data-url="${escAttr(url)}" title="Copiar enlace">
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
      </button>
    </div>`).join('');
  els.services.hidden = true;
}

// ---------------------------------------------------------------
// CSV
// ---------------------------------------------------------------
function exportarCsv() {
  if (!state.columns.length) return;
  const sep = ',';
  const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const lineas = [state.columns.map(esc).join(sep)];
  state.view.forEach((f) => {
    lineas.push(state.columns.map((c) => esc(valorCelula(f, c))).join(sep));
  });
  const blob = new Blob([`\uFEFF${lineas.join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
  const short = (state.table || 'capa').split(':').pop();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${short}_atributos.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

// ---------------------------------------------------------------
// API pública: enganchar al sidebar
// ---------------------------------------------------------------
export function attachLayerAttrTableEvents(sidebarElement) {
  if (!sidebarElement) return;
  let bound = false;

  sidebarElement.addEventListener('click', async (e) => {
    const btn = e.target.closest('.layer-attr');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();

    const tableName = btn.getAttribute('data-table');
    if (!tableName) return;

    const modal = ensureModal();
    if (!bound) { bindTableEvents(); bound = true; }

    // Portapapeles de los enlaces de servicio (delegación única).
    if (!modal.services.dataset.bound) {
      modal.services.dataset.bound = '1';
      modal.services.addEventListener('click', async (ev) => {
        const cp = ev.target.closest('.at-svc-copy');
        if (!cp) return;
        try { await navigator.clipboard.writeText(cp.dataset.url); cp.classList.add('ok'); }
        catch (_) { /* sin clipboard */ }
        setTimeout(() => cp.classList.remove('ok'), 1200);
      });
    }

    modal.title.textContent = getLayerDisplayName(tableName);
    modal.count.textContent = '…';
    modal.note.textContent = '';
    modal.filter.value = '';
    state.query = '';
    state.sortCol = null;
    state.sortDir = 1;
    state.table = tableName;
    state.rows = [];
    state.columns = [];
    els.head.innerHTML = '';
    els.body.innerHTML = `<tr><td class="at-loading">Cargando atributos…</td></tr>`;
    modal.host.hidden = false;
    renderServices(tableName);

    try {
      const data = await obtenerDatos(tableName);
      const features = (data && data.features) || [];
      state.rows = features;
      state.columns = columnasDe(features);
      if (!state.columns.length) {
        els.body.innerHTML = `<tr><td class="at-loading">Esta capa no expone atributos tabulares.</td></tr>`;
        modal.count.textContent = '0 registros';
        return;
      }
      renderTable();
    } catch (err) {
      els.body.innerHTML = `<tr><td class="at-loading">No se pudieron leer los atributos (${escAttr(err.message || 'error')}).</td></tr>`;
      modal.count.textContent = '—';
    }
  });
}
