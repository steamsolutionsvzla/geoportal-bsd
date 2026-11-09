// zone-scan.js
// Utilidades de "capas por zona" usadas por el buscador de la topbar:
// parseo de coordenadas, geometría de la zona, consulta al backend y
// activación de una capa en el catálogo lateral. Sin UI propia.
import * as turf from '@turf/turf';
import { getMap } from './map-config.js';
import { apiFetch } from './utils.js';

const ZONE_SRC = 'source-zone-scan';
const ZONE_FILL = 'layer-zone-scan-fill';
const ZONE_LINE = 'layer-zone-scan-line';
const ZONE_POINT_SRC = 'source-zone-scan-point';
const ZONE_POINT = 'layer-zone-scan-point';

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
// Geometría de la zona
// ------------------------------------------------------------------
export function geometriaDeZona(lat, lng, km) {
  // "Punto exacto" → círculo mínimo (~30 m) para que el backend (polígono) lo acepte.
  // turf.circle devuelve un Feature: se usa solo la geometría.
  const radius = km > 0 ? km : 0.03;
  return turf.circle([lng, lat], radius, { units: 'kilometers', steps: 64 }).geometry;
}

// ------------------------------------------------------------------
// Dibujo de la zona en el mapa
// ------------------------------------------------------------------
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

export function dibujarZona(geometry, center = null) {
  const map = getMap();
  if (!map || !geometry) return;
  ensureZoneLayers(map);
  map.getSource(ZONE_SRC).setData({
    type: 'Feature', geometry, properties: {},
  });
  map.getSource(ZONE_POINT_SRC).setData(
    center
      ? { type: 'Feature', geometry: { type: 'Point', coordinates: center }, properties: {} }
      : { type: 'FeatureCollection', features: [] },
  );
  try {
    map.fitBounds(turf.bbox(turf.feature(geometry)), { padding: 60, duration: 1200 });
  } catch (_) { /* ignorar */ }
}

export function limpiarZona() {
  const map = getMap();
  if (!map) return;
  if (map.getSource(ZONE_SRC)) map.getSource(ZONE_SRC).setData({ type: 'FeatureCollection', features: [] });
  if (map.getSource(ZONE_POINT_SRC)) map.getSource(ZONE_POINT_SRC).setData({ type: 'FeatureCollection', features: [] });
}

// ------------------------------------------------------------------
// Consulta al backend
// ------------------------------------------------------------------
export async function consultarZona(geometry) {
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
// Catálogo: revelar / activar una capa
// ------------------------------------------------------------------
export function capaActiva(tableName) {
  const toggle = document.querySelector(
    `#layersGroupsContainer .toggle[data-table="${CSS.escape(tableName)}"]`,
  );
  return !!toggle?.classList.contains('on');
}

export function revelarFila(tableName) {
  const item = document.querySelector(
    `#layersGroupsContainer .layer-item[data-table="${CSS.escape(tableName)}"]`,
  );
  if (!item) return null;
  const group = item.closest('.layer-group');
  const list = group?.querySelector('.group-layers');
  if (group && list && !list.classList.contains('open')) {
    group.querySelector('.group-header')?.click();
  }
  item.classList.remove('ls-flash');
  void item.offsetWidth;          // reiniciar la animación
  item.classList.add('ls-flash');
  setTimeout(() => item.classList.remove('ls-flash'), 1800);
  item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  return item;
}

export function activarCapaEnCatalogo(tableName) {
  const toggle = document.querySelector(
    `#layersGroupsContainer .toggle[data-table="${CSS.escape(tableName)}"]`,
  );
  if (!toggle) return false;
  if (!toggle.classList.contains('on')) toggle.click();
  revelarFila(tableName);
  return true;
}
