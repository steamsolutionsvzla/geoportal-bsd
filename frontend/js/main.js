// main.js - Punto de entrada principal
import { initMap, setupCompass, setupStatusBar, addBaseLayers, setupZoomControls, setupBasemapSwitcher, getMap } from './map-config.js';
import { setupFilterDropdowns, limpiarFiltroEstado as filtroEstadoOriginal, limpiarFiltroBloque as filtroBloqueOriginal, setEstadosCache, setBloquesCache } from './filters.js';
import { renderInfoPanel, setInfoPanelData } from './info-panel.js';
import { obtenerNombreEstado, obtenerNombreBloque, refreshCount, updateLegendUI, getPaletteForType, hashCode } from './utils.js';
import { setAvailableLayers, renderLayerGroups, attachLayerToggleEvents, loadLayerToMap, getAvailableLayers, getSelectedSourceId, getSelectedFeatureId, setSelectedSourceId, setSelectedFeatureId, clearSelection, updateLayerFeatureCount, attachLayerOpacityEvents } from './layer-manager.js';

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
// =========================================================================
function mostrarCargando(mostrar) {
  let loader = document.getElementById('map-loader');
  const mapContainer = document.getElementById('map');
  if (!loader && mapContainer) {
    loader = document.createElement('div');
    loader.id = 'map-loader';
    loader.style.cssText = 'position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); background: rgba(15, 23, 42, 0.85); color: white; padding: 12px 18px; border-radius: 8px; font-size: 0.85rem; z-index: 1000; display: flex; align-items: center; gap: 10px; box-shadow: 0 4px 10px rgba(0,0,0,0.2); backdrop-filter: blur(4px); pointer-events: none;';
    loader.innerHTML = '<div style="width: 16px; height: 16px; border: 2px solid #38bdf8; border-top-color: transparent; border-radius: 50%; animation: spin 0.8s linear infinite;"></div> <span>Cargando datos...</span>';
    const style = document.createElement('style');
    style.textContent = '@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }';
    document.head.appendChild(style);
    mapContainer.appendChild(loader);
  }
  if (loader) loader.style.display = mostrar ? 'flex' : 'none';
}

// =========================================================================
// VARIABLES GLOBALES
// =========================================================================
let availableLayers = [];
let estadosGeoJsonCache = null;
let bloquesGeoJsonCache = null;
let currentPointData = null;
let currentFilterData = null;
let currentBloqueFilterData = null;
let currentBloqueLayerData = null;
let isFilterActive = false;
let isBloqueFilterActive = false;
let estadoSeleccionado = '';
let bloqueSeleccionado = '';

// =========================================================================
// INICIALIZACIÓN
// =========================================================================
document.addEventListener('DOMContentLoaded', async () => {
  // Inicializar el mapa directamente (sin cargar configuración del backend)
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

    // Cargar workspaces y capas especiales
    (async () => {
      await loadWorkspaces();
      await cargarCapaEstadosVenezuela();
      await cargarCapaBloques();
      if (estadosGeoJsonCache && bloquesGeoJsonCache) {
        setupFilterDropdowns(estadosGeoJsonCache, bloquesGeoJsonCache);
      } else {
        mostrarError('No se pudieron cargar los datos de estados o bloques.');
      }

      const sidebar = document.getElementById('sidebar');
      attachLayerToggleEvents(sidebar, handleLayerToggle);
      attachLayerOpacityEvents(sidebar);
    })();

    // Definir funciones de limpieza de filtros (se usan en el HTML o en otros eventos)
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

    // Exponer funciones globales para uso desde otros módulos o eventos
    window.handleFeatureClick = (tableName, props) => {
      currentPointData = { tableName, props };
      setInfoPanelData({ currentPointData });
      renderInfoPanel();
    };

    // MODIFICACIÓN: ahora reciben el nombre como segundo parámetro
    window.calcularPuntosEnEstado = (feature, nombre) => calcularPuntosEnEstado(feature, nombre);
    window.calcularPuntosEnBloque = (feature, nombre) => calcularPuntosEnBloque(feature, nombre);
    window.updateInfoPanel = renderInfoPanel;
    window.limpiarFiltroEstado = limpiarFiltroEstado;
    window.limpiarFiltroBloque = limpiarFiltroBloque;
    window.cerrarSesion = cerrarSesion;

    // Event listeners de la UI
    document.querySelector('.logout-btn')?.addEventListener('click', cerrarSesion);
    document.querySelector('.icon-btn[title="Ajustes"]')?.addEventListener('click', () => {
      alert('Ajustes aún no implementados');
    });

    // Leyenda
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
    const response = await fetch('/api/v1/layers/workspaces');
    if (!response.ok) {
      throw new Error(`Error ${response.status}: ${response.statusText}`);
    }
    const groups = await response.json();

    groups.forEach(group => {
      group.layers.forEach(layer => {
        const id = layer.id.split(':').pop();
        if (id === 'dpt_estadal_venezuela' || id === 'BLOQUES') {
          layer.type = 'fill';
          if (id === 'dpt_estadal_venezuela') {
            layer.color = '#1a365d';
          } else if (id === 'BLOQUES') {
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
async function cargarCapaEstadosVenezuela() {
  try {
    ocultarError();
    mostrarCargando(true);
    const response = await fetch('/api/v1/layers/dpt_estadal_venezuela');
    if (!response.ok) {
      throw new Error(`Error ${response.status}: ${response.statusText}`);
    }
    const data = await response.json();

    // Fusionar geometrías por nombre de estado
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
    estadosGeoJsonCache = data;
    setEstadosCache(data);

    // Generar puntos de etiquetas (centroides)
    const puntosEtiquetas = {
      type: 'FeatureCollection',
      features: []
    };
    data.features.forEach(f => {
      try {
        const centroide = turf.centerOfMass(f);
        centroide.properties = { ...f.properties };
        puntosEtiquetas.features.push(centroide);
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
          'line-color': '#1a365d',
          'line-width': [
            'case',
            ['boolean', ['feature-state', 'selected'], false], 3,
            ['==', ['literal', isFilterActive], true], 0,
            1
          ]
        }
      });
    }

    if (!map.getLayer(ESTADO_LABEL_LAYER_ID)) {
      map.addLayer({
        id: ESTADO_LABEL_LAYER_ID,
        type: 'symbol',
        source: ESTADO_LABEL_SOURCE_ID,
        layout: {
          'visibility': 'none',
          'text-field': ['get', 'entidad'],
          'text-font': ['Open Sans Bold'],
          'text-size': 11,
          'text-allow-overlap': false,
          'text-ignore-placement': false,
          'text-justify': 'center',
          'symbol-placement': 'point'
        },
        paint: {
          'text-color': '#1a2a3a',
          'text-halo-color': '#ffffff',
          'text-halo-width': 1.8
        }
      });
    }

    updateLayerFeatureCount('dpt_estadal_venezuela', data.features.length);
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
    const response = await fetch('/api/v1/layers/BLOQUES');
    if (!response.ok) {
      throw new Error(`Error ${response.status}: ${response.statusText}`);
    }
    const data = await response.json();
    bloquesGeoJsonCache = data;
    setBloquesCache(data);

    const map = getMap();
    const BLOQUE_SOURCE_ID = 'source-bloques-venezuela';
    const BLOQUE_LAYER_ID = 'layer-bloques-venezuela-fill';
    const BLOQUE_FILTER_LINE_LAYER_ID = 'layer-bloques-venezuela-filter-line';
    const BLOQUE_THEMATIC_LINE_LAYER_ID = 'layer-bloques-venezuela-thematic-line';
    const BLOQUE_LABEL_LAYER_ID = 'layer-bloques-venezuela-label';

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
        layout: { visibility: 'visible' },
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
    map.addLayer({
      id: BLOQUE_LABEL_LAYER_ID,
      type: 'symbol',
      source: BLOQUE_SOURCE_ID,
      layout: {
        'visibility': 'none',
        'text-field': ['get', 'bloque'],
        'text-font': ['Open Sans Bold'],
        'text-size': 12,
        'text-allow-overlap': false,
        'text-justify': 'center'
      },
      paint: {
        'text-color': '#3b1650',
        'text-halo-color': '#ffffff',
        'text-halo-width': 1.4
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
        currentBloqueLayerData = ev.features[0].properties;
        setInfoPanelData({ currentBloqueLayerData });
        renderInfoPanel();
      });
    }

    updateLayerFeatureCount('BLOQUES', data.features.length);
  } catch (error) {
    console.error('Error al cargar la capa de bloques:', error);
    mostrarError('No se pudo cargar la capa de bloques. Verifica que el backend esté funcionando.');
  } finally {
    mostrarCargando(false);
  }
}

// =========================================================================
// MANEJADOR DE TOGGLE DE CAPAS
// =========================================================================
let isLoading = false;

async function handleLayerToggle(tableName, isVisible, toggleBtn, rowTarget) {
  if (isLoading) return;
  isLoading = true;

  try {
    const map = getMap();
    const shortName = tableName.split(':').pop(); // Extrae el nombre sin workspace

    if (shortName === 'dpt_estadal_venezuela') {
      const vis = isVisible ? 'visible' : 'none';
      if (map.getLayer('layer-estados-venezuela-line')) {
        map.setLayoutProperty('layer-estados-venezuela-line', 'visibility', vis);
      }
      updateLegendUI(getAvailableLayers());
      renderInfoPanel();
      isLoading = false;
      return;
    }

    if (shortName === 'BLOQUES') {
      const vis = isVisible ? 'visible' : 'none';
      const lineLayer = map.getLayer('layer-bloques-venezuela-thematic-line');
      const labelLayer = map.getLayer('layer-bloques-venezuela-label');

      if (lineLayer) {
        map.setLayoutProperty('layer-bloques-venezuela-thematic-line', 'visibility', vis);
      }
      if (labelLayer) {
        map.setLayoutProperty('layer-bloques-venezuela-label', 'visibility', vis);
      } else {
        setTimeout(() => {
          const retryLabel = map.getLayer('layer-bloques-venezuela-label');
          if (retryLabel) {
            map.setLayoutProperty('layer-bloques-venezuela-label', 'visibility', vis);
          }
        }, 500);
      }

      if (!isVisible) {
        currentBloqueLayerData = null;
        setInfoPanelData({ currentBloqueLayerData: null });
      }
      updateLegendUI(getAvailableLayers());
      renderInfoPanel();
      isLoading = false;
      return;
    }

    // Capas normales
    const sourceId = `source-${tableName}`;
    const layerId = `layer-${tableName}`;

    if (isVisible) {
      await loadLayerToMap(tableName, map, getAvailableLayers(), (tn, srcId, lyrId, featureCount) => {
        updateLayerFeatureCount(tn, featureCount);
      });
    } else {
      if (map.getLayer(layerId)) map.removeLayer(layerId);
      if (map.getSource(sourceId)) map.removeSource(sourceId);
      if (getSelectedSourceId() === sourceId) {
        clearSelection();
      }
      if (currentPointData && currentPointData.tableName === tableName) {
        currentPointData = null;
        setInfoPanelData({ currentPointData: null });
      }
    }

    refreshCount();
    updateLegendUI(getAvailableLayers());
    renderInfoPanel();
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
// CÁLCULO DE PUNTOS EN POLÍGONOS (para filtros) - MODIFICADO
// =========================================================================
function calcularPuntosEnEstado(estadoPolygonFeature, nombreEstado) {
  const infoContent = document.getElementById('infoPanelContent');
  if (!infoContent) return;

  let totalPuntosGeneral = 0;
  let capasContadas = 0;
  let capasDetalleMap = {};
  let rowsHtml = '';

  const layers = getAvailableLayers();
  layers.forEach(layerConfig => {
    const sourceId = `source-${layerConfig.id}`;
    const source = getMap().getSource(sourceId);

    if (source && (layerConfig.type === 'circle' || layerConfig.type === 'point')) {
      const sourceData = source._data;
      if (sourceData && sourceData.features) {
        let countInPolygon = 0;
        let featuresInLayer = [];

        sourceData.features.forEach(ptFeature => {
          if (typeof turf !== 'undefined' && turf.booleanPointInPolygon(ptFeature, estadoPolygonFeature)) {
            countInPolygon++;
            featuresInLayer.push(ptFeature.properties);
          }
        });

        if (countInPolygon > 0) {
          capasContadas++;
          totalPuntosGeneral += countInPolygon;
          capasDetalleMap[layerConfig.name] = featuresInLayer;
          rowsHtml += `<tr><td style="padding:4px;">${layerConfig.name}</td><td style="text-align:right; padding:4px; font-weight:bold;">${countInPolygon}</td></tr>`;
        }
      }
    }
  });

  currentFilterData = {
    estadoSeleccionado: nombreEstado,  // <-- Usamos el nombre pasado como parámetro
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
  layers.forEach(layerConfig => {
    const sourceId = `source-${layerConfig.id}`;
    const source = getMap().getSource(sourceId);

    if (source && (layerConfig.type === 'circle' || layerConfig.type === 'point')) {
      const sourceData = source._data;
      if (sourceData && sourceData.features) {
        let countInPolygon = 0;
        let featuresInLayer = [];

        sourceData.features.forEach(ptFeature => {
          if (typeof turf !== 'undefined' && turf.booleanPointInPolygon(ptFeature, bloquePolygonFeature)) {
            countInPolygon++;
            featuresInLayer.push(ptFeature.properties);
          }
        });

        if (countInPolygon > 0) {
          capasContadas++;
          totalPuntosGeneral += countInPolygon;
          capasDetalleMap[layerConfig.name] = featuresInLayer;
          rowsHtml += `<tr><td style="padding:4px;">${layerConfig.name}</td><td style="text-align:right; padding:4px; font-weight:bold;">${countInPolygon}</td></tr>`;
        }
      }
    }
  });

  currentBloqueFilterData = {
    bloqueSeleccionado: nombreBloque,  // <-- Usamos el nombre pasado como parámetro
    totalPuntosGeneral,
    capasContadas,
    capasDetalleMap,
    rowsHtml
  };

  setInfoPanelData({ currentBloqueFilterData, isBloqueFilterActive: true });
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
  localStorage.removeItem('auth_session');
  sessionStorage.clear();
  window.location.href = 'login.html';
}