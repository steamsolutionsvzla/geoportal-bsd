// filters.js
import { getMap } from './map-config.js';
import { obtenerNombreEstado, obtenerNombreBloque } from './utils.js';
import { setInfoPanelData, renderInfoPanel } from './info-panel.js';
import * as turf from '@turf/turf';
import {
  loadAreaFromFile,
  clearAreaLayer,
  selectAreaFeature,
  getAreaFeatures,
  getAreaFeature,
  getAreaLabelKey,
  setAreaLabelKey,
  getAreaLabel,
  getAreaFieldKeys,
  getAreaFileName,
  getAreaSourceType,
  hasAreaLayer,
  bringAreaToFront,
  formatearAreaNombre
} from './area-temporal.js';

let estadosGeoJsonCache = null;
let bloquesGeoJsonCache = null;
let isFilterActive = false;
let isBloqueFilterActive = false;
let isAreaFilterActive = false;
let selectedStateFeatureId = null;
let selectedBloqueFeatureId = null;
let selectedEstadoFeature = null;   // feature del estado seleccionado (para recalcular)
let selectedBloqueFeature = null;   // feature del bloque seleccionado (para recalcular)
let selectedAreaFeature = null;     // feature del área seleccionada (para recalcular)
let selectedAreaIndex = null;
let estadoSeleccionado = '';
let bloqueSeleccionado = '';
let areaSeleccionada = '';
let currentFilterData = null;
let currentBloqueFilterData = null;

export function setEstadosCache(data) { estadosGeoJsonCache = data; }
export function setBloquesCache(data) { bloquesGeoJsonCache = data; }

// -------------------------------------------------------------------------
// DROPDOWNS DE ESTADO Y BLOQUE (comportamiento original)
// -------------------------------------------------------------------------
export function setupFilterDropdowns(estadosCache, bloquesCache, options = {}) {
  const { includeBloque = true } = options;

  if (estadosCache) setEstadosCache(estadosCache);
  if (bloquesCache) setBloquesCache(bloquesCache);

  const filterEstado = document.getElementById('filterEstado');
  const filterBloque = document.getElementById('filterBloque');
  const dropdownEstado = document.getElementById('dropdownEstado');
  const dropdownBloque = document.getElementById('dropdownBloque');

  // Llenar dropdown de estado
  if (dropdownEstado && estadosGeoJsonCache) {
    dropdownEstado.innerHTML = '<div class="loc-option selected" data-value="">Todos los estados</div>';
    const estadosSet = new Set();
    estadosGeoJsonCache.features.forEach(f => {
      const nombre = obtenerNombreEstado(f.properties);
      if (nombre) estadosSet.add(nombre);
    });
    Array.from(estadosSet).sort().forEach(estado => {
      const opt = document.createElement('div');
      opt.className = 'loc-option';
      opt.setAttribute('data-value', estado);
      opt.textContent = estado;
      dropdownEstado.appendChild(opt);
    });
  }

  // Llenar dropdown de bloque
  if (includeBloque && dropdownBloque && bloquesGeoJsonCache) {
    dropdownBloque.innerHTML = '<div class="loc-option selected" data-value="">Todos los bloques</div>';
    const bloquesSet = new Set();
    bloquesGeoJsonCache.features.forEach(f => {
      const nombre = obtenerNombreBloque(f.properties);
      if (nombre) bloquesSet.add(nombre);
    });
    Array.from(bloquesSet).sort().forEach(bloque => {
      const opt = document.createElement('div');
      opt.className = 'loc-option';
      opt.setAttribute('data-value', bloque);
      opt.textContent = bloque;
      dropdownBloque.appendChild(opt);
    });
  }

  // Event listeners para abrir/cerrar
  document.querySelectorAll('.loc-filter').forEach(filter => {
    const btn = filter.querySelector('.loc-filter-btn');
    if (!btn) return;
    if (btn.dataset.filterBound === 'true') return;
    btn.dataset.filterBound = 'true';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      document.querySelectorAll('.loc-filter.open').forEach(openFilter => {
        if (openFilter !== filter) openFilter.classList.remove('open');
      });
      filter.classList.toggle('open');
    });
  });

  // Selección en dropdown de estado
  if (dropdownEstado) {
    dropdownEstado.addEventListener('click', (e) => {
      const option = e.target.closest('.loc-option');
      if (!option) return;
      e.stopPropagation();
      dropdownEstado.querySelectorAll('.loc-option').forEach(o => o.classList.remove('selected'));
      option.classList.add('selected');
      const valor = option.getAttribute('data-value') || option.textContent.trim();
      estadoSeleccionado = valor === 'Todos los estados' ? '' : valor;
      const label = filterEstado.querySelector('.lf-label');
      label.textContent = estadoSeleccionado || 'Estado';
      label.classList.toggle('has-value', Boolean(estadoSeleccionado));
      filterEstado.classList.remove('open');
      if (!estadoSeleccionado) {
        limpiarFiltroEstado();
      } else {
        aplicarFiltroEstado(estadoSeleccionado);
      }
    });
  }

  // Selección en dropdown de bloque
  if (includeBloque && dropdownBloque) {
    dropdownBloque.addEventListener('click', (e) => {
      const option = e.target.closest('.loc-option');
      if (!option) return;
      e.stopPropagation();
      dropdownBloque.querySelectorAll('.loc-option').forEach(o => o.classList.remove('selected'));
      option.classList.add('selected');
      const valor = option.getAttribute('data-value') || option.textContent.trim();
      bloqueSeleccionado = valor === 'Todos los bloques' ? '' : valor;
      const label = filterBloque.querySelector('.lf-label');
      label.textContent = bloqueSeleccionado || 'Bloque';
      label.classList.toggle('has-value', Boolean(bloqueSeleccionado));
      filterBloque.classList.remove('open');
      if (!bloqueSeleccionado) {
        limpiarFiltroBloque();
      } else {
        aplicarFiltroBloque(bloqueSeleccionado);
      }
    });
  }
}

// -------------------------------------------------------------------------
// FILTRO POR ÁREA TEMPORAL (solo analista)
// -------------------------------------------------------------------------
function areaEls() {
  return {
    filter: document.getElementById('filterArea'),
    dropdown: document.getElementById('dropdownArea'),
    uploadBtn: document.getElementById('areaUploadBtn'),
    drawBtn: document.getElementById('areaDrawBtn'),
    fileInput: document.getElementById('areaFileInput'),
    fileRow: document.getElementById('areaFileRow'),
    fileName: document.getElementById('areaFileName'),
    clearLayerBtn: document.getElementById('areaClearLayerBtn'),
    labelField: document.getElementById('areaLabelField'),
    labelSelect: document.getElementById('areaLabelSelect'),
    entityList: document.getElementById('areaEntityList'),
    hint: document.getElementById('areaHint'),
    error: document.getElementById('areaError')
  };
}

function setAreaError(texto) {
  const { error, hint } = areaEls();
  if (error) {
    error.textContent = texto || '';
    error.hidden = !texto;
  }
  if (hint) hint.hidden = Boolean(texto) || hasAreaLayer();
}

function setAreaHint(texto) {
  const { hint, error } = areaEls();
  if (error) error.hidden = true;
  if (hint) {
    hint.textContent = texto || '';
    hint.hidden = !texto;
  }
}

function renderAreaLabelField(meta) {
  const { labelField, labelSelect } = areaEls();
  if (!labelField || !labelSelect) return;

  const fieldKeys = meta?.fieldKeys ?? getAreaFieldKeys();
  const actual = meta?.labelKey ?? getAreaLabelKey();

  labelSelect.innerHTML = '';
  if (!fieldKeys.length) {
    labelField.hidden = true;
    return;
  }

  fieldKeys.forEach((key) => {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = key;
    labelSelect.appendChild(opt);
  });

  if (actual && fieldKeys.includes(actual)) labelSelect.value = actual;
  else labelSelect.value = fieldKeys[0];
  labelField.hidden = false;
}

function renderAreaEntities() {
  const { entityList } = areaEls();
  if (!entityList) return;

  const features = getAreaFeatures();
  entityList.innerHTML = '';

  if (!features.length) {
    setAreaHint('Carga un Shapefile (.zip) o GeoJSON, o dibuja un polígono.');
    return;
  }

  const placeholder = document.createElement('div');
  placeholder.className = 'loc-option area-placeholder';
  placeholder.dataset.index = '-1';
  placeholder.textContent = 'Selecciona una entidad…';
  entityList.appendChild(placeholder);

  const vistos = new Map();
  features.forEach((feature, index) => {
    let label = getAreaLabel(feature, index);
    const repeticiones = (vistos.get(label) || 0) + 1;
    vistos.set(label, repeticiones);
    if (repeticiones > 1) label = `${label} · ${index + 1}`;

    const opt = document.createElement('div');
    opt.className = 'loc-option';
    opt.dataset.index = String(index);
    opt.textContent = label;
    if (selectedAreaIndex === index) opt.classList.add('selected');
    entityList.appendChild(opt);
  });

  if (selectedAreaIndex === null) placeholder.classList.add('selected');
  setAreaHint('');
}

function marcarEntidadSeleccionada(index) {
  const { entityList } = areaEls();
  if (!entityList) return;
  entityList.querySelectorAll('.loc-option').forEach((el) => {
    el.classList.toggle('selected', Number(el.dataset.index) === index);
  });
}

function actualizarLabelArea(texto) {
  const { filter } = areaEls();
  const label = filter?.querySelector('.lf-label');
  if (!label) return;
  label.textContent = texto || 'Área de análisis';
  label.classList.toggle('has-value', Boolean(texto));
}

function refrescarAreaUI(meta) {
  const { fileRow, fileName, fileInput } = areaEls();
  if (fileRow) fileRow.hidden = false;
  if (fileName) fileName.textContent = formatearAreaNombre(meta?.fileName || getAreaFileName() || 'Área cargada');
  if (fileInput) fileInput.value = '';

  renderAreaLabelField(meta);
  renderAreaEntities();

  if (meta?.skipped > 0) {
    setAreaHint(`Se omitieron ${meta.skipped} geometrías que no son polígonos.`);
  }
}

function sincronizarInterseccion() {
  if (isFilterActive && selectedEstadoFeature && isAreaFilterActive && selectedAreaFeature) {
    if (typeof window.calcularElementosEnInterseccion === 'function') {
      window.calcularElementosEnInterseccion(
        selectedEstadoFeature,
        selectedAreaFeature,
        estadoSeleccionado,
        areaSeleccionada
      );
      return;
    }
  }

  setInfoPanelData({
    currentIntersectionFilterData: null,
    isIntersectionFilterActive: false
  });
  renderInfoPanel();
}

function aplicarFiltroArea(index) {
  const feature = getAreaFeature(index);
  if (!feature) return;

  isAreaFilterActive = true;
  selectedAreaFeature = feature;
  selectedAreaIndex = index;
  areaSeleccionada = getAreaLabel(feature, index);

  selectAreaFeature(index);
  marcarEntidadSeleccionada(index);
  actualizarLabelArea(areaSeleccionada);
  areaEls().filter?.classList.remove('open');

  fitToActiveFilters();

  if (typeof window.calcularElementosEnArea === 'function') {
    window.calcularElementosEnArea(feature, areaSeleccionada);
  }
  sincronizarInterseccion();
}

export function limpiarFiltroArea({ keepLayer = true, keepUI = false } = {}) {
  isAreaFilterActive = false;
  selectedAreaFeature = null;
  selectedAreaIndex = null;
  areaSeleccionada = '';

  selectAreaFeature(null);
  actualizarLabelArea('');

  if (!keepLayer) {
    clearAreaLayer();
    const { fileRow, fileName, labelField, labelSelect, entityList, fileInput, error } = areaEls();
    if (fileRow) fileRow.hidden = true;
    if (fileName) fileName.textContent = '';
    if (fileInput) fileInput.value = '';
    if (labelField) labelField.hidden = true;
    if (labelSelect) labelSelect.innerHTML = '';
    if (entityList) entityList.innerHTML = '';
    if (error) error.hidden = true;
    setAreaHint('Carga un Shapefile (.zip) o GeoJSON, o dibuja un polígono.');
  } else if (!keepUI) {
    marcarEntidadSeleccionada(-1);
  }

  setInfoPanelData({
    currentAreaFilterData: null,
    isAreaFilterActive: false,
    currentIntersectionFilterData: null,
    isIntersectionFilterActive: false
  });
  renderInfoPanel();

  // Limpia el resaltado amarillo y re-sincroniza los filtros que sigan activos.
  if (typeof window.limpiarResaltadoFiltro === 'function') window.limpiarResaltadoFiltro();
  recalcularFiltrosActivos();
}

export function setupAreaFilter({ onRequestDraw = null } = {}) {
  const els = areaEls();
  if (!els.filter) return;
  els.filter.hidden = false;

  if (els.drawBtn && els.drawBtn.dataset.bound !== 'true') {
    els.drawBtn.dataset.bound = 'true';
    els.drawBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      els.filter?.classList.remove('open');
      if (typeof onRequestDraw === 'function') {
        onRequestDraw();
      } else {
        setAreaError('La herramienta de dibujo no está disponible.');
      }
    });
  }

  if (els.uploadBtn && els.fileInput && els.uploadBtn.dataset.bound !== 'true') {
    els.uploadBtn.dataset.bound = 'true';
    els.uploadBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      els.fileInput.click();
    });
  }

  if (els.fileInput && els.fileInput.dataset.bound !== 'true') {
    els.fileInput.dataset.bound = 'true';
    els.fileInput.addEventListener('change', async () => {
      const file = els.fileInput.files?.[0];
      if (!file) return;

      setAreaError('');
      setAreaHint('Leyendo archivo…');
      if (els.uploadBtn) els.uploadBtn.disabled = true;

      try {
        // Al cargar un archivo nuevo se reemplaza el área anterior.
        limpiarFiltroArea({ keepLayer: false });
        setAreaHint('Leyendo archivo…');
        const meta = await loadAreaFromFile(file);
        refrescarAreaUI(meta);
        if (els.filter) els.filter.classList.add('open');
      } catch (error) {
        console.error('Error al cargar el área:', error);
        setAreaError(error?.message || 'No se pudo cargar el archivo.');
      } finally {
        if (els.uploadBtn) els.uploadBtn.disabled = false;
      }
    });
  }

  if (els.labelSelect && els.labelSelect.dataset.bound !== 'true') {
    els.labelSelect.dataset.bound = 'true';
    els.labelSelect.addEventListener('change', () => {
      setAreaLabelKey(els.labelSelect.value);
      // Cambiar la etiqueta reinicia la selección para evitar nombres desfasados.
      limpiarFiltroArea({ keepLayer: true, keepUI: true });
      renderAreaEntities();
      marcarEntidadSeleccionada(-1);
    });
  }

  if (els.entityList && els.entityList.dataset.bound !== 'true') {
    els.entityList.dataset.bound = 'true';
    els.entityList.addEventListener('click', (e) => {
      const option = e.target.closest('.loc-option');
      if (!option) return;
      e.stopPropagation();
      const index = Number(option.dataset.index);
      if (!Number.isInteger(index) || index < 0) {
        limpiarFiltroArea({ keepLayer: true });
        return;
      }
      aplicarFiltroArea(index);
    });
  }

  if (els.clearLayerBtn && els.clearLayerBtn.dataset.bound !== 'true') {
    els.clearLayerBtn.dataset.bound = 'true';
    els.clearLayerBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      limpiarFiltroArea({ keepLayer: false });
    });
  }

  renderAreaLabelField();
  renderAreaEntities();
}

/**
 * Usado por el botón "Dibujar polígono": reemplaza el área actual por el
 * polígono dibujado y ejecuta el análisis automáticamente.
 */
export function usarAreaDibujada(meta) {
  // La capa ya fue reemplazada por setDrawnArea(); aquí solo reiniciamos
  // el estado del filtro y la interfaz, sin borrar la capa recién creada.
  limpiarFiltroArea({ keepLayer: true, keepUI: true });
  refrescarAreaUI(meta);
  aplicarFiltroArea(0);
  const { filter } = areaEls();
  if (filter) filter.classList.remove('open');
}

export function getAreaFilterState() {
  return {
    active: isAreaFilterActive,
    feature: selectedAreaFeature,
    label: areaSeleccionada,
    sourceType: getAreaSourceType()
  };
}

// -------------------------------------------------------------------------
// LIMPIAR FILTROS (independientes entre sí)
// -------------------------------------------------------------------------
export function limpiarFiltroEstado() {
  isFilterActive = false;
  estadoSeleccionado = '';
  currentFilterData = null;
  selectedEstadoFeature = null;

  const map = getMap();
  if (map.getLayer('layer-estados-venezuela-line')) {
    map.setLayoutProperty('layer-estados-venezuela-line', 'visibility', 'none');
  }
  if (selectedStateFeatureId !== null) {
    map.setFeatureState({ source: 'source-estados-venezuela', id: selectedStateFeatureId }, { selected: false });
    selectedStateFeatureId = null;
  }
  const label = document.querySelector('#filterEstado .lf-label');
  if (label) {
    label.textContent = 'Estado';
    label.classList.remove('has-value');
  }
  const dropdown = document.getElementById('dropdownEstado');
  if (dropdown) {
    dropdown.querySelectorAll('.loc-option').forEach(o => o.classList.remove('selected'));
    const todos = dropdown.querySelector('.loc-option[data-value=""]');
    if (todos) todos.classList.add('selected');
  }

  setInfoPanelData({
    currentFilterData: null,
    isFilterActive: false,
    currentIntersectionFilterData: null,
    isIntersectionFilterActive: false
  });
  renderInfoPanel();

  // Limpia el resaltado amarillo y re-sincroniza los filtros que sigan activos.
  if (typeof window.limpiarResaltadoFiltro === 'function') window.limpiarResaltadoFiltro();
  recalcularFiltrosActivos();
}

export function limpiarFiltroBloque() {
  isBloqueFilterActive = false;
  bloqueSeleccionado = '';
  currentBloqueFilterData = null;
  selectedBloqueFeature = null;

  const map = getMap();
  if (map.getLayer('layer-bloques-venezuela-filter-line')) {
    map.setLayoutProperty('layer-bloques-venezuela-filter-line', 'visibility', 'none');
  }
  if (selectedBloqueFeatureId !== null) {
    map.setFeatureState({ source: 'source-bloques-venezuela', id: selectedBloqueFeatureId }, { selected: false });
    selectedBloqueFeatureId = null;
  }
  const label = document.querySelector('#filterBloque .lf-label');
  if (label) {
    label.textContent = 'Bloque';
    label.classList.remove('has-value');
  }
  const dropdown = document.getElementById('dropdownBloque');
  if (dropdown) {
    dropdown.querySelectorAll('.loc-option').forEach(o => o.classList.remove('selected'));
    const todos = dropdown.querySelector('.loc-option[data-value=""]');
    if (todos) todos.classList.add('selected');
  }

  setInfoPanelData({ currentBloqueFilterData: null, isBloqueFilterActive: false });
  renderInfoPanel();

  // Limpia el resaltado amarillo y re-sincroniza los filtros que sigan activos.
  if (typeof window.limpiarResaltadoFiltro === 'function') window.limpiarResaltadoFiltro();
  recalcularFiltrosActivos();
}

// -------------------------------------------------------------------------
// AJUSTAR VISTA A LOS FILTROS ACTIVOS (puede ser uno o ambos)
// -------------------------------------------------------------------------
function fitToActiveFilters() {
  const map = getMap();
  const features = [];
  if (isFilterActive && selectedEstadoFeature) features.push(selectedEstadoFeature);
  if (isAreaFilterActive && selectedAreaFeature) features.push(selectedAreaFeature);
  if (isBloqueFilterActive && selectedBloqueFeature) features.push(selectedBloqueFeature);
  if (features.length === 0) return;
  try {
    const bbox = features.length === 1
      ? turf.bbox(features[0])
      : turf.bbox(turf.featureCollection(features));
    map.fitBounds(bbox, { padding: 60, duration: 2000 });
  } catch (err) { /* ignorar */ }
}

// -------------------------------------------------------------------------
// APLICAR FILTROS (independientes)
// -------------------------------------------------------------------------
function aplicarFiltroEstado(nombreEstado) {
  if (!estadosGeoJsonCache) return;
  const map = getMap();
  const estadoFeature = estadosGeoJsonCache.features.find(f => {
    const nombre = obtenerNombreEstado(f.properties);
    return nombre && nombre.toLowerCase() === nombreEstado.toLowerCase();
  });
  if (!estadoFeature) return;

  // Ya NO se limpia el filtro de bloque/área: pueden coexistir
  isFilterActive = true;
  selectedEstadoFeature = estadoFeature;

  if (map.getLayer('layer-estados-venezuela-line')) {
    map.setLayoutProperty('layer-estados-venezuela-line', 'visibility', 'visible');
  }
  if (selectedStateFeatureId !== null) {
    map.setFeatureState({ source: 'source-estados-venezuela', id: selectedStateFeatureId }, { selected: false });
  }
  const featureIndex = estadosGeoJsonCache.features.findIndex(f => {
    const nombre = obtenerNombreEstado(f.properties);
    return nombre && nombre.toLowerCase() === nombreEstado.toLowerCase();
  });
  if (featureIndex !== -1) {
    selectedStateFeatureId = featureIndex;
    map.setFeatureState({ source: 'source-estados-venezuela', id: selectedStateFeatureId }, { selected: true });
  }

  fitToActiveFilters();

  // Llamar a la función global pasando el nombre del estado
  if (window.calcularPuntosEnEstado) {
    window.calcularPuntosEnEstado(estadoFeature, nombreEstado);
  }
  sincronizarInterseccion();
}

function aplicarFiltroBloque(nombreBloque) {
  if (!bloquesGeoJsonCache) return;
  const map = getMap();
  const bloqueFeature = bloquesGeoJsonCache.features.find(f => {
    const nombre = obtenerNombreBloque(f.properties);
    return nombre && nombre.toLowerCase() === nombreBloque.toLowerCase();
  });
  if (!bloqueFeature) return;

  // Ya NO se limpia el filtro de estado: ambos pueden coexistir
  isBloqueFilterActive = true;
  selectedBloqueFeature = bloqueFeature;

  if (map.getLayer('layer-bloques-venezuela-filter-line')) {
    map.setLayoutProperty('layer-bloques-venezuela-filter-line', 'visibility', 'visible');
  }
  if (selectedBloqueFeatureId !== null) {
    map.setFeatureState({ source: 'source-bloques-venezuela', id: selectedBloqueFeatureId }, { selected: false });
  }
  const featureIndex = bloquesGeoJsonCache.features.findIndex(f => {
    const nombre = obtenerNombreBloque(f.properties);
    return nombre && nombre.toLowerCase() === nombreBloque.toLowerCase();
  });
  if (featureIndex !== -1) {
    selectedBloqueFeatureId = featureIndex;
    map.setFeatureState({ source: 'source-bloques-venezuela', id: selectedBloqueFeatureId }, { selected: true });
  }

  fitToActiveFilters();

  // Llamar a la función global pasando el nombre del bloque
  if (window.calcularPuntosEnBloque) {
    window.calcularPuntosEnBloque(bloqueFeature, nombreBloque);
  }
}

// -------------------------------------------------------------------------
// RECALCULAR FILTROS ACTIVOS
// Se llama desde main.js cuando se activa/desactiva una capa,
// para que los conteos de los filtros activos se actualicen.
// -------------------------------------------------------------------------
export function recalcularFiltrosActivos() {
  bringAreaToFront();
  if (isFilterActive && selectedEstadoFeature && typeof window.calcularPuntosEnEstado === 'function') {
    window.calcularPuntosEnEstado(selectedEstadoFeature, estadoSeleccionado);
  }
  if (isAreaFilterActive && selectedAreaFeature && typeof window.calcularElementosEnArea === 'function') {
    window.calcularElementosEnArea(selectedAreaFeature, areaSeleccionada);
  }
  if (isBloqueFilterActive && selectedBloqueFeature && typeof window.calcularPuntosEnBloque === 'function') {
    window.calcularPuntosEnBloque(selectedBloqueFeature, bloqueSeleccionado);
  }
  sincronizarInterseccion();
}

export { aplicarFiltroEstado, aplicarFiltroBloque, aplicarFiltroArea };
