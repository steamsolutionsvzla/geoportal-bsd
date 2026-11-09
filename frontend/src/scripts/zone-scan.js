// zone-scan.js
// "Capas por zona": el usuario indica un estado/bloque o unas coordenadas
// (con radio opcional) y se listan las capas con datos en esa zona, con la
// opción de activarlas directamente en el mapa.
import * as turf from '@turf/turf';
import { getMap } from './map-config.js';
import { apiFetch, obtenerNombreEstado, obtenerNombreBloque } from './utils.js';
import { getEstadosCache, getBloquesCache } from './filters.js';
import { getAvailableLayers } from './layer-manager.js';
import { beginBusy, endBusy } from './busy-overlay.js';

const DEFAULT_RADIUS_KM = 15;
const ZONE_SRC = 'source-zone-scan';
const ZONE_FILL = 'layer-zone-scan-fill';
const ZONE_LINE = 'layer-zone-scan-line';
const ZONE_POINT_SRC = 'source-zone-scan-point';
const ZONE_POINT = 'layer-zone-scan-point';

const GEOM_LABEL = {
  circle: 'punto', point: 'punto', fill: 'polígono',
  line: 'línea', raster: 'ráster',
};

let radioKm = DEFAULT_RADIUS_KM;
let ultimoPunto = null;      // {lat, lng}
let scanToken = 0;
let debounceTimer = null;

function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ------------------------------------------------------------------
// Parseo de coordenadas — acepta:
//   10.17, -71.00      ·  10.17 -71.00
//   10.17° N 71.00° W  ·  N 10.17 W 71.00
// ------------------------------------------------------------------
export function parseCoordenadas(texto) {
  if (!texto) return null;
  const t = String(texto).toUpperCase().replace(/[°º]/g, ' ').replace(/,/g, ' ');
  const tokens = [...t.matchAll(/([NSEW])?\s*(-?\d+(?:\.\d+)?)\s*([NSEW])?/g)];
  if (!tokens.length) return null;

  const items = tokens.map((m) => ({
    dir: (m[1] || m[3] || '').toUpperCase() || null,
    value: Number(m[2]),
  })).filter((x) => Number.isFinite(x.value));

  if (!items.length || items.length > 3) return null;

  let lat = null, lng = null;
  if (items.some((x) => x.dir)) {
    for (const it of items) {
      if ((it.dir === 'N' || it.dir === 'S') && lat === null) lat = Math.abs(it.value) * (it.dir === 'S' ? -1 : 1);
      else if ((it.dir === 'E' || it.dir === 'W') && lng === null) lng = Math.abs(it.value) * (it.dir === 'W' ? -1 : 1);
    }
  }
  if (lat === null || lng === null) {
    if (items.length < 2) return null;
    let [a, b] = [items[0].value, items[1].value];
    // Heurística: si el primero no puede ser latitud, se intercambian.
    if (Math.abs(a) > 90 && Math.abs(b) <= 90) [a, b] = [b, a];
    lat = a; lng = b;
  }
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

// ------------------------------------------------------------------
// Geometría de la zona y dibujo en el mapa
// ------------------------------------------------------------------
function geometriaDeZona(lat, lng, km) {
  const centro = [lng, lat];
  // "Punto exacto" → círculo mínimo (~30 m) para que el backend (polígono) lo acepte.
  // turf.circle devuelve un Feature: se envía solo la geometría.
  const radius = km > 0 ? km : 0.03;
  return turf.circle(centro, radius, { units: 'kilometers', steps: 64 }).geometry;
}

function ensureZoneLayers(map) {
  if (!map.getSource(ZONE_SRC)) {
    map.addSource(ZONE_SRC, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
  }
  if (!map.getLayer(ZONE_FILL)) {
    map.addLayer({
      id: ZONE_FILL, type: 'fill', source: ZONE_SRC,
      paint: { 'fill-color': '#2d5296', 'fill-opacity': 0.10 },
    });
  }
  if (!map.getLayer(ZONE_LINE)) {
    map.addLayer({
      id: ZONE_LINE, type: 'line', source: ZONE_SRC,
      paint: { 'line-color': '#2d5296', 'line-width': 1.6, 'line-dasharray': [2, 1.5] },
    });
  }
  if (!map.getSource(ZONE_POINT_SRC)) {
    map.addSource(ZONE_POINT_SRC, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
  }
  if (!map.getLayer(ZONE_POINT)) {
    map.addLayer({
      id: ZONE_POINT, type: 'circle', source: ZONE_POINT_SRC,
      paint: {
        'circle-radius': 5.5,
        'circle-color': '#2d5296',
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 2,
      },
    });
  }
}

function pintarZona(map, polygon, center) {
  ensureZoneLayers(map);
  map.getSource(ZONE_SRC).setData(polygon ? { type: 'Feature', geometry: polygon, properties: {} } : { type: 'FeatureCollection', features: [] });
  map.getSource(ZONE_POINT_SRC).setData(
    center
      ? { type: 'Feature', geometry: { type: 'Point', coordinates: center }, properties: {} }
      : { type: 'FeatureCollection', features: [] },
  );
}

function limpiarZona() {
  const map = getMap();
  if (!map) return;
  pintarZona(map, null, null);
}

// ------------------------------------------------------------------
// Consulta al backend
// ------------------------------------------------------------------
async function consultarZona(geometry) {
  const res = await apiFetch('/api/v1/search/zone', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ geometry }),
  });
  if (!res.ok) {
    let detalle = `Error ${res.status}`;
    try {
      const j = await res.json();
      if (j?.detail) detalle = typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail);
    } catch (_) { /* ignorar */ }
    throw new Error(detalle);
  }
  return res.json();
}

// ------------------------------------------------------------------
// UI
// ------------------------------------------------------------------
function ui() {
  return {
    input: document.getElementById('zoneCoords'),
    goBtn: document.getElementById('zoneGoBtn'),
    error: document.getElementById('zoneError'),
    results: document.getElementById('zoneResults'),
    summary: document.getElementById('zoneSummary'),
    list: document.getElementById('zoneList'),
    activateAll: document.getElementById('zoneActivateAll'),
  };
}

function mostrarError(texto) {
  const { error } = ui();
  if (!error) return;
  error.textContent = texto || '';
  error.hidden = !texto;
}

function abrirFila(tableName) {
  const item = document.querySelector(`#layersGroupsContainer .layer-item[data-table="${CSS.escape(tableName)}"]`);
  if (!item) return null;
  const group = item.closest('.layer-group');
  const list = group?.querySelector('.group-layers');
  if (group && list && !list.classList.contains('open')) {
    group.querySelector('.group-header')?.click();
  }
  item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  item.classList.remove('ls-flash');
  void item.offsetWidth;
  item.classList.add('ls-flash');
  setTimeout(() => item.classList.remove('ls-flash'), 1800);
  return item;
}

function activarCapa(tableName) {
  const toggle = document.querySelector(`#layersGroupsContainer .toggle[data-table="${CSS.escape(tableName)}"]`);
  if (!toggle) return;
  if (!toggle.classList.contains('on')) toggle.click();
  abrirFila(tableName);
  actualizarBotonesActivacion();
}

function actualizarBotonesActivacion() {
  document.querySelectorAll('.zone-activate[data-table]').forEach((btn) => {
    const toggle = document.querySelector(`#layersGroupsContainer .toggle[data-table="${CSS.escape(btn.dataset.table)}"]`);
    const activa = !!toggle?.classList.contains('on');
    btn.classList.toggle('is-active', activa);
    btn.textContent = activa ? 'Activa' : 'Activar';
    btn.disabled = activa;
  });
}

function renderResultados(data) {
  const { results, summary, list, activateAll } = ui();
  if (!results || !list) return;

  const capas = (data?.layers) || [];
  results.hidden = false;
  summary.textContent = capas.length
    ? `${capas.length} capa${capas.length === 1 ? '' : 's'} en la zona`
    : 'Sin capas con datos en esta zona';
  activateAll.disabled = !capas.some((c) => c.count > 0);

  if (!capas.length) {
    list.innerHTML = '<div class="zone-empty">Prueba con un radio mayor o mueve la zona.</div>';
    return;
  }

  const colores = new Map(getAvailableLayers().map((l) => [l.id, l.color]));
  list.innerHTML = capas.map((c) => `
    <div class="zone-layer">
      <span class="zone-dot" style="--c:${escHtml(colores.get(c.id) || '#6fa3e0')}"></span>
      <span class="zone-name" title="${escHtml(c.id)}">${escHtml(c.name)}</span>
      <span class="zone-type">${escHtml(GEOM_LABEL[String(c.type).toLowerCase()] || '')}</span>
      <span class="zone-count">${Number(c.count).toLocaleString('es')}</span>
      <button type="button" class="zone-activate" data-table="${escHtml(c.id)}">Activar</button>
    </div>`).join('');

  actualizarBotonesActivacion();
}

async function escanear({ geometry, center = null, fit = false, dibujar = true }) {
  const map = getMap();
  if (!map || !geometry) return;
  const token = ++scanToken;

  if (dibujar) pintarZona(map, geometry, center);
  if (fit) {
    try { map.fitBounds(turf.bbox(turf.feature(geometry)), { padding: 60, duration: 1200 }); } catch (_) { /* ignorar */ }
  }

  const { results, summary, list } = ui();
  if (results) results.hidden = false;
  if (summary) summary.textContent = 'Buscando capas en la zona…';
  if (list) list.innerHTML = '<div class="zone-empty">Consultando capas…</div>';
  mostrarError('');

  beginBusy('Buscando capas en la zona…');
  try {
    const data = await consultarZona(geometry);
    if (token !== scanToken) return;   // llegó tarde: hay un escaneo más nuevo
    renderResultados(data);
  } catch (e) {
    if (token !== scanToken) return;
    if (summary) summary.textContent = 'No se pudo analizar la zona';
    if (list) list.innerHTML = '';
    mostrarError(String(e.message || e));
  } finally {
    if (token === scanToken) endBusy();
  }
}

function buscarFeature(cache, getter, nombre) {
  return (cache?.features || []).find((f) => {
    const n = getter(f.properties);
    return n && String(n).toLowerCase() === String(nombre).toLowerCase();
  });
}

// ------------------------------------------------------------------
// API pública
// ------------------------------------------------------------------
export function analizarCoordenadas(texto) {
  const coords = parseCoordenadas(texto);
  const { input } = ui();
  if (!coords) {
    mostrarError('Coordenadas no válidas. Usa "lat, lng" (p. ej. 10.17, -71.00).');
    return false;
  }
  if (input) input.value = `${coords.lat}, ${coords.lng}`;
  ultimoPunto = coords;
  mostrarError('');
  const geometry = geometriaDeZona(coords.lat, coords.lng, radioKm);
  escanear({ geometry, center: [coords.lng, coords.lat], fit: true });
  return true;
}

export function initZoneScan() {
  const { input, goBtn, results, list, activateAll } = ui();
  if (!input || !goBtn) return;   // página sin el panel

  const analizarInput = () => {
    const texto = input.value.trim();
    if (!texto) { limpiarZona(); if (results) results.hidden = true; mostrarError(''); ultimoPunto = null; return; }
    analizarCoordenadas(texto);
  };

  goBtn.addEventListener('click', analizarInput);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); analizarInput(); }
    if (e.key === 'Escape') { input.value = ''; analizarInput(); input.blur(); }
  });

  // Radio: punto / 15 / 50 km. Recalcula si ya había un punto.
  document.querySelectorAll('.zone-radius-chip[data-km]').forEach((chip) => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.zone-radius-chip').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      radioKm = Number(chip.dataset.km) || 0;
      if (ultimoPunto) {
        const geometry = geometriaDeZona(ultimoPunto.lat, ultimoPunto.lng, radioKm);
        escanear({ geometry, center: [ultimoPunto.lng, ultimoPunto.lat], fit: true });
      }
    });
  });

  // Activar / activar todas.
  list?.addEventListener('click', (e) => {
    const btn = e.target.closest('.zone-activate');
    if (btn) activarCapa(btn.dataset.table);
  });
  activateAll?.addEventListener('click', () => {
    document.querySelectorAll('.zone-activate:not(.is-active)').forEach((btn) => {
      const toggle = document.querySelector(`#layersGroupsContainer .toggle[data-table="${CSS.escape(btn.dataset.table)}"]`);
      if (toggle && !toggle.classList.contains('on')) toggle.click();
    });
    actualizarBotonesActivacion();
  });

  // Escaneo automático al elegir estado/bloque en los filtros existentes.
  const hookDropdown = (id, cacheGetter, nombreGetter) => {
    const dropdown = document.getElementById(id);
    if (!dropdown) return;
    dropdown.addEventListener('click', (e) => {
      const opt = e.target.closest('.loc-option');
      if (!opt) return;
      const valor = opt.getAttribute('data-value') || '';
      clearTimeout(debounceTimer);
      if (!valor) { limpiarZona(); if (results) results.hidden = true; return; }
      debounceTimer = setTimeout(() => {
        const feature = buscarFeature(cacheGetter(), nombreGetter, valor);
        if (!feature) return;
        if (results) results.hidden = false;
        const { summary } = ui();
        if (summary) summary.textContent = `Analizando «${valor}»…`;
        escanear({ geometry: feature.geometry, center: null, fit: false, dibujar: false });
      }, 150);
    });
  };
  hookDropdown('dropdownEstado', getEstadosCache, obtenerNombreEstado);
  hookDropdown('dropdownBloque', getBloquesCache, obtenerNombreBloque);
}
