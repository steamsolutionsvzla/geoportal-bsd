// main.js - Punto de entrada principal
import { setWorkerUrl } from 'maplibre-gl';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import * as turf from '@turf/turf';
import { fetchStyles } from '../services/styles.js';
import { applyStyle } from '../lib/mapStyles.js';

import { initMap, setupCompass, setupStatusBar, addBaseLayers, setupZoomControls, setupBasemapSwitcher, getMap } from './map-config.js';
import {
  setupFilterDropdowns,
  setupAreaFilter,
  usarAreaDibujada,
  limpiarFiltroArea,
  limpiarFiltroEstado as filtroEstadoOriginal,
  limpiarFiltroBloque as filtroBloqueOriginal,
  setEstadosCache,
  setBloquesCache,
  recalcularFiltrosActivos
} from './filters.js';
import { setDrawnArea } from './area-temporal.js';
import { initDrawTools } from './draw-tools.js';
import { bringVenezuelaBoundaryToFront } from './venezuela-boundary.js';
import { bringCountryLabelsToFront } from './map-labels.js';
import {
  renderInfoPanel,
  setInfoPanelData,
  showLayerMetadataInPanel,
  clearSelectedLayerMetadataIfMatches,
  pushFilterLoading,
  popFilterLoading
} from './info-panel.js';
import { obtenerNombreEstado, normalizarNombreEstado, obtenerNombreBloque, refreshCount, updateLegendUI, getPaletteForType, hashCode, apiFetch, esperarMapaListo } from './utils.js';
import {
  setAvailableLayers, renderLayerGroups, attachLayerToggleEvents, loadLayerToMap, applySavedStyleColors,
  getAvailableLayers, getLayerDisplayName, getSelectedSourceId, getSelectedFeatureId,
  setSelectedSourceId, setSelectedFeatureId, clearSelection, updateLayerFeatureCount,
  attachLayerOpacityEvents,
  getLayerRawData, clearLayerRawData,   // 👈 NUEVOS
  isRasterLayer, addRasterLayerToMap, removeRasterLayer
} from './layer-manager.js';
import { openFeaturePopup, closeFeaturePopup } from './feature-popup.js';
import { beginBusy, endBusy } from './busy-overlay.js';

// =========================================================================
// WORKER DE MAPLIBRE (obligatorio en v5+)
// =========================================================================
setWorkerUrl(maplibreWorkerUrl);

// =========================================================================
// CONSTANTES DE CAPAS ESPECIALES
// =========================================================================
const BLOQUES_LAYER_NAME = 'Bloques petroleros';
const ROL_ANALISTA = 'Rol_analista';

// La sesión se valida de forma asíncrona en session.js. Esperamos a que
// exista window.currentUser (o al evento session:ready) antes de decidir
// qué filtros montar.
function esperarSesion(timeoutMs = 4000) {
  if (window.currentUser) return Promise.resolve(window.currentUser);
  return new Promise((resolve) => {
    let listo = false;
    const fin = (user) => {
      if (listo) return;
      listo = true;
      clearTimeout(timer);
      document.removeEventListener('session:ready', onReady);
      resolve(user || window.currentUser || null);
    };
    const onReady = (event) => fin(event?.detail);
    const timer = setTimeout(() => fin(window.currentUser), timeoutMs);
    document.addEventListener('session:ready', onReady, { once: true });
  });
}

// =========================================================================
// HELPERS DE ESTILO / ATRIBUTOS
// =========================================================================
/**
 * Busca la config de estilo de una capa en stylesMap.
 * Las capas especiales (estados, bloques) se guardan como
 * "workspace:nombre" pero el mapa las llama solo por el nombre corto.
 */
function getStyleCapa(name) {
  if (!name) return undefined;
  if (stylesMap.has(name)) return stylesMap.get(name);
  for (const [key, value] of stylesMap) {
    if (key.split(':').pop() === name) return value;
  }
  return undefined;
}

/**
 * Resuelve la clave real de un atributo en las properties aunque el
 * caso no coincida (PostGIS devuelve minúsculas, la config puede tener
 * mayúsculas del shapefile original).
 */
function resolverClaveProp(properties, attr) {
  if (!attr || !properties) return null;
  if (Object.prototype.hasOwnProperty.call(properties, attr)) return attr;
  const lower = String(attr).toLowerCase();
  for (const k of Object.keys(properties)) {
    if (k.toLowerCase() === lower) return k;
  }
  return null;
}

// =========================================================================
// MANEJO DE ERRORES GLOBAL
// =========================================================================
function mostrarError(mensaje) {
  const errorDiv = document.getElementById('global-error');
  const errorText = document.getElementById('error-text');
  if (errorDiv && errorText) {
    errorText.textContent = mensaje;
    errorDiv.style.display = 'block';
  } else {
    console.error('Error:', mensaje);
  }
}

function ocultarError() {
  const errorDiv = document.getElementById('global-error');
  if (errorDiv) errorDiv.style.display = 'none';
}

// =========================================================================
// INDICADOR VISUAL DE CARGA
// Mientras está visible, busy-overlay.js bloquea toda la interfaz (mapa,
// capas, filtros, botones y teclado) hasta que la carga termina.
// =========================================================================
function mostrarCargando(mostrar) {
  if (mostrar) beginBusy('Cargando datos…');
  else endBusy();
}

// =========================================================================
// VARIABLES GLOBALES
// =========================================================================
let availableLayers = [];
let stylesMap = new Map();
let estadosGeoJsonCache = null;
let bloquesGeoJsonCache = null;
let currentFilterData = null;
let currentBloqueFilterData = null;
let currentAreaFilterData = null;
let currentIntersectionFilterData = null;
let isFilterActive = false;
let isBloqueFilterActive = false;
let estadoSeleccionado = '';
let bloqueSeleccionado = '';
const IS_SHOWROOM = document.body.dataset.showroom === 'true';
const SHOWROOM_WORKSPACE = 'Showroom';

// =========================================================================
// INICIALIZACIÓN
// =========================================================================
document.addEventListener('DOMContentLoaded', async () => {
  const map = initMap('map');
  window.map = map;

  map.on('load', () => {
    addBaseLayers(map);
    setupCompass(map);
    setupStatusBar(map);
    setupZoomControls(map);
    setupBasemapSwitcher(map);

    setupSidebarToggle();
    setupInfoPanelToggle();

      (async () => {
        // Un único bloqueo para toda la carga inicial: así el usuario no
        // puede tocar nada entre una petición y la siguiente.
        beginBusy('Cargando datos…');
        try {
          await loadWorkspaces();

          const usuario = await esperarSesion();
          const esAnalista = usuario?.rol === ROL_ANALISTA;

          // Herramientas de mapa disponibles desde el inicio (dibujo solo analista).
          initDrawTools({
            map,
            canDrawPolygon: esAnalista,
            onPolygonComplete: (feature) => {
              const meta = setDrawnArea(feature);
              usarAreaDibujada(meta);
            },
          });

          // Cargar estilos guardados por el analista
          try {
            const styles = await fetchStyles();
            styles.forEach(s => stylesMap.set(s.layer_name, s));
            applySavedStyleColors(stylesMap);
          } catch (e) {
            console.warn('No se pudieron cargar estilos:', e);
          }

          if (!IS_SHOWROOM) {
            await cargarCapaEstadosVenezuela();
            await cargarCapaBloques();

            if (esAnalista) {
              // El analista reemplaza el filtro de bloques por el área temporal.
              const filtroBloque = document.getElementById('filterBloque');
              if (filtroBloque) filtroBloque.hidden = true;
              setupFilterDropdowns(estadosGeoJsonCache, null, { includeBloque: false });
              setupAreaFilter();
            } else if (estadosGeoJsonCache && bloquesGeoJsonCache) {
              setupFilterDropdowns(estadosGeoJsonCache, bloquesGeoJsonCache);
            } else {
              mostrarError('No se pudieron cargar los datos de estados o bloques.');
            }
          }

          // Mantener el contorno nacional y las etiquetas por encima de las capas.
          bringVenezuelaBoundaryToFront(map);
          bringMapLabelsToFront(map);

          const sidebar = document.getElementById('sidebar');
          attachLayerToggleEvents(sidebar, handleLayerToggle);
          attachLayerOpacityEvents(sidebar);
        } finally {
          endBusy();
        }
      })();

    function limpiarFiltroEstado() {
      filtroEstadoOriginal();
      currentFilterData = null;
      isFilterActive = false;
      estadoSeleccionado = '';
      setInfoPanelData({ currentFilterData: null, isFilterActive: false });
      renderInfoPanel();
    }

    function limpiarFiltroBloque() {
      filtroBloqueOriginal();
      currentBloqueFilterData = null;
      isBloqueFilterActive = false;
      bloqueSeleccionado = '';
      setInfoPanelData({ currentBloqueFilterData: null, isBloqueFilterActive: false });
      renderInfoPanel();
    }

    window.handleFeatureClick = (tableName, props, lngLat) => {
      // Mientras se dibuja o se mide, los clics pertenecen a la herramienta.
      if (window.__mapToolActive) return;
      const displayName = getLayerDisplayName(tableName);
      showLayerMetadataInPanel(tableName, displayName);
      const style = getStyleCapa(tableName);
      if (lngLat) openFeaturePopup(
        map, displayName, props, lngLat,
        style?.visible_attributes ?? null,
        tableName,
        style?.attribute_labels ?? null,
      );
    };

    window.calcularPuntosEnEstado = (feature, nombre) => calcularPuntosEnEstado(feature, nombre);
    window.calcularPuntosEnBloque = (feature, nombre) => calcularPuntosEnBloque(feature, nombre);
    window.calcularElementosEnArea = (feature, nombre) => calcularElementosEnArea(feature, nombre);
    window.calcularElementosEnInterseccion = (estadoFeature, areaFeature, nombreEstado, nombreArea) =>
      calcularElementosEnInterseccion(estadoFeature, areaFeature, nombreEstado, nombreArea);
    window.updateInfoPanel = renderInfoPanel;
    window.limpiarFiltroEstado = limpiarFiltroEstado;
    window.limpiarFiltroBloque = limpiarFiltroBloque;
    window.limpiarFiltroArea = () => limpiarFiltroArea({ keepLayer: true });
    window.cerrarSesion = cerrarSesion;

    document.querySelector('.logout-btn')?.addEventListener('click', cerrarSesion);
    document.querySelector('.icon-btn[title="Ajustes"]')?.addEventListener('click', () => {
      alert('Ajustes aún no implementados');
    });

    const legendToggleBtn = document.getElementById('legendToggleBtn');
    const legendSwitch = document.querySelector('.legend-switch');
    if (legendToggleBtn && legendSwitch) {
      legendToggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        legendSwitch.classList.toggle('open');
        updateLegendUI(getAvailableLayers());
      });
      document.addEventListener('click', (e) => {
        if (!legendSwitch.contains(e.target)) {
          legendSwitch.classList.remove('open');
        }
      });
      const closeLegendBtn = document.getElementById('closeLegendBtn');
      if (closeLegendBtn) {
        closeLegendBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          legendSwitch.classList.remove('open');
        });
      }
    }
  });
});

// =========================================================================
// CARGA DE WORKSPACES
// =========================================================================
async function loadWorkspaces() {
  try {
    ocultarError();
    mostrarCargando(true);
    const response = await apiFetch('/api/v1/layers/workspaces');

    if (!response.ok) {
      throw new Error(`Error ${response.status}: ${response.statusText}`);
    }
    let groups = await response.json();

     if (IS_SHOWROOM) {
      groups = groups.filter(
        g => (g.name || '').toLowerCase() === SHOWROOM_WORKSPACE.toLowerCase()
      );
    }

    groups.forEach(group => {
      group.layers.forEach(layer => {
        const id = layer.id.split(':').pop();
        if (id === 'División Político Territorial' || id === BLOQUES_LAYER_NAME) {
          layer.type = 'fill';
          layer.noOpacity = true;   // 👈 NUEVO: sin slider de opacidad
          if (id === 'División Político Territorial') {
            layer.color = '#1a365d';
          } else if (id === BLOQUES_LAYER_NAME) {
            layer.color = '#8a4baf';
          }
        }
      });
    });

    const allLayers = groups.flatMap(g => g.layers);

    allLayers.forEach(layer => {
      if (!layer.color) {
        const palette = getPaletteForType(layer.type);
        const idx = hashCode(layer.id) % palette.length;
        layer.color = palette[idx];
      }
    });

    availableLayers = allLayers;
    setAvailableLayers(availableLayers);

    renderLayerGroups(groups, 'layersGroupsContainer');

    refreshCount();
    updateLegendUI(availableLayers);
  } catch (error) {
    console.error('Error al obtener workspaces:', error);
    mostrarError('No se pudo cargar la estructura de capas. Verifica que el backend esté funcionando.');
    const container = document.getElementById('layersGroupsContainer');
    if (container) {
      container.innerHTML = '<div style="color: #c1584a; padding:10px; text-align:center;">⚠️ Error al conectar con el servidor.</div>';
    }
  } finally {
    mostrarCargando(false);
  }
}

// =========================================================================
// CARGA DE CAPAS ESPECIALES (estados y bloques)
// =========================================================================
function calcularEtiquetaEstado(feature, nombre) {
  let punto = null;
  try {
    punto = turf.pointOnFeature(feature);
  } catch (_) { /* geometría inválida */ }

  if (!punto) {
    try {
      punto = turf.centerOfMass(feature);
    } catch (_) { /* geometría inválida */ }
  }
  if (!punto) return null;

  // Posiciones manuales para estados cuya etiqueta debe ir en un punto
  // concreto del territorio (no en el centro geométrico).
  const posicionesEspeciales = {
    'Guayana Esequiba': [-59.5, 6.05],
    'Zulia': [-72.5, 9.9],
    'Delta Amacuro': [-61.5, 8.9]
  };
  const claveEspecial = Object.keys(posicionesEspeciales).find(
    (k) => k.toLowerCase() === String(nombre || '').toLowerCase()
  );
  const posicionEspecial = claveEspecial ? posicionesEspeciales[claveEspecial] : null;
  if (posicionEspecial) {
    try {
      const candidato = turf.point(posicionEspecial);
      if (turf.booleanPointInPolygon(candidato, feature)) {
        punto = candidato;
      }
    } catch (_) { /* geometría inválida */ }
  }

  let bbox = null;
  try { bbox = turf.bbox(feature); } catch (_) { /* ignorar */ }

  let widthKm = 0;
  let heightKm = 0;
  let areaKm2 = 0;

  if (bbox) {
    const midLat = (bbox[1] + bbox[3]) / 2;
    try {
      widthKm = turf.distance(
        turf.point([bbox[0], midLat]),
        turf.point([bbox[2], midLat]),
        { units: 'kilometers' }
      );
    } catch (_) { /* ignorar */ }
    try {
      heightKm = turf.distance(
        turf.point([bbox[0], bbox[1]]),
        turf.point([bbox[0], bbox[3]]),
        { units: 'kilometers' }
      );
    } catch (_) { /* ignorar */ }
  }

  try { areaKm2 = turf.area(feature) / 1e6; } catch (_) { /* ignorar */ }

  let size = 9;
  if (areaKm2 >= 100000) size = 13;
  else if (areaKm2 >= 50000) size = 12;
  else if (areaKm2 >= 20000) size = 11;
  else if (areaKm2 >= 8000) size = 10;

  let maxWidth = Math.max(4, Math.min(10, Math.round(widthKm / 55) || 4));

  // Estados muy pequeños: se permite que la etiqueta se solape o desborde.
  const pequeno = areaKm2 < 8000 || widthKm < 120 || heightKm < 120;
  if (pequeno) size = Math.max(8, size - 1);

  punto.properties = {
    ...(feature.properties || {}),
    _label_size: size,
    _label_maxwidth: maxWidth,
    _allow_overlap: pequeno
  };

  return punto;
}

function bringMapLabelsToFront(map) {
  bringCountryLabelsToFront(map);
  if (map.getLayer('layer-estados-venezuela-label')) {
    try { map.moveLayer('layer-estados-venezuela-label'); } catch (_) { /* ignorar */ }
  }
}

async function cargarCapaEstadosVenezuela() {
  try {
    ocultarError();
    mostrarCargando(true);
    const response = await apiFetch('/api/v1/layers/División Político Territorial');
    if (!response.ok) {
      throw new Error(`Error ${response.status}: ${response.statusText}`);
    }
    const data = await response.json();

    const featuresByName = {};
    data.features.forEach(f => {
      const nombre = obtenerNombreEstado(f.properties);
      if (!nombre) return;
      if (!featuresByName[nombre]) {
        featuresByName[nombre] = {
          type: 'Feature',
          properties: { ...f.properties },
          geometry: { type: 'MultiPolygon', coordinates: [] }
        };
      }
      if (f.geometry.type === 'Polygon') {
        featuresByName[nombre].geometry.coordinates.push(f.geometry.coordinates);
      } else if (f.geometry.type === 'MultiPolygon') {
        f.geometry.coordinates.forEach(coords => {
          featuresByName[nombre].geometry.coordinates.push(coords);
        });
      }
    });
    data.features = Object.values(featuresByName);

    // Normaliza el nombre visible del estado. En particular, el polígono
    // de la reclamación viene como "Zona en Reclamación" y debe mostrarse
    // como "Guayana Esequiba" en el filtro y en la etiqueta del mapa.
    data.features.forEach(f => {
      const nombre = obtenerNombreEstado(f.properties);
      if (!nombre) return;

      const nombreNormalizado = normalizarNombreEstado(nombre);
      f.properties._estado_nombre = nombreNormalizado;

      const claveNombre = Object.keys(f.properties).find(k =>
        ['entidad', 'estado', 'nombre', 'name'].includes(k.toLowerCase())
      );
      if (claveNombre) f.properties[claveNombre] = nombreNormalizado;
    });

    estadosGeoJsonCache = data;
    setEstadosCache(data);

    const puntosEtiquetas = {
      type: 'FeatureCollection',
      features: []
    };
    data.features.forEach(f => {
      try {
        const nombre = obtenerNombreEstado(f.properties);
        if (!nombre) return;
        const etiqueta = calcularEtiquetaEstado(f, nombre);
        if (etiqueta) puntosEtiquetas.features.push(etiqueta);
      } catch (e) {}
    });

    const map = getMap();
    const ESTADO_SOURCE_ID = 'source-estados-venezuela';
    const ESTADO_LABEL_SOURCE_ID = 'source-estados-venezuela-labels';
    const ESTADO_LINE_LAYER_ID = 'layer-estados-venezuela-line';
    const ESTADO_LABEL_LAYER_ID = 'layer-estados-venezuela-label';

    if (map.getSource(ESTADO_LABEL_SOURCE_ID)) {
      map.getSource(ESTADO_LABEL_SOURCE_ID).setData(puntosEtiquetas);
    } else {
      map.addSource(ESTADO_LABEL_SOURCE_ID, {
        type: 'geojson',
        data: puntosEtiquetas,
        generateId: true
      });
    }

    if (map.getSource(ESTADO_SOURCE_ID)) {
      map.getSource(ESTADO_SOURCE_ID).setData(data);
    } else {
      map.addSource(ESTADO_SOURCE_ID, {
        type: 'geojson',
        data: data,
        generateId: true
      });
    }

    if (!map.getLayer(ESTADO_LINE_LAYER_ID)) {
      map.addLayer({
        id: ESTADO_LINE_LAYER_ID,
        type: 'line',
        source: ESTADO_SOURCE_ID,
        layout: { visibility: 'none' },
        paint: {
          'line-color': [
            'case',
            ['boolean', ['feature-state', 'selected'], false], '#c1584a',
            '#2d5296'
          ],
          'line-width': [
            'case',
            ['boolean', ['feature-state', 'selected'], false], 3.2,
            1.2
          ],
          'line-opacity': [
            'case',
            ['boolean', ['feature-state', 'selected'], false], 1,
            0.78
          ]
        }
      });
    }

    const styleEstados = getStyleCapa('División Político Territorial');
    const attrEstados = styleEstados?.label_attribute || 'entidad';
    const claveEstados =
      resolverClaveProp(puntosEtiquetas.features[0]?.properties, attrEstados) || attrEstados;

    // Se recrea la capa para que tome el nuevo estilo de etiqueta ajustada.
    if (map.getLayer(ESTADO_LABEL_LAYER_ID)) {
      map.removeLayer(ESTADO_LABEL_LAYER_ID);
    }
    map.addLayer({
      id: ESTADO_LABEL_LAYER_ID,
      type: 'symbol',
      source: ESTADO_LABEL_SOURCE_ID,
      layout: {
        'visibility': 'visible',
        'text-field': ['coalesce', ['get', '_estado_nombre'], ['get', claveEstados || 'entidad']],
        'text-font': ['Open Sans Regular'],
        'text-size': ['get', '_label_size'],
        'text-max-width': ['get', '_label_maxwidth'],
        'text-line-height': 1.05,
        'text-letter-spacing': 0.02,
        'text-transform': 'uppercase',
        'text-allow-overlap': true,
        'text-ignore-placement': true,
        'text-justify': 'center',
        'text-anchor': 'center',
        'text-padding': 2
      },
      paint: {
        'text-color': styleEstados?.label_color || '#1a2a3a',
        'text-halo-color': '#ffffff',
        'text-halo-width': 1.6,
        'text-opacity': 0.95
      }
    });

    bringMapLabelsToFront(map);

    updateLayerFeatureCount('División Político Territorial', data.features.length);
  } catch (error) {
    console.error('Error al cargar la capa de estados:', error);
    mostrarError('No se pudo cargar la capa de estados. Verifica que el backend esté funcionando.');
  } finally {
    mostrarCargando(false);
  }
}

async function cargarCapaBloques() {
  try {
    ocultarError();
    mostrarCargando(true);
    const response = await apiFetch(`/api/v1/layers/${encodeURIComponent(BLOQUES_LAYER_NAME)}`);
    if (!response.ok) {
      throw new Error(`Error ${response.status}: ${response.statusText}`);
    }
    const data = await response.json();
    bloquesGeoJsonCache = data;
    setBloquesCache(data);

    // Centroides por bloque: una etiqueta por feature, fija en el mismo
    // lugar geográfico (evita duplicados/saltos al hacer zoom, que pasan
    // al colocar symbols directamente sobre polígonos tilingeados).
    const puntosEtiquetasBloques = {
      type: 'FeatureCollection',
      features: []
    };
    data.features.forEach(f => {
      try {
        const centroide = turf.centerOfMass(f);
        centroide.properties = {
          ...f.properties,
          nombre_bloque: obtenerNombreBloque(f.properties) || f.properties?.bloque || ''
        };
        puntosEtiquetasBloques.features.push(centroide);
      } catch (e) {}
    });

    const map = getMap();
    const BLOQUE_SOURCE_ID = 'source-bloques-venezuela';
    const BLOQUE_LABEL_SOURCE_ID = 'source-bloques-venezuela-labels';
    const BLOQUE_LAYER_ID = 'layer-bloques-venezuela-fill';
    const BLOQUE_FILTER_LINE_LAYER_ID = 'layer-bloques-venezuela-filter-line';
    const BLOQUE_THEMATIC_LINE_LAYER_ID = 'layer-bloques-venezuela-thematic-line';
    const BLOQUE_LABEL_LAYER_ID = 'layer-bloques-venezuela-label';

    if (map.getSource(BLOQUE_LABEL_SOURCE_ID)) {
      map.getSource(BLOQUE_LABEL_SOURCE_ID).setData(puntosEtiquetasBloques);
    } else {
      map.addSource(BLOQUE_LABEL_SOURCE_ID, {
        type: 'geojson',
        data: puntosEtiquetasBloques,
        generateId: true
      });
    }

    if (map.getSource(BLOQUE_SOURCE_ID)) {
      map.getSource(BLOQUE_SOURCE_ID).setData(data);
    } else {
      map.addSource(BLOQUE_SOURCE_ID, {
        type: 'geojson',
        data: data,
        generateId: true
      });
    }

    if (!map.getLayer(BLOQUE_LAYER_ID)) {
      map.addLayer({
        id: BLOQUE_LAYER_ID,
        type: 'fill',
        source: BLOQUE_SOURCE_ID,
        layout: { visibility: 'none' },
        paint: {
          'fill-color': '#8a4baf',
          'fill-opacity': [
            'case',
            ['boolean', ['feature-state', 'bloque-hover'], false], 0.12,
            0
          ]
        }
      });
    }

    if (!map.getLayer(BLOQUE_FILTER_LINE_LAYER_ID)) {
      map.addLayer({
        id: BLOQUE_FILTER_LINE_LAYER_ID,
        type: 'line',
        source: BLOQUE_SOURCE_ID,
        layout: { visibility: 'none' },
        paint: {
          'line-color': '#8a4baf',
          'line-width': [
            'case',
            ['boolean', ['feature-state', 'selected'], false], 3,
            1
          ]
        }
      });
    }

    if (!map.getLayer(BLOQUE_THEMATIC_LINE_LAYER_ID)) {
      map.addLayer({
        id: BLOQUE_THEMATIC_LINE_LAYER_ID,
        type: 'line',
        source: BLOQUE_SOURCE_ID,
        layout: { visibility: 'none' },
        paint: {
          'line-color': '#8a4baf',
          'line-width': 1
        }
      });
    }

    if (map.getLayer(BLOQUE_LABEL_LAYER_ID)) {
      map.removeLayer(BLOQUE_LABEL_LAYER_ID);
    }
    const styleBloques = getStyleCapa(BLOQUES_LAYER_NAME);
    const attrBloques = styleBloques?.label_attribute || 'nombre_bloque';
    const claveBloques =
      resolverClaveProp(puntosEtiquetasBloques.features[0]?.properties, attrBloques) || attrBloques;
    map.addLayer({
      id: BLOQUE_LABEL_LAYER_ID,
      type: 'symbol',
      source: BLOQUE_LABEL_SOURCE_ID,
      layout: {
        'visibility': 'none',
        'text-field': ['get', claveBloques],
        'text-font': ['Open Sans Regular'],
        'text-size': [
          'interpolate', ['exponential', 1.5], ['zoom'],
          3, 8,
          6, 10,
          10, 12,
          14, 14,
        ],
        'text-max-width': [
          'interpolate', ['linear'], ['zoom'],
          3, 4,
          6, 6,
          10, 10,
        ],
        'text-line-height': 1.15,
        'text-allow-overlap': false,
        'text-ignore-placement': false,
        'text-justify': 'center',
        'symbol-placement': 'point'
      },
      paint: {
        'text-color': styleBloques?.label_color || '#3b1650',
        'text-halo-color': '#ffffff',
        'text-halo-width': [
          'interpolate', ['linear'], ['zoom'],
          3, 1,
          10, 1.4,
        ],
      }
    });

    if (!map.listenedClicks) map.listenedClicks = new Set();
    if (!map.listenedClicks.has(BLOQUE_LAYER_ID)) {
      map.listenedClicks.add(BLOQUE_LAYER_ID);
      let hoveredBloqueId = null;

      map.on('mousemove', BLOQUE_LAYER_ID, (e) => {
        map.getCanvas().style.cursor = 'pointer';
        if (e.features.length > 0) {
          if (hoveredBloqueId !== null) {
            map.setFeatureState({ source: BLOQUE_SOURCE_ID, id: hoveredBloqueId }, { 'bloque-hover': false });
          }
          hoveredBloqueId = e.features[0].id;
          map.setFeatureState({ source: BLOQUE_SOURCE_ID, id: hoveredBloqueId }, { 'bloque-hover': true });
        }
      });

      map.on('mouseleave', BLOQUE_LAYER_ID, () => {
        map.getCanvas().style.cursor = '';
        if (hoveredBloqueId !== null) {
          map.setFeatureState({ source: BLOQUE_SOURCE_ID, id: hoveredBloqueId }, { 'bloque-hover': false });
        }
        hoveredBloqueId = null;
      });

      map.on('click', BLOQUE_LAYER_ID, (ev) => {
        if (!ev.features || ev.features.length === 0) return;
        const props = ev.features[0].properties;
        if (typeof window.handleFeatureClick === 'function') {
          window.handleFeatureClick(BLOQUES_LAYER_NAME, props, ev.lngLat);
        }
      });
    }

    updateLayerFeatureCount(BLOQUES_LAYER_NAME, data.features.length);
  } catch (error) {
    console.error('Error al cargar la capa de bloques:', error);
    mostrarError('No se pudo cargar la capa de bloques. Verifica que el backend esté funcionando.');
  } finally {
    mostrarCargando(false);
  }
}

// =========================================================================
// ETIQUETAS GENÉRICAS POR CAPA
// Crea/actualiza/elimina la capa symbol "{tableName}-labels" según la
// configuración del analista (show_labels, label_attribute, label_color).
// Ocultas por defecto: sin config → no hay etiquetas.
// =========================================================================
function labelsIds(tableName) {
  return {
    layerId: `layer-${tableName}-labels`,
    sourceId: `source-${tableName}-labels`,
  };
}

function quitarEtiquetasCapa(tableName) {
  const map = getMap();
  const { layerId, sourceId } = labelsIds(tableName);
  try {
    if (map.getLayer(layerId)) map.removeLayer(layerId);
    if (map.getSource(sourceId)) map.removeSource(sourceId);
  } catch (e) { /* fuente en uso por filtros u otra capa */ }
}

function aplicarEtiquetasCapa(tableName, data, style) {
  const map = getMap();
  const { layerId, sourceId } = labelsIds(tableName);
  quitarEtiquetasCapa(tableName);

  if (!style?.show_labels || !style?.label_attribute) return;

  const features = data?.features || [];
  if (!features.length) return;

  // Resolver el atributo contra las properties reales (tolerante a mayúsculas)
  const primerasProps = features[0]?.properties || {};
  const claveAttr =
    resolverClaveProp(primerasProps, style.label_attribute) || style.label_attribute;

  const puntos = { type: 'FeatureCollection', features: [] };
  features.forEach((f) => {
    try {
      const gtype = f.geometry?.type;
      let punto;
      const props = f.properties || {};
      const valor = props[claveAttr] ?? props[style.label_attribute];
      const propsLabel = { ...props, _label: valor == null ? '' : String(valor) };
      if (gtype === 'Point') {
        punto = { type: 'Feature', properties: propsLabel, geometry: f.geometry };
      } else {
        punto = turf.centerOfMass(f);
        punto.properties = propsLabel;
      }
      puntos.features.push(punto);
    } catch (e) { /* feature sin geometría válida */ }
  });
  if (!puntos.features.length) return;

  map.addSource(sourceId, {
    type: 'geojson',
    data: puntos,
    generateId: true,
  });
  map.addLayer({
    id: layerId,
    type: 'symbol',
    source: sourceId,
    layout: {
      'text-field': ['get', '_label'],
      'text-font': ['Open Sans Regular'],
      // Zoom bajo: texto pequeño y con ajuste de línea para que quepa
      // dentro del polígono; zoom alto: tamaño normal.
      'text-size': [
        'interpolate', ['exponential', 1.5], ['zoom'],
        3, 8,
        6, 10,
        10, 12,
        14, 14,
      ],
      'text-max-width': [
        'interpolate', ['linear'], ['zoom'],
        3, 4,
        6, 6,
        10, 10,
      ],
      'text-line-height': 1.15,
      'text-allow-overlap': false,
      'text-ignore-placement': false,
      'text-justify': 'center',
      'symbol-placement': 'point',
    },
    paint: {
      'text-color': style.label_color || '#3b1650',
      'text-halo-color': '#ffffff',
      'text-halo-width': [
        'interpolate', ['linear'], ['zoom'],
        3, 1,
        10, 1.4,
      ],
    },
  });
}

// =========================================================================
// MANEJADOR DE TOGGLE DE CAPAS
// =========================================================================
let isLoading = false;

async function handleLayerToggle(tableName, isVisible, toggleBtn, rowTarget) {
  if (isLoading) return;
  isLoading = true;

  if (!isVisible) closeFeaturePopup(tableName);

  try {
    const map = getMap();
    const shortName = tableName.split(':').pop();

    if (shortName === 'División Político Territorial') {
      const vis = isVisible ? 'visible' : 'none';
      if (map.getLayer('layer-estados-venezuela-line')) {
        map.setLayoutProperty('layer-estados-venezuela-line', 'visibility', vis);
      }
      // Las etiquetas de los estados quedan siempre visibles.
      if (map.getLayer('layer-estados-venezuela-label')) {
        map.setLayoutProperty('layer-estados-venezuela-label', 'visibility', 'visible');
      }
      updateLegendUI(getAvailableLayers());
      renderInfoPanel();
      isLoading = false;
      return;
    }

    if (shortName === BLOQUES_LAYER_NAME) {
      const vis = isVisible ? 'visible' : 'none';
      const styleBloques = getStyleCapa(BLOQUES_LAYER_NAME);
      const visLabels = (isVisible && styleBloques?.show_labels) ? 'visible' : 'none';
      const fillLayer = map.getLayer('layer-bloques-venezuela-fill');
      const lineLayer = map.getLayer('layer-bloques-venezuela-thematic-line');
      const labelLayer = map.getLayer('layer-bloques-venezuela-label');

      if (fillLayer) {
        map.setLayoutProperty('layer-bloques-venezuela-fill', 'visibility', vis);
      }
      if (lineLayer) {
        map.setLayoutProperty('layer-bloques-venezuela-thematic-line', 'visibility', vis);
      }
      if (labelLayer) {
        map.setLayoutProperty('layer-bloques-venezuela-label', 'visibility', visLabels);
      } else {
        setTimeout(() => {
          const retryLabel = map.getLayer('layer-bloques-venezuela-label');
          if (retryLabel) {
            map.setLayoutProperty('layer-bloques-venezuela-label', 'visibility', visLabels);
          }
        }, 500);
      }

      if (!isVisible) {
        clearSelectedLayerMetadataIfMatches(BLOQUES_LAYER_NAME);
      }
      updateLegendUI(getAvailableLayers());
      renderInfoPanel();
      isLoading = false;
      return;
    }

    const sourceId = `source-${tableName}`;
    const layerId = `layer-${tableName}`;

    // ---- Capas raster (WMS): sin GeoJSON, sin conteo de features ----
    const layerInfo = getAvailableLayers().find(l => l.id === tableName);
    if (isRasterLayer(layerInfo)) {
      if (isVisible) {
        mostrarCargando(true);
        try {
          addRasterLayerToMap(layerInfo, map);
          await esperarMapaListo(map);
        } finally {
          mostrarCargando(false);
        }
      } else {
        removeRasterLayer(tableName, map);
        clearSelectedLayerMetadataIfMatches(tableName);
      }
      refreshCount();
      updateLegendUI(getAvailableLayers());
      renderInfoPanel();
      isLoading = false;
      return;
    }

    if (isVisible) {
      mostrarCargando(true);
      try {
        await loadLayerToMap(tableName, map, getAvailableLayers(), (tn, srcId, lyrId, featureCount) => {
          updateLayerFeatureCount(tn, featureCount);

          const style = getStyleCapa(tableName);
          if (style) {
            const layerConfig = getAvailableLayers().find(l => l.id === tableName);
            applyStyle(map, `layer-${tableName}`, layerConfig?.type || 'fill', style);
          }
        });
        aplicarEtiquetasCapa(tableName, getLayerRawData(tableName), getStyleCapa(tableName));
        // Mantiene el loader hasta que la capa ya está pintada en el mapa
        await esperarMapaListo(map);
      } finally {
        mostrarCargando(false);
      }
    } else {
      quitarEtiquetasCapa(tableName);
      if (map.getLayer(layerId)) map.removeLayer(layerId);
      if (map.getSource(sourceId)) map.removeSource(sourceId);

      
      clearLayerRawData(tableName);

      if (getSelectedSourceId() === sourceId) {
        clearSelection();
      }
      clearSelectedLayerMetadataIfMatches(tableName);
    }

    refreshCount();
    updateLegendUI(getAvailableLayers());
    renderInfoPanel();
    bringVenezuelaBoundaryToFront(map);
    bringMapLabelsToFront(map);

       if (!IS_SHOWROOM && typeof recalcularFiltrosActivos === 'function') {
      // Mostrar loader sobre la(s) tarjeta(s) de filtro
      pushFilterLoading();

      setTimeout(() => {
        try {
          recalcularFiltrosActivos();
        } catch (e) {
          console.error('Error al recalcular filtros:', e);
        } finally {
          // Dejar un pequeño respiro para que se vea el spinner
          setTimeout(() => popFilterLoading(), 150);
        }
      }, 300);
    }
  } catch (error) {
    console.error('Error al cargar la capa:', error);
    mostrarError(`No se pudo cargar la capa "${tableName}". Verifica que esté publicada en GeoServer.`);
    toggleBtn.classList.remove('on');
    rowTarget.classList.add('off');
    refreshCount();
    updateLegendUI(getAvailableLayers());
  } finally {
    isLoading = false;
  }
}

// =========================================================================
// CÁLCULO DE PUNTOS EN POLÍGONOS (para filtros)
// 👇 AHORA LEEN DEL CACHÉ DE DATOS CRUDOS, NO DEL SOURCE DE MAPLIBRE
// =========================================================================
function calcularPuntosEnEstado(estadoPolygonFeature, nombreEstado) {
  const infoContent = document.getElementById('infoPanelContent');
  if (!infoContent) return;

  let totalPuntosGeneral = 0;
  let capasContadas = 0;
  let capasDetalleMap = {};
  let rowsHtml = '';

  const layers = getAvailableLayers();
  const map = getMap();

  layers.forEach(layerConfig => {
    const sourceId = `source-${layerConfig.id}`;
    const source = map.getSource(sourceId);
    if (!source) return; // capa no activa en el mapa

    // 👇 Leer SIEMPRE del caché de datos crudos, NUNCA del source.
    const sourceData = getLayerRawData(layerConfig.id);
    if (!sourceData || !Array.isArray(sourceData.features) || sourceData.features.length === 0) return;

    // Detección de capa de puntos
    const firstGeomType = sourceData.features[0]?.geometry?.type;
    const isPointLayer =
      layerConfig.type === 'circle' ||
      layerConfig.type === 'point' ||
      layerConfig.type === 'Point' ||
      layerConfig.type === 'Punto' ||
      firstGeomType === 'Point' ||
      firstGeomType === 'MultiPoint';

    if (!isPointLayer) return;

    let countInPolygon = 0;
    let featuresInLayer = [];

    sourceData.features.forEach(ptFeature => {
      if (!ptFeature || !ptFeature.geometry) return;
      if (ptFeature.geometry.type !== 'Point' && ptFeature.geometry.type !== 'MultiPoint') return;
      try {
        if (turf.booleanPointInPolygon(ptFeature, estadoPolygonFeature)) {
          countInPolygon++;
          featuresInLayer.push(ptFeature.properties);
        }
      } catch (_) { /* geometría inválida, ignorar */ }
    });

    if (countInPolygon > 0) {
      capasContadas++;
      totalPuntosGeneral += countInPolygon;
      capasDetalleMap[layerConfig.name] = featuresInLayer;
      rowsHtml += `<tr><td style="padding:4px;">${layerConfig.name}</td><td style="text-align:right; padding:4px; font-weight:bold;">${countInPolygon}</td></tr>`;
    }
  });

  currentFilterData = {
    estadoSeleccionado: nombreEstado,
    totalPuntosGeneral,
    capasContadas,
    capasDetalleMap,
    rowsHtml
  };

  setInfoPanelData({ currentFilterData, isFilterActive: true });
  renderInfoPanel();
}

function calcularPuntosEnBloque(bloquePolygonFeature, nombreBloque) {
  const infoContent = document.getElementById('infoPanelContent');
  if (!infoContent) return;

  let totalPuntosGeneral = 0;
  let capasContadas = 0;
  let capasDetalleMap = {};
  let rowsHtml = '';

  const layers = getAvailableLayers();
  const map = getMap();

  layers.forEach(layerConfig => {
    const sourceId = `source-${layerConfig.id}`;
    const source = map.getSource(sourceId);
    if (!source) return; // capa no activa en el mapa

    // 👇 Leer SIEMPRE del caché de datos crudos, NUNCA del source.
    const sourceData = getLayerRawData(layerConfig.id);
    if (!sourceData || !Array.isArray(sourceData.features) || sourceData.features.length === 0) return;

    const firstGeomType = sourceData.features[0]?.geometry?.type;
    const isPointLayer =
      layerConfig.type === 'circle' ||
      layerConfig.type === 'point' ||
      layerConfig.type === 'Point' ||
      layerConfig.type === 'Punto' ||
      firstGeomType === 'Point' ||
      firstGeomType === 'MultiPoint';

    if (!isPointLayer) return;

    let countInPolygon = 0;
    let featuresInLayer = [];

    sourceData.features.forEach(ptFeature => {
      if (!ptFeature || !ptFeature.geometry) return;
      if (ptFeature.geometry.type !== 'Point' && ptFeature.geometry.type !== 'MultiPoint') return;
      try {
        if (turf.booleanPointInPolygon(ptFeature, bloquePolygonFeature)) {
          countInPolygon++;
          featuresInLayer.push(ptFeature.properties);
        }
      } catch (_) { /* ignore */ }
    });

    if (countInPolygon > 0) {
      capasContadas++;
      totalPuntosGeneral += countInPolygon;
      capasDetalleMap[layerConfig.name] = featuresInLayer;
      rowsHtml += `<tr><td style="padding:4px;">${layerConfig.name}</td><td style="text-align:right; padding:4px; font-weight:bold;">${countInPolygon}</td></tr>`;
    }
  });

  currentBloqueFilterData = {
    bloqueSeleccionado: nombreBloque,
    totalPuntosGeneral,
    capasContadas,
    capasDetalleMap,
    rowsHtml
  };

  setInfoPanelData({ currentBloqueFilterData, isBloqueFilterActive: true });
  renderInfoPanel();
}

// =========================================================================
// CÁLCULO DE ELEMENTOS EN EL ÁREA TEMPORAL / INTERSECCIÓN
// =========================================================================
function geometriaDentroDePoligono(feature, polygonFeature) {
  const tipo = feature?.geometry?.type;
  if (!tipo) return false;

  try {
    if (tipo === 'Point') {
      return turf.booleanPointInPolygon(feature, polygonFeature);
    }
    if (tipo === 'MultiPoint') {
      // booleanIntersects cubre correctamente los multipuntos.
      return turf.booleanIntersects(feature, polygonFeature);
    }
    if (tipo === 'LineString' || tipo === 'MultiLineString') {
      return turf.booleanIntersects(feature, polygonFeature);
    }
  } catch (_) {
    return false;
  }
  return false;
}

function analizarCapasEnPoligonos({ estadoFeature = null, areaFeature = null } = {}) {
  let totalElementos = 0;
  let capasContadas = 0;
  const capasDetalleMap = {};
  let rowsHtml = '';

  const layers = getAvailableLayers();
  const map = getMap();

  layers.forEach(layerConfig => {
    const sourceId = `source-${layerConfig.id}`;
    const source = map.getSource(sourceId);
    if (!source) return; // capa no activa en el mapa

    const sourceData = getLayerRawData(layerConfig.id);
    if (!sourceData || !Array.isArray(sourceData.features) || sourceData.features.length === 0) return;

    const firstGeomType = sourceData.features[0]?.geometry?.type;
    const tipo = (layerConfig.type || '').toLowerCase();
    const esPunto =
      tipo === 'circle' || tipo === 'point' || tipo === 'punto' ||
      firstGeomType === 'Point' || firstGeomType === 'MultiPoint';
    const esLinea =
      tipo === 'line' ||
      firstGeomType === 'LineString' || firstGeomType === 'MultiLineString';

    if (!esPunto && !esLinea) return;

    let countInPoligonos = 0;
    const featuresInLayer = [];

    sourceData.features.forEach(feature => {
      if (!feature || !feature.geometry) return;

      if (estadoFeature && !geometriaDentroDePoligono(feature, estadoFeature)) return;
      if (areaFeature && !geometriaDentroDePoligono(feature, areaFeature)) return;

      countInPoligonos++;
      featuresInLayer.push(feature.properties);
    });

    if (countInPoligonos > 0) {
      capasContadas++;
      totalElementos += countInPoligonos;
      capasDetalleMap[layerConfig.name] = featuresInLayer;
      rowsHtml += `<tr><td style="padding:4px;">${layerConfig.name}</td><td style="text-align:right; padding:4px; font-weight:bold;">${countInPoligonos}</td></tr>`;
    }
  });

  return { totalElementos, capasContadas, capasDetalleMap, rowsHtml };
}

function calcularElementosEnArea(areaPolygonFeature, nombreArea) {
  const infoContent = document.getElementById('infoPanelContent');
  if (!infoContent) return;

  const { totalElementos, capasContadas, capasDetalleMap, rowsHtml } =
    analizarCapasEnPoligonos({ areaFeature: areaPolygonFeature });

  currentAreaFilterData = {
    areaSeleccionada: nombreArea,
    totalElementos,
    capasContadas,
    capasDetalleMap,
    rowsHtml
  };

  setInfoPanelData({ currentAreaFilterData, isAreaFilterActive: true });
  renderInfoPanel();
}

function calcularElementosEnInterseccion(estadoPolygonFeature, areaPolygonFeature, nombreEstado, nombreArea) {
  const infoContent = document.getElementById('infoPanelContent');
  if (!infoContent) return;

  const { totalElementos, capasContadas, capasDetalleMap, rowsHtml } =
    analizarCapasEnPoligonos({
      estadoFeature: estadoPolygonFeature,
      areaFeature: areaPolygonFeature
    });

  currentIntersectionFilterData = {
    interseccionSeleccionada: `${nombreEstado} + ${nombreArea}`,
    estadoSeleccionado: nombreEstado,
    areaSeleccionada: nombreArea,
    totalElementos,
    capasContadas,
    capasDetalleMap,
    rowsHtml
  };

  setInfoPanelData({
    currentIntersectionFilterData,
    isIntersectionFilterActive: true
  });
  renderInfoPanel();
}

// =========================================================================
// FUNCIONES DE UI
// =========================================================================
function setupSidebarToggle() {
  const sidebar = document.getElementById('sidebar');
  const toggleBtn = document.getElementById('sidebarToggleBtn');
  const appContainer = document.querySelector('.app');
  if (!sidebar || !toggleBtn || !appContainer) return;

  toggleBtn.addEventListener('click', () => {
    const willCollapse = !sidebar.classList.contains('collapsed');
    sidebar.classList.toggle('collapsed', willCollapse);
    appContainer.classList.toggle('has-collapsed-sidebar', willCollapse);
    setTimeout(() => getMap().resize(), 300);
  });
}

function setupInfoPanelToggle() {
  const infoPanel = document.getElementById('infoPanel');
  const toggleBtn = document.getElementById('infoToggleBtn');
  const appContainer = document.querySelector('.app');
  if (!infoPanel || !toggleBtn || !appContainer) return;

  toggleBtn.addEventListener('click', () => {
    const willCollapse = !infoPanel.classList.contains('collapsed');
    infoPanel.classList.toggle('collapsed', willCollapse);
    appContainer.classList.toggle('has-collapsed-info', willCollapse);
    setTimeout(() => getMap().resize(), 300);
  });
}

// =========================================================================
// CIERRE DE SESIÓN
// =========================================================================
function cerrarSesion() {
  localStorage.removeItem('auth_token');
  localStorage.removeItem('auth_session');
  sessionStorage.clear();
  window.location.href = '/login';
}