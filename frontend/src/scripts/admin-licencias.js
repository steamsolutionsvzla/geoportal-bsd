// admin-licencias.js
// Tabla de atributos de la capa de licencias configurada para el panel
// gerencial: filtros, búsqueda, orden por columna y ficha por registro.
import { apiFetch } from './utils.js';

const ENDPOINT = '/api/v1/manager/licenses';

const state = {
  all: [],
  filtered: [],
  sortKey: 'codigo',
  sortDir: 'asc',
  selected: null,
};

function $(id) {
  return document.getElementById(id);
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function formatArea(value) {
  if (value === null || value === undefined) return '—';
  return Number(value).toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function badgeFor(value, kind) {
  const text = String(value ?? '—');
  let cls = 'gray';
  if (kind === 'tipo') cls = text === 'GAS' ? 'green' : text === 'CRUDO' ? 'blue' : 'gray';
  if (kind === 'estatus') cls = text === 'VIGENTE' ? 'green' : text === 'CULMINADA' ? 'red' : 'amber';
  return `<span class="badge ${cls}">${esc(text)}</span>`;
}

function setStatus(text, isError = false) {
  const el = $('lic-page-status');
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('is-error', isError);
}

/* ------------------------------------------------------------------ */
/* Filtros (los de la URL mandan al llegar desde el dashboard)         */
/* ------------------------------------------------------------------ */
const FILTERS = [
  ['empresa', 'lic-filter-empresa'],
  ['tipo', 'lic-filter-tipo'],
  ['estatus', 'lic-filter-estatus'],
  ['anio', 'lic-filter-anio'],
];

function populateFilters() {
  FILTERS.forEach(([key, id]) => {
    const select = $(id);
    if (!select) return;
    const values = [...new Set(state.all
      .map((f) => f.properties?.[key])
      .filter((v) => v !== null && v !== undefined && v !== ''))]
      .sort((a, b) => String(a).localeCompare(String(b), 'es', { numeric: true }));
    const current = select.value;
    select.innerHTML = `<option value="">Todos</option>` +
      values.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
    select.value = current;
  });

  // Sembrar desde la URL
  const params = new URLSearchParams(location.search);
  FILTERS.forEach(([key, id]) => {
    const value = params.get(key);
    if (value) {
      const select = $(id);
      if (select) select.value = value;
    }
  });
}

function countryLower(v) {
  return String(v ?? '').toLocaleLowerCase('es');
}

function applyFilters() {
  const values = {};
  FILTERS.forEach(([key, id]) => { values[key] = $(id)?.value || ''; });
  const query = countryLower($('lic-page-search')?.value || '');

  state.filtered = state.all.filter((feature) => {
    const p = feature.properties || {};
    for (const [key] of FILTERS) {
      const wanted = values[key];
      if (wanted && String(p[key] ?? '') !== wanted) return false;
    }
    if (query) {
      const haystack = [p.codigo, p.bloque, p.empresa, p.tipo, p.estatus, p.anio, p.duracion]
        .map(countryLower).join(' ');
      if (!haystack.includes(query)) return false;
    }
    return true;
  });

  render();
}

/* ------------------------------------------------------------------ */
/* Tabla                                                               */
/* ------------------------------------------------------------------ */
function sortValue(feature, key) {
  const value = feature.properties?.[key];
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  return String(value).toLocaleLowerCase('es');
}

function rowsSorted() {
  const rows = [...state.filtered];
  rows.sort((a, b) => {
    const av = sortValue(a, state.sortKey);
    const bv = sortValue(b, state.sortKey);
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    let comparison;
    if (typeof av === 'number' && typeof bv === 'number') comparison = av - bv;
    else comparison = String(av).localeCompare(String(bv), 'es', { numeric: true });
    return state.sortDir === 'asc' ? comparison : -comparison;
  });
  return rows;
}

function render() {
  const body = $('lic-table-body');
  if (!body) return;
  const rows = rowsSorted();

  const count = $('lic-table-count');
  if (count) {
    count.textContent = `${rows.length} de ${state.all.length} licencias`;
  }

  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="8" class="manager-empty">No hay licencias con los filtros seleccionados.</td></tr>';
    return;
  }

  body.innerHTML = rows.map((feature) => {
    const p = feature.properties || {};
    return `<tr data-codigo="${esc(p.codigo)}" title="Ver todos los atributos">
      <td><strong>${esc(p.codigo ?? '—')}</strong></td>
      <td>${esc(p.bloque ?? '—')}</td>
      <td>${esc(p.empresa ?? '—')}</td>
      <td>${badgeFor(p.tipo, 'tipo')}</td>
      <td>${badgeFor(p.estatus, 'estatus')}</td>
      <td class="year-cell">${esc(p.anio ?? '—')}</td>
      <td>${esc(p.duracion ?? '—')}</td>
      <td class="area-cell">${esc(formatArea(p.area_km2))}</td>
    </tr>`;
  }).join('');

  document.querySelectorAll('#lic-table th[data-sort]').forEach((th) => {
    const active = th.getAttribute('data-sort') === state.sortKey;
    th.setAttribute('data-dir', active ? state.sortDir : '');
  });
}

/* ------------------------------------------------------------------ */
/* Ficha del registro                                                  */
/* ------------------------------------------------------------------ */
function abrirFicha(codigo) {
  const feature = state.all.find((f) => String(f.properties?.codigo) === String(codigo));
  const modal = $('lic-attr-modal');
  if (!feature || !modal) return;
  const p = feature.properties || {};
  state.selected = codigo;

  const filas = [
    ['Código', p.codigo],
    ['Licencia', p.bloque],
    ['Empresa', p.empresa],
    ['Tipo', p.tipo],
    ['Estatus', p.estatus],
    ['Año', p.anio],
    ['Duración', p.duracion],
    ['Duración (años)', p.duracion_anios],
    ['Área (ha)', p.area_ha],
    ['Área (km²)', p.area_km2 !== null && p.area_km2 !== undefined ? formatArea(p.area_km2) : null],
  ];

  $('lic-attr-title').textContent = `Licencia ${p.bloque ?? p.codigo ?? ''}`;
  $('lic-attr-sub').textContent = p.codigo ?? '';
  $('lic-attr-body').innerHTML = filas.map(([label, value]) => `
    <div class="lic-attr-row">
      <span>${esc(label)}</span>
      <strong>${esc(value ?? '—')}</strong>
    </div>`).join('');
  $('lic-attr-map').setAttribute('href', `/admin/?codigo=${encodeURIComponent(codigo)}#licencias`);
  modal.hidden = false;
}

function cerrarFicha() {
  const modal = $('lic-attr-modal');
  if (modal) modal.hidden = true;
  state.selected = null;
}

/* ------------------------------------------------------------------ */
/* Carga                                                               */
/* ------------------------------------------------------------------ */
async function cargar() {
  setStatus('Cargando licencias…');
  try {
    const res = await apiFetch(ENDPOINT);
    if (res.status === 403) throw new Error('Tu rol no tiene acceso al panel gerencial.');
    if (!res.ok) throw new Error(`Error ${res.status}`);
    const data = await res.json();
    state.all = Array.isArray(data.features) ? data.features : [];
    populateFilters();
    applyFilters();
    setStatus(`${state.all.length} licencias · capa ${data.layer || ''}`);
  } catch (e) {
    setStatus(`No se pudieron cargar las licencias (${e.message})`, true);
    const body = $('lic-table-body');
    if (body) body.innerHTML = `<tr><td colspan="8" class="manager-empty">${esc(e.message)}</td></tr>`;
  }
}

function init() {
  if (!$('lic-table-body')) return;

  FILTERS.forEach(([, id]) => $(id)?.addEventListener('change', applyFilters));
  $('lic-page-search')?.addEventListener('input', applyFilters);
  $('lic-clear')?.addEventListener('click', () => {
    FILTERS.forEach(([, id]) => { const el = $(id); if (el) el.value = ''; });
    const search = $('lic-page-search');
    if (search) search.value = '';
    applyFilters();
  });

  document.querySelectorAll('#lic-table th[data-sort]').forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.getAttribute('data-sort');
      if (!key) return;
      if (state.sortKey === key) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
      else { state.sortKey = key; state.sortDir = 'asc'; }
      render();
    });
  });

  $('lic-table-body')?.addEventListener('click', (e) => {
    const row = e.target.closest('tr[data-codigo]');
    if (row) abrirFicha(row.getAttribute('data-codigo'));
  });

  $('lic-attr-close')?.addEventListener('click', cerrarFicha);
  $('lic-attr-modal')?.addEventListener('click', (e) => {
    if (e.target === $('lic-attr-modal')) cerrarFicha();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('lic-attr-modal')?.hidden) cerrarFicha();
  });

  cargar();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
