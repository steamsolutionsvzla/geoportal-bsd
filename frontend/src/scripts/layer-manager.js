// layer-manager.js
import { getPaletteForType, hashCode, refreshCount, updateLegendUI } from './utils.js';
import { getMap } from './map-config.js';

let availableLayers = [];
let selectedFeatureId = null;
let selectedSourceId = null;

// Recuerda el % de opacidad elegido por el usuario para cada capa de polígonos
// (layerId -> factor 0..1), para que se respete si la capa se apaga y se vuelve a encender.
const layerOpacityFactors = {};

// Etiquetas de geometría para el contador de elementos por capa
const GEOM_LABELS = {
  circle: { one: 'punto', many: 'puntos' },
  point: { one: 'punto', many: 'puntos' },
  line: { one: 'línea', many: 'líneas' },
  fill: { one: 'polígono', many: 'polígonos' }
};

function buildFillOpacityExpression(factor) {
  return [
    '*',
    factor,
    [
      'case',
      ['boolean', ['feature-state', 'selected'], false], 0.9,
      ['boolean', ['feature-state', 'hover'], false], 0.8,
      0.4
    ]
  ];
}

export function setAvailableLayers(layers) {
  availableLayers = layers;
}

export function getAvailableLayers() {
  return availableLayers;
}

// ================================================================
// Nombre legible de una capa (usado en el panel de metadatos y en
// los popups de atributos sobre el mapa)
// ================================================================
export function getLayerDisplayName(tableName) {
  if (tableName === 'dpt_estadal_venezuela') return 'Entidades Federales (Estados)';
  if (tableName === 'BLOQUES') return 'Bloques';
  const layerConfig = availableLayers.find(l => l.id === tableName);
  return layerConfig ? layerConfig.name : tableName;
}

// ================================================================
// Renderizar grupos de capas (workspaces) con acordeón
// ================================================================
export function renderLayerGroups(groups, containerId) {
  const container = document.getElementById(containerId);
  if (!container) {
    console.error('❌ Contenedor no encontrado:', containerId);
    return;
  }

  container.innerHTML = '';

 // DESPUÉS
  groups.forEach((group) => {
    const groupDiv = document.createElement('div');
    groupDiv.className = 'layer-group';

    const header = document.createElement('div');
    header.className = 'group-header';
    header.innerHTML = `
      <span class="group-header-left">
        <svg class="group-folder-icon" viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
          <path d="M2.5 5.2c0-.94.76-1.7 1.7-1.7h3.4l1.6 1.9h6.6c.94 0 1.7.76 1.7 1.7v7.4c0 .94-.76 1.7-1.7 1.7H4.2c-.94 0-1.7-.76-1.7-1.7V5.2z"/>
        </svg>
        <span class="group-name">${group.title || group.name}</span>
      </span>
      <span class="group-header-right">
        <span class="group-count">${group.layers.length}</span>
        <svg class="group-chevron" viewBox="0 0 20 20" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M6 8l4 4 4-4"/>
        </svg>
      </span>
    `;
    groupDiv.appendChild(header);

    const layersContainer = document.createElement('div');
    layersContainer.className = 'group-layers';
    groupDiv.appendChild(layersContainer);

    // Orden fijo dentro de cada grupo: puntos primero, luego líneas, luego polígonos.
    const GEOM_ORDER = { circle: 0, point: 0, line: 1, fill: 2 };
    const sortedLayers = [...group.layers].sort((a, b) => {
      const orderA = GEOM_ORDER[a.type] ?? 99;
      const orderB = GEOM_ORDER[b.type] ?? 99;
      return orderA - orderB;
    });

    sortedLayers.forEach(layerInfo => {
      const row = createLayerRow(layerInfo);
      layersContainer.appendChild(row);
    });
    container.appendChild(groupDiv);

    header.addEventListener('click', () => {
      const isOpen = layersContainer.classList.toggle('open');
      header.classList.toggle('open', isOpen);
    });
  });

  refreshCount();
  updateLegendUI(getAvailableLayers());
}

// ================================================================
// (eliminamos renderLayerList, ya no se usa)
// ================================================================

function createLayerRow(layerInfo) {
  const item = document.createElement('div');
  item.className = 'layer-item';
  item.setAttribute('data-table', layerInfo.id);
  item.setAttribute('data-geom', layerInfo.type);

  const color = layerInfo.color || '#6fa3e0';
  const geomClass = (layerInfo.type === 'circle' || layerInfo.type === 'point') ? 'geom-point'
    : layerInfo.type === 'line' ? 'geom-line'
    : layerInfo.type === 'fill' ? 'geom-fill' : 'geom-point';

  const isFill = layerInfo.type === 'fill';

  item.innerHTML = `
    <div class="layer-row off">
      <div class="layer-title-container">
        <span class="layer-icon ${geomClass}" style="--geom-color: ${color};"></span>
        <div class="lname-wrap">
          <div class="lname">${layerInfo.name}</div>
          <div class="layer-count" data-count-for="${layerInfo.id}"></div>
        </div>
      </div>
      <div class="toggle" data-table="${layerInfo.id}"></div>
    </div>
    ${isFill ? `
    <div class="layer-opacity-row">
      <svg class="layer-opacity-icon" viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="8" cy="8" r="6.3"/><path d="M8 1.7a6.3 6.3 0 0 1 0 12.6z" fill="currentColor" stroke="none"/></svg>
      <input type="range" class="layer-opacity-slider" min="10" max="100" step="5" value="100" data-table="${layerInfo.id}">
      <span class="layer-opacity-value">100%</span>
    </div>` : ''}
  `;
  return item;
}

// ================================================================
// Contador de elementos (features) por capa, mostrado bajo el nombre
// ================================================================
export function updateLayerFeatureCount(tableName, count) {
  const layerInfo = availableLayers.find(l => l.id === tableName);
  if (layerInfo) layerInfo.featureCount = count;

  const geomType = layerInfo ? layerInfo.type : null;
  const labels = GEOM_LABELS[geomType] || GEOM_LABELS.fill;
  const formatted = Number(count).toLocaleString('es-VE');
  const text = `${formatted} ${count === 1 ? labels.one : labels.many}`;

  const el = document.querySelector(`.layer-count[data-count-for="${CSS.escape(tableName)}"]`);
  if (el) el.textContent = text;
}

export function clearLayerFeatureCount(tableName) {
  const layerInfo = availableLayers.find(l => l.id === tableName);
  if (layerInfo) delete layerInfo.featureCount;

  const el = document.querySelector(`.layer-count[data-count-for="${CSS.escape(tableName)}"]`);
  if (el) el.textContent = '';
}

export function attachLayerToggleEvents(sidebarElement, onLayerToggle) {
  if (!sidebarElement) return;
  sidebarElement.addEventListener('click', async (e) => {
    const rowTarget = e.target.closest('.layer-row');
    if (!rowTarget) return;
    const toggleBtn = rowTarget.querySelector('.toggle[data-table]');
    if (!toggleBtn) return;

    toggleBtn.classList.toggle('on');
    const isOn = toggleBtn.classList.contains('on');
    rowTarget.classList.toggle('off', !isOn);

    const layerItem = rowTarget.closest('.layer-item');
    if (layerItem) layerItem.classList.toggle('active', isOn);

    const tableName = toggleBtn.getAttribute('data-table');
    if (!isOn) clearLayerFeatureCount(tableName);

    // Actualizar contador y leyenda
    refreshCount();
    updateLegendUI(getAvailableLayers());

    const isVisible = toggleBtn.classList.contains('on');

    if (typeof onLayerToggle === 'function') {
      await onLayerToggle(tableName, isVisible, toggleBtn, rowTarget);
    }
  });
}

// ================================================================
// Control de opacidad para capas de polígonos (fill)
// ================================================================
export function setLayerFillOpacity(tableName, opacityPercent) {
  const map = getMap();
  const layerId = `layer-${tableName}`;
  const factor = Math.max(0, Math.min(100, Number(opacityPercent))) / 100;
  layerOpacityFactors[layerId] = factor;
  if (map.getLayer(layerId)) {
    map.setPaintProperty(layerId, 'fill-opacity', buildFillOpacityExpression(factor));
  }
}

export function attachLayerOpacityEvents(sidebarElement) {
  if (!sidebarElement) return;
  sidebarElement.addEventListener('input', (e) => {
    const slider = e.target.closest('.layer-opacity-slider');
    if (!slider) return;
    const tableName = slider.getAttribute('data-table');
    const valueLabel = slider.parentElement.querySelector('.layer-opacity-value');
    if (valueLabel) valueLabel.textContent = `${slider.value}%`;
    setLayerFillOpacity(tableName, slider.value);
  });
}

// ================================================================
// Función para cargar una capa desde el backend
// ================================================================
export async function loadLayerToMap(tableName, map, availableLayers, onSuccess, onError) {
  try {
    const response = await fetch(`/api/v1/layers/${tableName}`);
    const data = await response.json();
    if (!data.features || data.features.length === 0) {
      throw new Error('No features');
    }
    const sourceId = `source-${tableName}`;
    const layerId = `layer-${tableName}`;
    if (map.getSource(sourceId)) {
      map.getSource(sourceId).setData(data);
    } else {
      map.addSource(sourceId, {
        type: 'geojson',
        data: data,
        generateId: true
      });
    }
    addMapLayerDirectly(tableName, sourceId, layerId, availableLayers);
    if (onSuccess) onSuccess(tableName, sourceId, layerId, data.features.length);
  } catch (error) {
    if (onError) onError(tableName, error);
    throw error;
  }
}

// ================================================================
// Función para añadir la capa visual al mapa
// ================================================================
const ESTADO_SOURCE_ID = 'source-estados-venezuela';
const ESTADO_LAYER_ID = 'layer-estados-venezuela-fill';
const ESTADO_LINE_LAYER_ID = 'layer-estados-venezuela-line';
const BLOQUE_LAYER_ID = 'layer-bloques-venezuela-fill';
const BLOQUE_FILTER_LINE_LAYER_ID = 'layer-bloques-venezuela-filter-line';
const BLOQUE_THEMATIC_LINE_LAYER_ID = 'layer-bloques-venezuela-thematic-line';

export function addMapLayerDirectly(tableName, sourceId, layerId, availableLayers) {
  const map = getMap();
  const layerConfig = availableLayers.find(l => l.id === tableName);
  const geomType = layerConfig ? layerConfig.type : 'circle';
  const geomColor = layerConfig ? layerConfig.color : '#6fa3e0';

  if (!map.getLayer(layerId)) {
    let beforeLayerId = undefined;
    const existingLayers = map.getStyle().layers;

    if (geomType === 'fill') {
      for (let l of existingLayers) {
        if (l.id.startsWith('layer-') && l.id !== ESTADO_LAYER_ID && l.id !== ESTADO_LINE_LAYER_ID && l.id !== BLOQUE_LAYER_ID && l.id !== BLOQUE_FILTER_LINE_LAYER_ID && l.id !== BLOQUE_THEMATIC_LINE_LAYER_ID) {
          const t = availableLayers.find(cfg => `layer-${cfg.id}` === l.id);
          if (t && (t.type === 'line' || t.type === 'circle')) {
            beforeLayerId = l.id;
            break;
          }
        }
      }
    } else if (geomType === 'line') {
      for (let l of existingLayers) {
        if (l.id.startsWith('layer-') && l.id !== ESTADO_LAYER_ID && l.id !== ESTADO_LINE_LAYER_ID && l.id !== BLOQUE_LAYER_ID && l.id !== BLOQUE_FILTER_LINE_LAYER_ID && l.id !== BLOQUE_THEMATIC_LINE_LAYER_ID) {
          const t = availableLayers.find(cfg => `layer-${cfg.id}` === l.id);
          if (t && t.type === 'circle') {
            beforeLayerId = l.id;
            break;
          }
        }
      }
    }

    if (geomType === 'circle') {
      map.addLayer({
        id: layerId,
        type: 'circle',
        source: sourceId,
        paint: {
          'circle-radius': [
            'case',
            ['boolean', ['feature-state', 'selected'], false], 10,
            ['boolean', ['feature-state', 'hover'], false], 9,
            6
          ],
          'circle-color': geomColor,
          'circle-stroke-width': [
            'case',
            ['boolean', ['feature-state', 'selected'], false], 4,
            ['boolean', ['feature-state', 'hover'], false], 3,
            1
          ],
          'circle-stroke-color': '#000000'
        }
      }, beforeLayerId);
    } else if (geomType === 'fill') {
      const savedFactor = layerOpacityFactors[layerId] ?? 1;
      map.addLayer({
        id: layerId,
        type: 'fill',
        source: sourceId,
        paint: {
          'fill-color': geomColor,
          'fill-opacity': buildFillOpacityExpression(savedFactor),
          'fill-outline-color': '#000000'
        }
      }, beforeLayerId);
    } else if (geomType === 'line') {
      const lineColorExpression = [
        'match',
        ['get', 'tipo'],
        'Oleoducto', '#e0824a',
        'Gasducto', '#cda54c',
        geomColor
      ];
      map.addLayer({
        id: layerId,
        type: 'line',
        source: sourceId,
        paint: {
          'line-color': lineColorExpression,
          'line-width': [
            'case',
            ['boolean', ['feature-state', 'selected'], false], 6,
            ['boolean', ['feature-state', 'hover'], false], 5,
            2
          ]
        }
      }, beforeLayerId);
    }
  }

  if (!map.listenedClicks) map.listenedClicks = new Set();
  if (!map.listenedClicks.has(layerId)) {
    map.listenedClicks.add(layerId);
    let hoveredStateId = null;

    map.on('mousemove', layerId, (e) => {
      map.getCanvas().style.cursor = 'pointer';
      if (e.features.length > 0) {
        if (hoveredStateId !== null) {
          map.setFeatureState({ source: sourceId, id: hoveredStateId }, { hover: false });
        }
        hoveredStateId = e.features[0].id;
        map.setFeatureState({ source: sourceId, id: hoveredStateId }, { hover: true });
      }
    });

    map.on('mouseleave', layerId, () => {
      map.getCanvas().style.cursor = '';
      if (hoveredStateId !== null) {
        map.setFeatureState({ source: sourceId, id: hoveredStateId }, { hover: false });
      }
      hoveredStateId = null;
    });

    map.on('click', layerId, (ev) => {
      if (!ev.features || ev.features.length === 0) return;
      const clickedFeature = ev.features[0];
      const props = clickedFeature.properties;
      const clickedId = clickedFeature.id;

      if (selectedFeatureId !== null && selectedSourceId !== null) {
        map.setFeatureState({ source: selectedSourceId, id: selectedFeatureId }, { selected: false });
      }

      selectedFeatureId = clickedId;
      selectedSourceId = sourceId;
      map.setFeatureState({ source: selectedSourceId, id: selectedFeatureId }, { selected: true });

      if (typeof window.handleFeatureClick === 'function') {
        window.handleFeatureClick(tableName, props, ev.lngLat);
      }
    });
  }
}

// ================================================================
// EXPORTAR FUNCIONES PARA MANEJAR LA SELECCIÓN
// ================================================================
export function getSelectedSourceId() { return selectedSourceId; }
export function getSelectedFeatureId() { return selectedFeatureId; }
export function setSelectedSourceId(id) { selectedSourceId = id; }
export function setSelectedFeatureId(id) { selectedFeatureId = id; }

export function clearSelection() {
  const map = getMap();
  if (selectedSourceId !== null && selectedFeatureId !== null) {
    map.setFeatureState({ source: selectedSourceId, id: selectedFeatureId }, { selected: false });
  }
  selectedSourceId = null;
  selectedFeatureId = null;
}