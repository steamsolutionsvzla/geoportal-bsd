// filters.js
import { getMap } from './map-config.js';
import { obtenerNombreEstado, obtenerNombreBloque } from './utils.js';
import { setInfoPanelData, renderInfoPanel } from './info-panel.js';
import * as turf from '@turf/turf';

let estadosGeoJsonCache = null;
let bloquesGeoJsonCache = null;
let isFilterActive = false;
let isBloqueFilterActive = false;
let selectedStateFeatureId = null;
let selectedBloqueFeatureId = null;
let selectedEstadoFeature = null;   // feature del estado seleccionado (para recalcular)
let selectedBloqueFeature = null;   // feature del bloque seleccionado (para recalcular)
let estadoSeleccionado = '';
let bloqueSeleccionado = '';
let currentFilterData = null;
let currentBloqueFilterData = null;

export function setEstadosCache(data) { estadosGeoJsonCache = data; }
export function setBloquesCache(data) { bloquesGeoJsonCache = data; }

export function getFilterState() {
  return { isFilterActive, isBloqueFilterActive, estadoSeleccionado, bloqueSeleccionado };
}

export function setupFilterDropdowns(estadosCache, bloquesCache) {
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
  if (dropdownBloque && bloquesGeoJsonCache) {
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
  if (dropdownBloque) {
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

  setInfoPanelData({ currentFilterData: null, isFilterActive: false });
  renderInfoPanel();
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
}

// -------------------------------------------------------------------------
// AJUSTAR VISTA A LOS FILTROS ACTIVOS (puede ser uno o ambos)
// -------------------------------------------------------------------------
function fitToActiveFilters() {
  const map = getMap();
  const features = [];
  if (isFilterActive && selectedEstadoFeature) features.push(selectedEstadoFeature);
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

  // Ya NO se limpia el filtro de bloque: ambos pueden coexistir
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
  if (isFilterActive && selectedEstadoFeature && typeof window.calcularPuntosEnEstado === 'function') {
    window.calcularPuntosEnEstado(selectedEstadoFeature, estadoSeleccionado);
  }
  if (isBloqueFilterActive && selectedBloqueFeature && typeof window.calcularPuntosEnBloque === 'function') {
    window.calcularPuntosEnBloque(selectedBloqueFeature, bloqueSeleccionado);
  }
}

export { aplicarFiltroEstado, aplicarFiltroBloque };