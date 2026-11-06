// map-config.js
import { formatearCoordenada } from './utils.js';
import * as maplibregl from 'maplibre-gl';
import { setWorkerUrl } from 'maplibre-gl';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { Protocol } from 'pmtiles';
import { addVenezuelaBoundaryLayers, actualizarFronteraOficial, bringVenezuelaBoundaryToFront } from './venezuela-boundary.js';
import { addCountryLabels, bringCountryLabelsToFront } from './map-labels.js';

// URL correcta del worker de maplibre (en producción la ruta interna
// ./maplibre-gl-worker.mjs da 404 y el estilo nunca termina de cargar).
setWorkerUrl(maplibreWorkerUrl);

// Protocolo pmtiles:// para leer archivos PMTiles locales (una sola vez).
const pmtilesProtocol = new Protocol();
maplibregl.addProtocol('pmtiles', pmtilesProtocol.tile);

// ============================================================
//  MODO OFFLINE
//  true  → fondos "Clara" (y su zoom profundo) y "Satelital" se sirven
//          desde PMTiles locales (public/tiles/*.pmtiles), idénticos a
//          los proveedores online (Esri Terrain / CARTO deep / Esri
//          Imagery / Esri Reference).
//          Generarlos con:  py scripts/generate-offline-tiles.py
//  false → fondos online: Esri Terrain hasta z13 + CARTO light_nolabels
//          a partir de ~z13 (zoom profundo real hasta z20).
//  Nota: el zoom profundo online requiere PUBLIC_CARTO_KEY definida al
//  compilar (ver .env.example). Sin clave, Clara se queda en z13.
// ============================================================
export const USE_OFFLINE_TILES = false;

// Clave pública de CARTO (solo para la CDN de teselas; build-time con el
// prefijo PUBLIC_ de Astro). Sin clave no se añade la capa profunda.
const CARTO_KEY = (import.meta.env && import.meta.env.PUBLIC_CARTO_KEY) || "";
const CARTO_DEEP_URL = "https://a.basemaps.cartocdn.com/rastertiles/light_nolabels/{z}/{x}/{y}.png";


// ============================================================
//  CONSTANTES DEL MAPA
// ============================================================
export const INITIAL_CENTER = [-65.75816, 7.17672];
export const INITIAL_ZOOM = 5;

// Límites de desplazamiento del mapa. Se amplía el norte para incluir
// las islas del territorio oficial y el encuadre del mapa oficial 2023.
const MAP_BOUNDS = [[-75.5, 0.5], [-56.0, 17.2]];

let mapInstance = null;

// ============================================================
//  INICIALIZACIÓN DEL MAPA
// ============================================================
export function initMap(containerId) {
  if (mapInstance) return mapInstance;

  mapInstance = new maplibregl.Map({   // ← usa el import, ya no la global
    container: containerId,
    style: {
      version: 8,
      sources: {},
      layers: [],
      glyphs: '/fonts/{fontstack}/{range}.pbf',
      // El "sky" ahora se define aquí, dentro del style (v5+)
      sky: {
        'sky-color': '#b4d0e8',
        'horizon-color': '#e8ddc8',
        'fog-color': '#e8ddc8',
        'fog-ground-blend': 0.5,
        'horizon-fog-blend': 0.6,
        'sky-horizon-blend': 0.6,
        'atmosphere-blend': 0.6
      }
    },
    center: INITIAL_CENTER,
    zoom: INITIAL_ZOOM,
    minZoom: 5,
    maxBounds: MAP_BOUNDS,
    renderWorldCopies: false,
    maxTileCacheSize: 30,
    fadeDuration: 0,
    attributionControl: false
  });

  // Acceso global para depuración y pruebas automatizadas
  if (typeof window !== 'undefined') window.geoportalMap = mapInstance;

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
  // --- Capa clara: PMTiles local (offline) o Esri Terrain (online) ---
  if (USE_OFFLINE_TILES) {
    // IMPORTANTE: con pmtiles se declara con `url:` (no `tiles:`), para que el
    // protocolo resuelva el TileJSON y sirva cada tile como .../{z}/{x}/{y}.
    map.addSource('clara-source', {
      type: 'raster',
      url: 'pmtiles:///tiles/clara.pmtiles',
      tileSize: 256,
      maxzoom: 9, // Esri Terrain solo sirve teselas reales hasta z9 (ver nota abajo)
      attribution: 'Tiles &copy; Esri &mdash; Source: USGS, Esri, TANA, DeLorme, and NPS'
    });
  } else {
    // Base física clara de Esri: sin fronteras políticas ni etiquetas, para
    // que la única delimitación visible sea la oficial del geoportal.
    // OJO: World_Terrain_Base está RETIRADO por Esri: sirve teselas reales
    // hasta z9; de z10 en adelante devuelve un placeholder gris. Por eso el
    // maxzoom es 9 (MapLibre escala las buenas) y el zoom fino lo aporta la
    // capa profunda CARTO que se añade justo debajo.
    map.addSource('clara-source', {
      type: 'raster',
      tiles: ['https://services.arcgisonline.com/ArcGIS/rest/services/World_Terrain_Base/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      maxzoom: 9,
      attribution: 'Tiles &copy; Esri &mdash; Source: USGS, Esri, TANA, DeLorme, and NPS'
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

  // --- Zoom profundo de Clara (CARTO light_nolabels, sin etiquetas ni
  //     fronteras): cubre desde ~z9, donde Esri Terrain se agota. Solo se
  //     añade si hay clave (online) o en modo offline (PMTILES local). ---
  const deepEnabled = USE_OFFLINE_TILES || Boolean(CARTO_KEY);
  if (deepEnabled) {
    if (USE_OFFLINE_TILES) {
      map.addSource('clara-deep-source', {
        type: 'raster',
        url: 'pmtiles:///tiles/clara-deep.pmtiles',
        tileSize: 256,
        attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
      });
    } else {
      map.addSource('clara-deep-source', {
        type: 'raster',
        tiles: [CARTO_DEEP_URL + '?key=' + encodeURIComponent(CARTO_KEY)],
        tileSize: 256,
        maxzoom: 20,
        attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
      });
    }
    map.addLayer({
      id: 'clara-deep-layer',
      type: 'raster',
      source: 'clara-deep-source',
      layout: { visibility: 'visible' },
      minzoom: 8,
      maxzoom: 22,
      paint: {
        // El relieve beige de Esri manda hasta ~z9; CARTO entra con fundido
        // y domina el detalle urbano a partir de ahí.
        'raster-opacity': ['interpolate', ['linear'], ['zoom'], 8.5, 0, 10, 1]
      }
    });
  }

  // --- Satélite: PMTiles local (offline) o Esri (online) ---
  if (USE_OFFLINE_TILES) {
    map.addSource('satelite-source', {
      type: 'raster',
      url: 'pmtiles:///tiles/satelite.pmtiles',
      tileSize: 256,
      attribution: 'Tiles &copy; Esri'
    });
  } else {
    map.addSource('satelite-source', {
      type: 'raster',
      tiles: ['https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      attribution: 'Tiles &copy; Esri'
    });
  }
  map.addLayer({
    id: 'satelite-layer',
    type: 'raster',
    source: 'satelite-source',
    layout: { visibility: 'none' },
    minzoom: 0,
    maxzoom: 19
  });

  // --- Etiquetas del satélite (nombres de ciudades/estados, PNG transparente) ---
  // Online: referencia Esri World_Boundaries_and_Places.
  // Offline: PMTiles local (generar con: py scripts/generate-offline-tiles.py --layers satelite-labels)
  if (USE_OFFLINE_TILES) {
    map.addSource('satelite-labels-source', {
      type: 'raster',
      url: 'pmtiles:///tiles/satelite-labels.pmtiles',
      tileSize: 256,
      attribution: 'Labels &copy; Esri'
    });
  } else {
    map.addSource('satelite-labels-source', {
      type: 'raster',
      tiles: ['https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      attribution: 'Labels &copy; Esri'
    });
  }
  map.addLayer({
    id: 'satelite-labels-layer',
    type: 'raster',
    source: 'satelite-labels-source',
    layout: { visibility: 'none' },
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

  // --- Contorno nacional oficial y ocultamiento de la frontera de facto ---
  addVenezuelaBoundaryLayers(map);

  // --- Etiquetas de países y océanos ---
  addCountryLabels(map);

  // ⚠️ ELIMINADO el bloque try { map.setSky({...}) } catch
  // Ahora el sky se define en initMap() dentro del style.
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
//  AVISOS FLOTANTES (toast)
// ============================================================
function mostrarAviso(texto) {
  let toast = document.getElementById('geoportal-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'geoportal-toast';
    toast.setAttribute('role', 'status');
    toast.style.cssText = [
      'position:fixed', 'left:50%', 'bottom:28px', 'transform:translateX(-50%)',
      'background:rgba(20,28,40,.94)', 'color:#fff', 'padding:12px 20px',
      'border-radius:8px', 'font-size:14px', 'line-height:1.4', 'z-index:9999',
      'box-shadow:0 6px 20px rgba(0,0,0,.35)', 'max-width:min(90vw,420px)',
      'text-align:center', 'opacity:0', 'transition:opacity .25s ease',
      'pointer-events:none'
    ].join(';');
    document.body.appendChild(toast);
  }
  toast.textContent = texto;
  requestAnimationFrame(() => { toast.style.opacity = '1'; });
  clearTimeout(mostrarAviso._timer);
  mostrarAviso._timer = setTimeout(() => { toast.style.opacity = '0'; }, 4000);
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
      const targetKey = option.getAttribute('data-basemap');
      const switched = switchBasemap(targetKey, map, activeBasemap);
      if (switched) {
        document.querySelectorAll('[data-basemap]').forEach(x => x.classList.remove('active'));
        option.classList.add('active');
        activeBasemap = targetKey;
      }
      if (basemapSwitch) basemapSwitch.classList.remove('open');
    });
  });

  window.switchBasemap = (targetKey) => switchBasemap(targetKey, map, activeBasemap);
}

function switchBasemap(targetKey, map, activeBasemap) {
  if (targetKey === activeBasemap) return true;

  const overlayLayers = ['clara-layer', 'clara-deep-layer', 'satelite-layer', 'satelite-labels-layer'];
  overlayLayers.forEach(layerId => {
    if (map.getLayer(layerId)) map.setLayoutProperty(layerId, 'visibility', 'none');
  });
  if (map.getLayer('custom-labels-layer')) map.setLayoutProperty('custom-labels-layer', 'visibility', 'none');

  if (targetKey === 'clara') {
    if (map.getLayer('clara-layer')) map.setLayoutProperty('clara-layer', 'visibility', 'visible');
    if (map.getLayer('clara-deep-layer')) map.setLayoutProperty('clara-deep-layer', 'visibility', 'visible');
  } else if (targetKey === 'satelite') {
    if (map.getLayer('satelite-layer')) map.setLayoutProperty('satelite-layer', 'visibility', 'visible');
    if (map.getLayer('satelite-labels-layer')) map.setLayoutProperty('satelite-labels-layer', 'visibility', 'visible');
  }

  // El contorno vectorial y la línea de borrado se actualizan según el fondo.
  bringVenezuelaBoundaryToFront(map);
  actualizarFronteraOficial(map, targetKey);
  bringCountryLabelsToFront(map);
  if (map.getLayer('layer-estados-venezuela-label')) {
    try { map.moveLayer('layer-estados-venezuela-label'); } catch (_) { /* ignorar */ }
  }

  return true;
}