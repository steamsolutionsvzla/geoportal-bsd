// zone-filter.js
// Zona de recorte activa (Estado o Coordenadas) + máscara visual.
//
// La máscara es un polígono grande con un hueco en forma de la zona activa:
// todo lo que queda fuera de la zona se tapa, pero el mapa base y los
// contornos de referencia siguen visibles. Se mantiene hasta Cancelar.
import * as turf from '@turf/turf';
import { getMap } from './map-config.js';
import { consultarZona, dibujarZona, limpiarZona } from './zone-scan.js';
import { bringVenezuelaBoundaryToFront } from './venezuela-boundary.js';
import { bringCountryLabelsToFront } from './map-labels.js';
import { bringAreaToFront } from './area-temporal.js';
import { setInfoPanelData, renderInfoPanel } from './info-panel.js';

const MASK_SRC = 'source-zone-mask';
const MASK_LAYER = 'layer-zone-mask';
// Caja que cubre Venezuela y el Caribe cercano; la zona siempre queda dentro.
const OUTER_RING = [
  [-84, -6], [-48, -6], [-48, 23], [-84, 23], [-84, -6],
];

const LISTENERS = new Set();
let activeZone = null;
let zoneToken = 0;

function emit() {
  LISTENERS.forEach((fn) => {
    try { fn(activeZone); } catch (error) { console.error(error); }
  });
}

export function onZoneChange(fn) {
  if (typeof fn !== 'function') return () => {};
  LISTENERS.add(fn);
  return () => LISTENERS.delete(fn);
}

export function getZonaActiva() {
  return activeZone;
}

export function isInsideActiveZone(lngLat) {
  if (!activeZone?.geometry || !lngLat) return true;
  try {
    return turf.booleanPointInPolygon(
      turf.point([lngLat.lng, lngLat.lat]),
      turf.feature(activeZone.geometry),
    );
  } catch (_) {
    return true;
  }
}

// ---------------------------------------------------------------------------
// Capas del catálogo
// ---------------------------------------------------------------------------
function idsCapasActivas() {
  return [...document.querySelectorAll('#layersGroupsContainer .toggle.on[data-table]')]
    .map((t) => t.getAttribute('data-table'))
    .filter(Boolean);
}

function setCapaActiva(tableName, activar) {
  const toggle = document.querySelector(
    `#layersGroupsContainer .toggle[data-table="${CSS.escape(tableName)}"]`,
  );
  if (!toggle) return;
  const encendida = toggle.classList.contains('on');
  if (activar && !encendida) toggle.click();
  else if (!activar && encendida) toggle.click();
}

function ajustarCapas(objetivoIds) {
  const objetivo = new Set(objetivoIds || []);
  // Apagar lo que no está en el objetivo y encender lo que falta.
  // Los ráster se conservan: son fondos globales, no capas de la zona.
  document.querySelectorAll('#layersGroupsContainer .toggle.on[data-table]').forEach((toggle) => {
    const id = toggle.getAttribute('data-table');
    const item = toggle.closest('.layer-item');
    if (item?.getAttribute('data-geom') === 'raster') return;
    if (!objetivo.has(id)) toggle.click();
  });
  objetivo.forEach((id) => setCapaActiva(id, true));
}

// ---------------------------------------------------------------------------
// Máscara
// ---------------------------------------------------------------------------
function esSatelite(map) {
  const layer = map.getLayer('satelite-layer');
  if (!layer) return false;
  return map.getLayoutProperty('satelite-layer', 'visibility') !== 'none';
}

function colorMascara(map) {
  return esSatelite(map) ? '#101827' : '#f4f1ea';
}

function opacidadMascara(map) {
  return esSatelite(map) ? 0.82 : 0.9;
}

function datosMascara(geometry) {
  try {
    const exterior = turf.polygon([OUTER_RING]);
    const zona = turf.feature(geometry);
    const diferencia = turf.difference(turf.featureCollection([exterior, zona]));
    return diferencia
      ? { type: 'FeatureCollection', features: [diferencia] }
      : { type: 'FeatureCollection', features: [] };
  } catch (error) {
    console.warn('No se pudo construir la máscara de la zona:', error);
    return { type: 'FeatureCollection', features: [] };
  }
}

function asegurarMascara(map) {
  if (!map.getSource(MASK_SRC)) {
    map.addSource(MASK_SRC, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
  }
  if (!map.getLayer(MASK_LAYER)) {
    map.addLayer({
      id: MASK_LAYER,
      type: 'fill',
      source: MASK_SRC,
      paint: {
        'fill-color': colorMascara(map),
        'fill-opacity': opacidadMascara(map),
      },
    });
  } else {
    map.setPaintProperty(MASK_LAYER, 'fill-color', colorMascara(map));
    map.setPaintProperty(MASK_LAYER, 'fill-opacity', opacidadMascara(map));
  }
}

function aplicarMascara(map, geometry) {
  asegurarMascara(map);
  map.getSource(MASK_SRC)?.setData(datosMascara(geometry));
  refrescarOrdenMascara();
}

function quitarMascara(map) {
  if (map.getSource(MASK_SRC)) {
    map.getSource(MASK_SRC).setData({ type: 'FeatureCollection', features: [] });
  }
}

/**
 * La máscara debe quedar por encima de las capas de datos y sus etiquetas,
 * pero por debajo de los contornos y rótulos de referencia.
 */
export function refrescarOrdenMascara() {
  const map = getMap();
  if (!map || !map.getLayer(MASK_LAYER)) return;

  try { map.moveLayer(MASK_LAYER); } catch (_) { /* ignorar */ }
  bringVenezuelaBoundaryToFront(map);
  bringCountryLabelsToFront(map);
  bringAreaToFront();
  if (map.getLayer('layer-estados-venezuela-label')) {
    try { map.moveLayer('layer-estados-venezuela-label'); } catch (_) { /* ignorar */ }
  }

  const overlays = [
    'layer-estados-venezuela-line',
    'layer-bloques-venezuela-filter-line',
    'layer-bloques-venezuela-thematic-line',
    'layer-bloques-venezuela-label',
    'layer-zone-scan-fill',
    'layer-zone-scan-line',
    'layer-zone-scan-point',
  ];
  overlays.forEach((id) => {
    if (!map.getLayer(id)) return;
    try { map.moveLayer(id); } catch (_) { /* ignorar */ }
  });
}

export function actualizarColorMascara() {
  const map = getMap();
  if (!map || !map.getLayer(MASK_LAYER)) return;
  try {
    map.setPaintProperty(MASK_LAYER, 'fill-color', colorMascara(map));
    map.setPaintProperty(MASK_LAYER, 'fill-opacity', opacidadMascara(map));
    refrescarOrdenMascara();
  } catch (_) { /* ignorar */ }
}

// ---------------------------------------------------------------------------
// Panel de información
// ---------------------------------------------------------------------------
function publicarInfoZona(zone) {
  if (zone.tipo !== 'coords') return;
  const capas = zone.hits || [];
  const total = capas.reduce((suma, c) => suma + (Number(c.count) || 0), 0);
  setInfoPanelData({
    currentZonaFilterData: {
      zonaLabel: zone.label,
      total,
      capas,
    },
    isZonaFilterActive: true,
  });
  renderInfoPanel();
}

function limpiarInfoZona() {
  setInfoPanelData({
    currentZonaFilterData: null,
    isZonaFilterActive: false,
  });
  renderInfoPanel();
}

// ---------------------------------------------------------------------------
// Aplicar / limpiar
// ---------------------------------------------------------------------------
export async function aplicarZonaActiva({ tipo, geometry, label, lat = null, lng = null, radioKm = null }) {
  const map = getMap();
  if (!map || !geometry) return null;

  const token = ++zoneToken;
  const snapshot = activeZone ? activeZone.snapshot : idsCapasActivas();

  activeZone = {
    tipo,
    label,
    geometry,
    lat,
    lng,
    radioKm,
    snapshot,
    hits: [],
    cargando: true,
    error: null,
  };

  dibujarZona(geometry, tipo === 'coords' && lat != null ? [lng, lat] : null);
  aplicarMascara(map, geometry);
  emit();

  try {
    const data = await consultarZona(geometry);
    if (token !== zoneToken || !activeZone) return null;

    activeZone.hits = data?.layers || [];
    activeZone.cargando = false;
    activeZone.error = null;

    ajustarCapas(activeZone.hits.map((c) => c.id));
    publicarInfoZona(activeZone);
    emit();
    refrescarOrdenMascara();
    return activeZone;
  } catch (error) {
    if (token !== zoneToken || !activeZone) return null;
    activeZone.cargando = false;
    activeZone.error = String(error?.message || error);
    publicarInfoZona(activeZone);
    emit();
    return activeZone;
  }
}

export function limpiarZonaActiva(tipo = null) {
  if (!activeZone) return;
  if (tipo && activeZone.tipo !== tipo) return;

  const snapshot = activeZone.snapshot || [];
  activeZone = null;
  zoneToken++;

  const map = getMap();
  if (map) {
    quitarMascara(map);
    limpiarZona();
  }

  ajustarCapas(snapshot);
  limpiarInfoZona();
  emit();
}
