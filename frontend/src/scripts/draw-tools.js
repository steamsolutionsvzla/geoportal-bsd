// draw-tools.js
// ---------------------------------------------------------------------------
// Herramientas de dibujo sobre el mapa:
//   - Polígono temporal para el filtro de área (solo analista).
//   - Medición de distancia (todos los roles).
//
// Implementación ligera con eventos de MapLibre + Turf, sin dependencias
// adicionales. Sigue el patrón habitual de geoportales:
//   clic para agregar vértices, doble clic / Enter para terminar,
//   Esc para cancelar y botón para deshacer el último vértice.
// ---------------------------------------------------------------------------
import * as turf from '@turf/turf';

const DRAFT_SOURCE = 'source-draw-tool';
const DRAFT_LINE = 'layer-draw-tool-line';
const DRAFT_FILL = 'layer-draw-tool-fill';
const DRAFT_POINTS = 'layer-draw-tool-points';

const MEASURE_SOURCE = 'source-measure-tool';
const MEASURE_LINE = 'layer-measure-tool-line';
const MEASURE_POINTS = 'layer-measure-tool-points';
const MEASURE_LABELS = 'layer-measure-tool-labels';

const DRAFT_COLOR = '#0f766e';
const MEASURE_COLOR = '#c1584a';
const LABEL_COLOR = '#122b5a';

let mapRef = null;
let activeTool = null; // 'polygon' | 'distance' | null
let polygonVertices = [];
let polygonPreview = null;
let measureVertices = [];
let measurePreview = null;
let measureResultVisible = false;

let onPolygonComplete = null;
let onToolStateChange = null;

const UI = {
  drawBtn: null,
  measureBtn: null,
  cancelBtn: null,
  undoBtn: null,
  hint: null,
  chip: null,
  chipTotal: null,
  chipClear: null,
};

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------
function punto(coords, props = {}) {
  return { type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: coords } };
}

function linea(coords, props = {}) {
  return { type: 'Feature', properties: props, geometry: { type: 'LineString', coordinates: coords } };
}

function poligono(coords, props = {}) {
  return { type: 'Feature', properties: props, geometry: { type: 'Polygon', coordinates: [coords] } };
}

function distanciaMetros(a, b) {
  try {
    return turf.distance(turf.point(a), turf.point(b), { units: 'kilometers' }) * 1000;
  } catch (_) {
    return 0;
  }
}

export function formatDistance(metros) {
  const n = Number(metros) || 0;
  if (n >= 1000) {
    return `${(n / 1000).toLocaleString('es-VE', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })} km`;
  }
  return `${Math.round(n).toLocaleString('es-VE')} m`;
}

function quitarDuplicadoFinal(vertices) {
  if (vertices.length < 2) return;
  const a = vertices[vertices.length - 1];
  const b = vertices[vertices.length - 2];
  if (distanciaMetros(a, b) < 20) vertices.pop();
}

function mostrarHint(texto, tipo = 'info') {
  if (!UI.hint) return;
  UI.hint.textContent = texto || '';
  UI.hint.hidden = !texto;
  UI.hint.classList.toggle('error', tipo === 'error');
  clearTimeout(mostrarHint._timer);
  if (texto && tipo === 'error') {
    mostrarHint._timer = setTimeout(() => {
      if (activeTool === 'polygon') mostrarHint('Haz clic para agregar vértices · doble clic o Enter para cerrar · Esc para cancelar');
      else if (activeTool === 'distance') mostrarHint('Haz clic para medir · doble clic o Enter para terminar · Esc para cancelar');
      else UI.hint.hidden = true;
    }, 3200);
  }
}

function actualizarUI() {
  const drawing = activeTool === 'polygon';
  const measuring = activeTool === 'distance';
  const hasVertices = drawing ? polygonVertices.length > 0 : measureVertices.length > 0;

  if (UI.drawBtn) UI.drawBtn.classList.toggle('active', drawing);
  if (UI.measureBtn) UI.measureBtn.classList.toggle('active', measuring);
  if (UI.cancelBtn) UI.cancelBtn.hidden = !activeTool;
  if (UI.undoBtn) UI.undoBtn.hidden = !activeTool || !hasVertices;

  if (UI.hint) {
    if (drawing) {
      UI.hint.hidden = false;
      UI.hint.textContent = 'Haz clic para agregar vértices · doble clic o Enter para cerrar · Esc para cancelar';
    } else if (measuring) {
      UI.hint.hidden = false;
      UI.hint.textContent = 'Haz clic para medir · doble clic o Enter para terminar · Esc para cancelar';
    } else if (!UI.hint.classList.contains('error')) {
      UI.hint.hidden = true;
      UI.hint.textContent = '';
    }
  }

  if (UI.chip) UI.chip.hidden = !(measuring || measureResultVisible || measureVertices.length > 0);

  if (mapRef) {
    mapRef.getCanvas().style.cursor = activeTool ? 'crosshair' : '';
  }

  window.__mapToolActive = Boolean(activeTool);
  window.__mapTool = activeTool;

  if (typeof onToolStateChange === 'function') {
    try { onToolStateChange(activeTool); } catch (_) { /* ignorar */ }
  }
}

// ---------------------------------------------------------------------------
// Capas temporales
// ---------------------------------------------------------------------------
function crearCapas(map) {
  if (!map.getSource(DRAFT_SOURCE)) {
    map.addSource(DRAFT_SOURCE, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] }
    });
  }
  if (!map.getLayer(DRAFT_FILL)) {
    map.addLayer({
      id: DRAFT_FILL,
      type: 'fill',
      source: DRAFT_SOURCE,
      filter: ['==', ['get', 'kind'], 'polygon'],
      paint: { 'fill-color': DRAFT_COLOR, 'fill-opacity': 0.08 }
    });
  }
  if (!map.getLayer(DRAFT_LINE)) {
    map.addLayer({
      id: DRAFT_LINE,
      type: 'line',
      source: DRAFT_SOURCE,
      filter: ['==', ['get', 'kind'], 'line'],
      paint: {
        'line-color': DRAFT_COLOR,
        'line-width': 2,
        'line-dasharray': [2, 1.5],
        'line-opacity': 0.95
      }
    });
  }
  if (!map.getLayer(DRAFT_POINTS)) {
    map.addLayer({
      id: DRAFT_POINTS,
      type: 'circle',
      source: DRAFT_SOURCE,
      filter: ['==', ['get', 'kind'], 'vertex'],
      paint: {
        'circle-radius': 5,
        'circle-color': '#ffffff',
        'circle-stroke-width': 2,
        'circle-stroke-color': DRAFT_COLOR
      }
    });
  }

  if (!map.getSource(MEASURE_SOURCE)) {
    map.addSource(MEASURE_SOURCE, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] }
    });
  }
  if (!map.getLayer(MEASURE_LINE)) {
    map.addLayer({
      id: MEASURE_LINE,
      type: 'line',
      source: MEASURE_SOURCE,
      filter: ['==', ['get', 'kind'], 'line'],
      paint: {
        'line-color': MEASURE_COLOR,
        'line-width': 2.2,
        'line-opacity': 0.95
      }
    });
  }
  if (!map.getLayer(MEASURE_POINTS)) {
    map.addLayer({
      id: MEASURE_POINTS,
      type: 'circle',
      source: MEASURE_SOURCE,
      filter: ['==', ['get', 'kind'], 'vertex'],
      paint: {
        'circle-radius': 5,
        'circle-color': '#ffffff',
        'circle-stroke-width': 2,
        'circle-stroke-color': MEASURE_COLOR
      }
    });
  }
  if (!map.getLayer(MEASURE_LABELS)) {
    map.addLayer({
      id: MEASURE_LABELS,
      type: 'symbol',
      source: MEASURE_SOURCE,
      filter: ['==', ['get', 'kind'], 'label'],
      layout: {
        'text-field': ['get', 'label'],
        'text-font': ['Open Sans Regular'],
        'text-size': 11,
        'text-offset': [0, -0.9],
        'text-anchor': 'bottom',
        'text-allow-overlap': true,
        'text-ignore-placement': true
      },
      paint: {
        'text-color': LABEL_COLOR,
        'text-halo-color': '#ffffff',
        'text-halo-width': 1.6
      }
    });
  }
}

function traerAlFrente() {
  if (!mapRef) return;
  [DRAFT_FILL, DRAFT_LINE, DRAFT_POINTS, MEASURE_LINE, MEASURE_POINTS, MEASURE_LABELS].forEach((id) => {
    if (mapRef.getLayer(id)) {
      try { mapRef.moveLayer(id); } catch (_) { /* ignorar */ }
    }
  });
}

// ---------------------------------------------------------------------------
// Render del borrador de polígono
// ---------------------------------------------------------------------------
function renderDraft() {
  if (!mapRef) return;
  const source = mapRef.getSource(DRAFT_SOURCE);
  if (!source) return;

  const features = [];
  const coords = [...polygonVertices];
  const previewCoords = polygonPreview ? [...coords, polygonPreview] : coords;

  if (previewCoords.length >= 2) {
    features.push(linea(previewCoords, { kind: 'line' }));
  }
  if (previewCoords.length >= 3) {
    features.push(poligono([...previewCoords, previewCoords[0]], { kind: 'polygon' }));
  }
  polygonVertices.forEach((c) => features.push(punto(c, { kind: 'vertex' })));

  source.setData({ type: 'FeatureCollection', features });
  traerAlFrente();
}

// ---------------------------------------------------------------------------
// Render de la medición
// ---------------------------------------------------------------------------
function renderMeasure() {
  if (!mapRef) return;
  const source = mapRef.getSource(MEASURE_SOURCE);
  if (!source) return;

  const features = [];
  const coords = [...measureVertices];
  if (activeTool === 'distance' && measurePreview) coords.push(measurePreview);

  if (coords.length >= 2) {
    features.push(linea(coords, { kind: 'line' }));

    for (let i = 1; i < coords.length; i++) {
      const a = coords[i - 1];
      const b = coords[i];
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      features.push(punto(mid, {
        kind: 'label',
        label: formatDistance(distanciaMetros(a, b))
      }));
    }
  }

  measureVertices.forEach((c) => features.push(punto(c, { kind: 'vertex' })));

  source.setData({ type: 'FeatureCollection', features });

  let total = 0;
  if (coords.length >= 2) {
    try {
      total = turf.length(linea(coords), { units: 'kilometers' }) * 1000;
    } catch (_) {
      total = 0;
    }
  }
  if (UI.chipTotal) UI.chipTotal.textContent = formatDistance(total);

  traerAlFrente();
}

function limpiarDraft() {
  polygonVertices = [];
  polygonPreview = null;
  const source = mapRef?.getSource(DRAFT_SOURCE);
  if (source) source.setData({ type: 'FeatureCollection', features: [] });
}

function limpiarMedicion({ mantenerChip = false } = {}) {
  measureVertices = [];
  measurePreview = null;
  measureResultVisible = mantenerChip;
  const source = mapRef?.getSource(MEASURE_SOURCE);
  if (source) source.setData({ type: 'FeatureCollection', features: [] });
  if (UI.chipTotal) UI.chipTotal.textContent = formatDistance(0);
  if (UI.chip) UI.chip.hidden = !mantenerChip;
}

// ---------------------------------------------------------------------------
// Activación / cancelación de herramientas
// ---------------------------------------------------------------------------
function desactivarHerramienta() {
  activeTool = null;
  if (mapRef) {
    try { mapRef.doubleClickZoom.enable(); } catch (_) { /* ignorar */ }
  }
  actualizarUI();
}

export function cancelActiveTool({ clearMeasure = true } = {}) {
  limpiarDraft();
  if (clearMeasure) limpiarMedicion();
  desactivarHerramienta();
}

function activarHerramienta(tool) {
  if (activeTool === tool) {
    cancelActiveTool({ clearMeasure: tool === 'distance' });
    return;
  }

  if (activeTool) {
    // Cambiar de herramienta: descarta el borrador de la anterior.
    limpiarDraft();
    if (activeTool === 'distance') limpiarMedicion();
  }

  activeTool = tool;
  polygonVertices = [];
  polygonPreview = null;
  measureVertices = [];
  measurePreview = null;

  if (tool === 'distance') {
    limpiarMedicion();
  } else {
    limpiarDraft();
  }

  if (mapRef) {
    try { mapRef.doubleClickZoom.disable(); } catch (_) { /* ignorar */ }
  }

  actualizarUI();
  mostrarHint(
    tool === 'polygon'
      ? 'Haz clic para agregar vértices · doble clic o Enter para cerrar · Esc para cancelar'
      : 'Haz clic para medir · doble clic o Enter para terminar · Esc para cancelar'
  );
}

// ---------------------------------------------------------------------------
// Finalización
// ---------------------------------------------------------------------------
function finalizarPoligono() {
  if (activeTool !== 'polygon') return;
  quitarDuplicadoFinal(polygonVertices);

  if (polygonVertices.length < 3) {
    mostrarHint('Un polígono necesita al menos 3 vértices.', 'error');
    return;
  }

  const anillo = [...polygonVertices, polygonVertices[0]];
  const feature = poligono(anillo, { __area_label: 'Polígono dibujado' });

  try {
    const kinks = turf.kinks(feature);
    if (kinks?.features?.length) {
      mostrarHint('El polígono se cruza a sí mismo. Corrige los vértices e inténtalo de nuevo.', 'error');
      return;
    }
    if (!(turf.area(feature) > 0)) {
      mostrarHint('El polígono no tiene un área válida.', 'error');
      return;
    }
  } catch (_) {
    mostrarHint('No se pudo validar el polígono. Inténtalo de nuevo.', 'error');
    return;
  }

  const callback = onPolygonComplete;
  limpiarDraft();
  desactivarHerramienta();

  if (typeof callback === 'function') {
    try { callback(feature); } catch (e) { console.error('Error al procesar el polígono dibujado:', e); }
  }
}

function finalizarMedicion() {
  if (activeTool !== 'distance') return;
  quitarDuplicadoFinal(measureVertices);

  if (measureVertices.length < 2) {
    mostrarHint('Agrega al menos dos puntos para medir una distancia.', 'error');
    return;
  }

  measurePreview = null;
  measureResultVisible = true;
  renderMeasure();
  desactivarHerramienta();
  actualizarUI();
}

// ---------------------------------------------------------------------------
// Eventos del mapa y teclado
// ---------------------------------------------------------------------------
function onMapClick(e) {
  if (!activeTool) return;
  const coord = [e.lngLat.lng, e.lngLat.lat];

  if (activeTool === 'polygon') {
    polygonVertices.push(coord);
    renderDraft();
    actualizarUI();
    return;
  }

  if (activeTool === 'distance') {
    measureVertices.push(coord);
    measurePreview = null;
    renderMeasure();
    actualizarUI();
  }
}

function onMouseMove(e) {
  if (!activeTool) return;
  const coord = [e.lngLat.lng, e.lngLat.lat];

  if (activeTool === 'polygon') {
    polygonPreview = coord;
    renderDraft();
  } else if (activeTool === 'distance' && measureVertices.length > 0) {
    measurePreview = coord;
    renderMeasure();
  }
}

function onDoubleClick(e) {
  if (!activeTool) return;
  e.preventDefault?.();
  if (activeTool === 'polygon') finalizarPoligono();
  else finalizarMedicion();
}

function onKeyDown(e) {
  const target = e.target;
  if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;

  if (e.key === 'Escape') {
    if (activeTool) {
      cancelActiveTool({ clearMeasure: true });
      e.preventDefault();
    } else if (measureResultVisible || measureVertices.length) {
      limpiarMedicion();
      actualizarUI();
      e.preventDefault();
    }
    return;
  }

  if (!activeTool) return;

  if (e.key === 'Enter') {
    if (activeTool === 'polygon') finalizarPoligono();
    else finalizarMedicion();
    e.preventDefault();
    return;
  }

  if (e.key === 'Backspace' || e.key === 'Delete') {
    if (activeTool === 'polygon' && polygonVertices.length) {
      polygonVertices.pop();
      renderDraft();
      actualizarUI();
    } else if (activeTool === 'distance' && measureVertices.length) {
      measureVertices.pop();
      renderMeasure();
      actualizarUI();
    }
    e.preventDefault();
  }
}

function deshacerUltimo() {
  if (activeTool === 'polygon' && polygonVertices.length) {
    polygonVertices.pop();
    renderDraft();
    actualizarUI();
  } else if (activeTool === 'distance' && measureVertices.length) {
    measureVertices.pop();
    renderMeasure();
    actualizarUI();
  }
}

// ---------------------------------------------------------------------------
// Inicialización pública
// ---------------------------------------------------------------------------
export function initDrawTools({
  map,
  canDrawPolygon = false,
  onPolygonComplete: polygonCallback = null,
  onToolStateChange: stateCallback = null
} = {}) {
  mapRef = map;
  onPolygonComplete = polygonCallback;
  onToolStateChange = stateCallback;

  UI.drawBtn = document.getElementById('drawPolygonBtn');
  UI.measureBtn = document.getElementById('measureDistanceBtn');
  UI.cancelBtn = document.getElementById('mapToolCancelBtn');
  UI.undoBtn = document.getElementById('mapToolUndoBtn');
  UI.hint = document.getElementById('mapToolHint');
  UI.chip = document.getElementById('measureChip');
  UI.chipTotal = document.getElementById('measureTotal');
  UI.chipClear = document.getElementById('measureClearBtn');

  if (UI.drawBtn) UI.drawBtn.hidden = !canDrawPolygon;

  // Si la página no tiene la barra de herramientas (p. ej. Showroom),
  // no hace falta crear capas temporales ni capturar eventos del mapa.
  if (!UI.drawBtn && !UI.measureBtn) return;

  crearCapas(map);

  UI.drawBtn?.addEventListener('click', () => activarHerramienta('polygon'));
  UI.measureBtn?.addEventListener('click', () => activarHerramienta('distance'));
  UI.cancelBtn?.addEventListener('click', () => cancelActiveTool({ clearMeasure: true }));
  UI.undoBtn?.addEventListener('click', deshacerUltimo);
  UI.chipClear?.addEventListener('click', () => {
    limpiarMedicion();
    if (activeTool === 'distance') {
      // Mantiene la herramienta activa para empezar una nueva medición.
      actualizarUI();
    }
  });

  map.on('click', onMapClick);
  map.on('mousemove', onMouseMove);
  map.on('dblclick', onDoubleClick);
  document.addEventListener('keydown', onKeyDown);

  actualizarUI();
}
