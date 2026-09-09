// map-config.js
import { formatearCoordenada } from './utils.js';

// ============================================================
//  CONFIGURACIÓN: CLAVE DE CARTO (light_nolabels)
// ============================================================
// 👇 PON AQUÍ TU CLAVE REAL
const CARTO_KEY = 'cb1_33kc_1_d2fff4a23840225df4cca1fa';


// ============================================================
//  CONSTANTES DEL MAPA
// ============================================================
export const INITIAL_CENTER = [-65.75816, 7.17672];
export const INITIAL_ZOOM = 4.8;

let mapInstance = null;

// ============================================================
//  INICIALIZACIÓN DEL MAPA
// ============================================================
export function initMap(containerId) {
  if (mapInstance) return mapInstance;

  mapInstance = new maplibregl.Map({
    container: containerId,
    style: {
      version: 8,
      sources: {},
      layers: [],
      glyphs: 'https://fonts.undpgeohub.org/fonts/{fontstack}/{range}.pbf'
    },
    center: INITIAL_CENTER,
    zoom: INITIAL_ZOOM,
    renderWorldCopies: false,
    maxTileCacheSize: 30,
    fadeDuration: 0,
    attributionControl: false
  });

  return mapInstance;
}

export function getMap() {
  return mapInstance;
}

// ============================================================
//  BRÚJULA
// ============================================================
export function setupCompass(map) {
  const compassEl = document.querySelector('.compass');
  if (!compassEl) return;
  compassEl.style.cursor = 'pointer';
  compassEl.addEventListener('click', () => {
    map.flyTo({
      center: INITIAL_CENTER,
      zoom: INITIAL_ZOOM,
      bearing: 0,
      pitch: 0,
      duration: 1500
    });
  });
  function actualizarRotacionBrujula() {
    const bearing = map.getBearing();
    compassEl.style.transform = `rotate(${-bearing}deg)`;
  }
  map.on('rotate', actualizarRotacionBrujula);
  map.on('move', actualizarRotacionBrujula);
  actualizarRotacionBrujula();
}

// ============================================================
//  BARRA DE ESTADO
// ============================================================
export function setupStatusBar(map) {
  const statCoordEl = document.getElementById('statCoord');
  const statScaleEl = document.getElementById('statScale');
  const statZoomEl = document.getElementById('statZoom');
  map.on('mousemove', (e) => {
    if (statCoordEl) statCoordEl.textContent = formatearCoordenada(e.lngLat.lng, e.lngLat.lat);
  });
  function actualizarZoomYEscala() {
    const zoom = map.getZoom();
    if (statZoomEl) statZoomEl.textContent = zoom.toFixed(1);
    if (statScaleEl) {
      const centerLat = map.getCenter().lat;
      const metersPerPixel = 156543.03392 * Math.cos(centerLat * Math.PI / 180) / Math.pow(2, zoom);
      const referenciaPx = 100;
      const distanciaMetros = metersPerPixel * referenciaPx;
      let texto;
      if (distanciaMetros >= 1000) {
        texto = (distanciaMetros / 1000).toFixed(1) + ' km';
      } else {
        texto = Math.round(distanciaMetros) + ' m';
      }
      statScaleEl.textContent = texto;
    }
  }
  map.on('move', actualizarZoomYEscala);
  map.on('zoom', actualizarZoomYEscala);
  actualizarZoomYEscala();
}

// ============================================================
//  CAPAS BASE (fondo del mapa)
// ============================================================
export function addBaseLayers(map) {
  // ✅ Lógica simplificada: si hay clave, usa Carto; si no, OSM
  const useCarto = CARTO_KEY && CARTO_KEY.length > 0;

  if (!useCarto) {

    map.addSource('clara-source', {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '&copy; OpenStreetMap contributors'
    });
  } else {
    // --- Capa clara: CARTO light_nolabels (sin etiquetas) con API Key ---

    map.addSource('clara-source', {
      type: 'raster',
      tiles: [
        `https://a.basemaps.cartocdn.com/rastertiles/light_nolabels/{z}/{x}/{y}@2x.png?key=${CARTO_KEY}`,
        `https://b.basemaps.cartocdn.com/rastertiles/light_nolabels/{z}/{x}/{y}@2x.png?key=${CARTO_KEY}`,
        `https://c.basemaps.cartocdn.com/rastertiles/light_nolabels/{z}/{x}/{y}@2x.png?key=${CARTO_KEY}`
      ],
      tileSize: 256,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> &copy; <a href="https://carto.com/" target="_blank">CARTO</a>'
    });
  }

  map.addLayer({
    id: 'clara-layer',
    type: 'raster',
    source: 'clara-source',
    layout: { visibility: 'visible' },
    minzoom: 0,
    maxzoom: 19
  });

  // --- Satélite (Esri) ---
  map.addSource('satelite-source', {
    type: 'raster',
    tiles: ['https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
    tileSize: 256,
    attribution: 'Tiles &copy; Esri'
  });
  map.addLayer({
    id: 'satelite-layer',
    type: 'raster',
    source: 'satelite-source',
    layout: { visibility: 'none' },
    minzoom: 0,
    maxzoom: 19
  });

  // --- Relieve color ---
  map.addSource('relieve-color-source', {
    type: 'raster',
    tiles: ['https://services.arcgisonline.com/ArcGIS/rest/services/World_Terrain_Base/MapServer/tile/{z}/{y}/{x}'],
    tileSize: 256,
    maxzoom: 13,
    attribution: 'Tiles &copy; Esri &mdash; Source: USGS, Esri, TANA, DeLorme, and NPS'
  });
  map.addLayer({
    id: 'relieve-color-layer',
    type: 'raster',
    source: 'relieve-color-source',
    layout: { visibility: 'none' },
    minzoom: 0,
    maxzoom: 19
  });

  // --- Hillshade ---
  map.addSource('relieve-hillshade-source', {
    type: 'raster',
    tiles: ['https://services.arcgisonline.com/arcgis/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}'],
    tileSize: 256,
    maxzoom: 16,
    attribution: 'Tiles &copy; Esri &mdash; Source: Esri'
  });
  map.addLayer({
    id: 'relieve-hillshade-layer',
    type: 'raster',
    source: 'relieve-hillshade-source',
    layout: { visibility: 'none' },
    paint: { 'raster-opacity': 0.55 },
    minzoom: 0,
    maxzoom: 19
  });

  // --- Capa de etiquetas personalizadas (placeholder) ---
  map.addSource('custom-labels-source', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] }
  });
  map.addLayer({
    id: 'custom-labels-layer',
    type: 'symbol',
    source: 'custom-labels-source',
    layout: {
      'text-field': ['get', 'name'],
      'text-font': ['Open Sans Regular'],
      'text-size': ['get', 'size'],
      'text-letter-spacing': 0.04,
      'text-justify': 'center',
      'text-max-width': 8,
      visibility: 'none'
    },
    paint: {
      'text-color': ['get', 'color'],
      'text-halo-color': '#ffffff',
      'text-halo-width': 1.4
    },
    minzoom: 0,
    maxzoom: 19
  });

  // --- Terreno DEM ---
  map.addSource('terrain-dem', {
    type: 'raster-dem',
    tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
    tileSize: 256,
    encoding: 'terrarium',
    maxzoom: 14
  });

  // --- Cielo ---
  try {
    map.setSky({
      'sky-color': '#b4d0e8',
      'horizon-color': '#e8ddc8',
      'fog-color': '#e8ddc8',
      'fog-ground-blend': 0.5,
      'horizon-fog-blend': 0.6,
      'sky-horizon-blend': 0.6,
      'atmosphere-blend': 0.6
    });
  } catch (e) {}
}

// ============================================================
//  CONTROLES DE ZOOM
// ============================================================
export function setupZoomControls(map) {
  const zoomInBtn = document.getElementById('zoomIn');
  const zoomOutBtn = document.getElementById('zoomOut');
  if (zoomInBtn) zoomInBtn.addEventListener('click', () => map.zoomIn({ duration: 300 }));
  if (zoomOutBtn) zoomOutBtn.addEventListener('click', () => map.zoomOut({ duration: 300 }));
}

// ============================================================
//  SWITCHER DE MAPAS BASE
// ============================================================
export function setupBasemapSwitcher(map) {
  const basemapSwitch = document.querySelector('.basemap-switch');
  const basemapBtn = document.getElementById('basemapToggleBtn');
  let activeBasemap = 'clara';

  if (basemapBtn && basemapSwitch) {
    basemapBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      basemapSwitch.classList.toggle('open');
    });
    document.addEventListener('click', (e) => {
      if (!basemapSwitch.contains(e.target)) basemapSwitch.classList.remove('open');
    });
  }

  document.querySelectorAll('[data-basemap]').forEach(option => {
    option.addEventListener('click', () => {
      document.querySelectorAll('[data-basemap]').forEach(x => x.classList.remove('active'));
      option.classList.add('active');
      const targetKey = option.getAttribute('data-basemap');
      switchBasemap(targetKey, map, activeBasemap);
      activeBasemap = targetKey;
      if (basemapSwitch) basemapSwitch.classList.remove('open');
    });
  });

  window.switchBasemap = (targetKey) => switchBasemap(targetKey, map, activeBasemap);
}

function switchBasemap(targetKey, map, activeBasemap) {
  if (targetKey === activeBasemap) return;
  const overlayLayers = ['clara-layer', 'satelite-layer', 'relieve-color-layer', 'relieve-hillshade-layer'];
  overlayLayers.forEach(layerId => {
    if (map.getLayer(layerId)) map.setLayoutProperty(layerId, 'visibility', 'none');
  });
  if (map.getLayer('custom-labels-layer')) map.setLayoutProperty('custom-labels-layer', 'visibility', 'none');

  if (targetKey !== 'relieve3d' && activeBasemap === 'relieve3d') {
    map.setTerrain(null);
    map.easeTo({ pitch: 0, bearing: 0, duration: 800 });
  }

  if (targetKey === 'clara') {
    if (map.getLayer('clara-layer')) map.setLayoutProperty('clara-layer', 'visibility', 'visible');
  } else if (targetKey === 'satelite') {
    if (map.getLayer('satelite-layer')) map.setLayoutProperty('satelite-layer', 'visibility', 'visible');
  } else if (targetKey === 'relieve3d') {
    if (map.getLayer('relieve-color-layer')) map.setLayoutProperty('relieve-color-layer', 'visibility', 'visible');
    if (map.getLayer('relieve-hillshade-layer')) map.setLayoutProperty('relieve-hillshade-layer', 'visibility', 'visible');
    if (map.getSource('terrain-dem')) map.setTerrain({ source: 'terrain-dem', exaggeration: 1.6 });
    map.easeTo({
      center: [-71.55, 8.35],
      zoom: 8.3,
      pitch: 65,
      bearing: -20,
      duration: 1800
    });
  }
}