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
import { initDrawTools, startPolygonTool } from './draw-tools.js';
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
import { obtenerNombreEstado, normalizarNombreEstado, obtenerNombreBloque, refreshCount, updateLegendUI, getPaletteForType, hashCode, apiFetch, esperarMapaListo, revokeSession, esCapa, claveNombreCapa } from './utils.js';
import {
  setAvailableLayers, renderLayerGroups, attachLayerToggleEvents, loadLayerToMap, applySavedStyleColors,
  getAvailableLayers, getLayerDisplayName, getSelectedSourceId, getSelectedFeatureId,
  setSelectedSourceId, setSelectedFeatureId, clearSelection, updateLayerFeatureCount,
  attachLayerOpacityEvents,
  attachLayerDownloadEvents,
  getLayerRawData, clearLayerRawData,   // 👈 NUEVOS
  isRasterLayer, addRasterLayerToMap, removeRasterLayer,
  setLayerFillOpacity
} from './layer-manager.js';
import {
  obtenerOrganizacion, obtenerOrganizacionShowroom, abrirPanelOrganizacion, construirGruposDesdeCarpetas
} from './org-panel.js';
import { openFeaturePopup, closeFeaturePopup } from './feature-popup.js';
import { beginBusy, endBusy, resetBusy } from './busy-overlay.js';
import { initLocationSearch } from './loc-search.js';
import { initShareView, applySharedView } from './share.js';
import { attachLayerAttrTableEvents } from './attr-table.js';

// =========================================================================
// WORKER DE MAPLIBRE (obligatorio en v5+)
// =========================================================================
setWorkerUrl(maplibreWorkerUrl);

// =========================================================================
// CONSTANTES DE CAPAS ESPECIALES
// =========================================================================
const BLOQUES_LAYER_BASE = 'Bloques petroleros';
const ESTADOS_LAYER_BASE = 'División Político Territorial';
let BLOQUES_LAYER_NAME = BLOQUES_LAYER_BASE;
let ESTADOS_LAYER_NAME = ESTADOS_LAYER_BASE;
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
  const keyBuscada = claveNombreCapa(name);
  for (const [key, value] of stylesMap) {
    if (claveNombreCapa(key.split(':').pop()) === keyBuscada) return value;
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

// Evita que una petición inicial deje la interfaz bloqueada para siempre.
function signalTimeout(ms = 20000) {
  try {
    return typeof AbortSignal !== 'undefined' && AbortSignal.timeout
      ? AbortSignal.timeout(ms)
      : undefined;
  } catch (_) {
    return undefined;
  }
}

// =========================================================================
// VARIABLES GLOBALES
// =========================================================================
let availableLayers = [];
let stylesMap = new Map();

// Organización de capas en carpetas (personal del usuario) y estado de render.
let wsGroupsBase = [];        // grupos originales por workspace (fuente de capas)
let organizacionActual = null; // carpetas guardadas del usuario; null = por workspaces
let orgShowroomInfo = null;   // {folders, updated_at, updated_by} de Showroom
let gruposRenderizados = [];   // grupos tal como se muestran (para buscador/índice)
let estadosGeoJsonCache = null;
let bloquesGeoJsonCache = null;
let currentFilterData = null;
let currentBloqueFilterData = null;
let currentAreaFilterData = null;
let currentIntersectionFilterData = null;
let activeBloqueId = null;
let bloqueSelectionToken = 0;
let isFilterActive = false;
let isBloqueFilterActive = false;
let estadoSeleccionado = '';
let bloqueSeleccionado = '';
const IS_SHOWROOM = document.body.dataset.showroom === 'true';

// =========================================================================
// INICIALIZACIÓN
// =========================================================================
document.addEventListener('DOMContentLoaded', async () => {
  const map = initMap('map');
  window.map = map;

  // Buscador: debounce + Escape limpia al perder foco; '/' enfoca.
  let searchDebounce = null;
  const layerSearchInput = document.getElementById('layerSearch');
  layerSearchInput?.addEventListener('input', () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(aplicarBusquedaCapas, 120);
  });
  layerSearchInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); clearTimeout(searchDebounce); aplicarBusquedaCapas(); return; }
    if (e.key === 'Escape') {
      e.preventDefault();
      limpiarBusquedaCapas();
      layerSearchInput.blur();
    }
  });
  document.getElementById('layerSearchClear')?.addEventListener('click', limpiarBusquedaCapas);
  document.addEventListener('keydown', (e) => {
    if (e.key !== '/' || e.repeat) return;
    const t = e.target;
    if (t && (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || t.isContentEditable)) return;
    const s = document.getElementById('layerSearch');
    if (!s) return;
    e.preventDefault();
    s.focus();
    s.select();
  });
  setupBusquedaChips();

  // Botón "Apagar todas": desactiva todas las capas activas (equivale a
  // hacer clic en cada toggle). Se habilita solo cuando hay capas activas.
  document.getElementById('layerOffAllBtn')?.addEventListener('click', () => {
    const cont = document.getElementById('layersGroupsContainer');
    if (!cont) return;
    [...cont.querySelectorAll('.toggle.on')].forEach(t => t.click());
  });
  // Refrescar el estado del botón tras cualquier toggle (delegado; rAF para
  // correr después de que el handler de layer-manager actualice las clases).
  document.getElementById('sidebar')?.addEventListener('click', (e) => {
    if (e.target.closest('.layer-row')) requestAnimationFrame(actualizarBotonApagar);
  });

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
        const initWatchdog = setTimeout(() => {
          console.warn('La carga inicial tardó demasiado; se libera la interfaz.');
          resetBusy();
          mostrarError('La carga inicial está tardando demasiado. Revisa la conexión con el servidor.');
        }, 25000);
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
              setupAreaFilter({ onRequestDraw: () => startPolygonTool() });
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
          attachLayerDownloadEvents(sidebar);
          attachLayerAttrTableEvents(sidebar);

          // Buscador de ubicación (topbar) + compartir vista. Solo operan si
          // la página trae sus controles (geoportal); en showroom u otras
          // páginas quedan como no-op.
          initLocationSearch();
          initShareView(map);
          await applySharedView(map);
        } finally {
          clearTimeout(initWatchdog);
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

    window.handleFeatureClick = (tableName, props, lngLat, onClose = null) => {
      // Mientras se dibuja o se mide, los clics pertenecen a la herramienta.
      if (window.__mapToolActive) return null;
      const displayName = getLayerDisplayName(tableName);
      showLayerMetadataInPanel(tableName, displayName);
      const style = getStyleCapa(tableName);
      if (!lngLat) return null;
      return openFeaturePopup(
        map, displayName, props, lngLat,
        style?.visible_attributes ?? null,
        tableName,
        style?.attribute_labels ?? null,
        onClose,
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
    window.limpiarFiltroArea = () => limpiarFiltroArea({ keepLayer: false });
    window.limpiarResaltadoFiltro = limpiarResaltadoFiltro;
    window.cerrarSesion = cerrarSesion;

    document.querySelector('.logout-btn')?.addEventListener('click', cerrarSesion);
    // Engranaje: organizar capas (personal en geoportal; general en Showroom).
    document.getElementById('organizeBtn')?.addEventListener('click', () => {
      abrirPanelOrganizacion({
        wsGroups: wsGroupsBase,
        folders: organizacionActual,
        showroom: IS_SHOWROOM,
        lastEdit: IS_SHOWROOM ? orgShowroomInfo : null,
        onGuardado: (folders, resultado) => {
          if (IS_SHOWROOM) {
            organizacionActual = folders && folders.length ? folders : null;
            orgShowroomInfo = {
              folders: organizacionActual,
              updated_by: resultado?.updated_by || orgShowroomInfo?.updated_by || null,
              updated_at: resultado?.updated_at || new Date().toISOString(),
            };
          } else {
            organizacionActual = folders && folders.length ? folders : null;
          }
          renderizarListaCapas(gruposParaRender());
        }
      });
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
    const response = await apiFetch('/api/v1/layers/workspaces', { signal: signalTimeout() });

    if (!response.ok) {
      throw new Error(`Error ${response.status}: ${response.statusText}`);
    }
    let groups = await response.json();

    groups.forEach(group => {
      group.layers.forEach(layer => {
        const id = layer.id.split(':').pop();
        if (esCapa(id, ESTADOS_LAYER_BASE) || esCapa(id, BLOQUES_LAYER_BASE)) {
          layer.type = 'fill';
          layer.noOpacity = true;   // 👈 NUEVO: sin slider de opacidad
          if (esCapa(id, ESTADOS_LAYER_BASE)) {
            layer.color = '#1a365d';
          } else if (esCapa(id, BLOQUES_LAYER_BASE)) {
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

    // Las capas especiales pueden venir con sufijo de geometría (_PL/_P/_L).
    // Se resuelve el nombre real para usar el mismo id que el catálogo.
    const resolverCapaEspecial = (base) => {
      const encontrada = availableLayers.find(
        l => esCapa((l.id || '').split(':').pop(), base)
      );
      return encontrada ? encontrada.id.split(':').pop() : base;
    };
    BLOQUES_LAYER_NAME = resolverCapaEspecial(BLOQUES_LAYER_BASE);
    ESTADOS_LAYER_NAME = resolverCapaEspecial(ESTADOS_LAYER_BASE);

    wsGroupsBase = groups;

    // Organización en carpetas: personal en geoportal, general en Showroom.
    if (IS_SHOWROOM) {
      try {
        const info = await obtenerOrganizacionShowroom();
        organizacionActual = info?.folders?.length ? info.folders : null;
        orgShowroomInfo = info || null;
      } catch (e) {
        console.warn('No se pudo cargar la organización de Showroom (se usa "Sin organización"):', e);
        organizacionActual = null;
        orgShowroomInfo = null;
      }
    } else {
      try {
        organizacionActual = await obtenerOrganizacion();
      } catch (e) {
        console.warn('No se pudo cargar la organización de carpetas (se usa la vista por workspace):', e);
        organizacionActual = null;
      }
    }

    renderizarListaCapas(gruposParaRender());
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
// BUSCADOR DE CAPAS
// =========================================================================
function normalizarBusqueda(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Mapa entre cada carácter del texto normalizado y su posición en el
 * original, para poder resaltar la coincidencia aunque haya tildes.
 */
function indiceNormalizado(texto) {
  let norm = '';
  const mapa = [];
  for (let i = 0; i < texto.length; i++) {
    const trozo = normalizarBusqueda(texto[i]);
    for (let j = 0; j < trozo.length; j++) {
      norm += trozo[j];
      mapa.push(i);
    }
  }
  mapa.push(texto.length);
  return { norm, mapa };
}

function resaltarCoincidencia(el, q) {
  if (!el) return;
  if (el.dataset.plain === undefined) el.dataset.plain = el.textContent || '';
  const original = el.dataset.plain;
  el.textContent = original;
  if (!q) return;

  const { norm, mapa } = indiceNormalizado(original);
  const idx = norm.indexOf(q);
  if (idx === -1) return;

  const inicio = mapa[idx] ?? 0;
  const fin = mapa[idx + q.length] ?? original.length;
  if (fin <= inicio) return;

  const antes = original.slice(0, inicio);
  const coincidencia = original.slice(inicio, fin);
  const despues = original.slice(fin);

  el.textContent = '';
  if (antes) el.appendChild(document.createTextNode(antes));
  const mark = document.createElement('mark');
  mark.textContent = coincidencia;
  el.appendChild(mark);
  if (despues) el.appendChild(document.createTextNode(despues));
}

// Aliases de tipo de geometría para el buscador (sin tildes: se normalizan).
const TIPO_ALIAS = {
  circle: ['punto', 'puntos', 'point', 'circulo', 'marker'],
  line: ['linea', 'lineas', 'line', 'ducto', 'ductos', 'ruta'],
  fill: ['poligono', 'poligonos', 'polygon', 'fill', 'area', 'areas', 'zona', 'zonas'],
  raster: ['raster', 'imagen', 'imagenes', 'grid', 'base']
};

// true si la distancia de edición entre a y b es como máximo 1 (typos leves).
function edDistMax1(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (i >= Math.min(a.length, b.length)) return true; // uno es prefijo del otro
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  if (a.length < b.length) return b.slice(i + 1) === a.slice(i);
  return a.slice(i + 1) === b.slice(i);
}

function puntuarToken(e, t) {
  if (!t) return 0;
  if (e.nameNorm === t) return 100;
  if (e.nameNorm.startsWith(t)) return 70;
  if (e.palabras.some(w => w.startsWith(t))) return 60;
  if (e.nameNorm.includes(t)) return 45;
  if ((TIPO_ALIAS[e.kind] || []).includes(t)) return 38;
  if (e.groupNorm && e.groupNorm.includes(t)) return 28;
  if (e.wsNorm && e.wsNorm.includes(t)) return 25;
  if (e.idNorm.includes(t)) return 18;
  if (t.length >= 4 && e.palabras.some(w => w.length >= 3 && edDistMax1(t, w))) return 14;
  return 0;
}

// Índice de búsqueda sobre el modelo (nombre, id, workspace, grupo, tipo).
function construirIndiceBusqueda() {
  const idx = new Map();
  gruposRenderizados.forEach(g => {
    const gNorm = normalizarBusqueda(g.title || g.name || '');
    (g.layers || []).forEach(l => {
      const nameNorm = normalizarBusqueda(l.name || '');
      idx.set(l.id, {
        id: l.id,
        kind: (l.type === 'point' ? 'circle' : (l.type || 'fill')),
        nameNorm,
        idNorm: normalizarBusqueda(l.id),
        wsNorm: normalizarBusqueda(l.id.includes(':') ? l.id.split(':')[0] : ''),
        groupNorm: gNorm,
        palabras: nameNorm.split(/\s+/).filter(Boolean)
      });
    });
  });
  return idx;
}

function leerChipsFiltro() {
  const cont = document.getElementById('layerSearchChips');
  const tipos = new Set();
  let visib = null;
  cont?.querySelectorAll('.ls-chip.active[data-chip]').forEach(c => {
    const v = c.dataset.chip;
    if (!v || v === 'help') return;
    if (v === 'on' || v === 'off') visib = v;
    else tipos.add(v);
  });
  return { tipos, visib };
}

function aplicarBusquedaCapas() {
  const cont = document.getElementById('layersGroupsContainer');
  if (!cont) return;
  const input = document.getElementById('layerSearch');
  const q = normalizarBusqueda(input?.value || '');
  const tokens = q ? q.split(/\s+/).filter(Boolean) : [];
  const { tipos, visib } = leerChipsFiltro();
  const filtrando = tokens.length > 0 || tipos.size > 0 || Boolean(visib);
  const idx = construirIndiceBusqueda();

  const groupBlocks = [...cont.querySelectorAll('.layer-group')];
  let totalVisibles = 0;

  groupBlocks.forEach(group => {
    const layersBox = group.querySelector('.group-layers');
    if (!layersBox) return;
    const items = [...layersBox.querySelectorAll('.layer-item')];
    const conScore = [];

    items.forEach(item => {
      const entry = idx.get(item.dataset.table);
      const toggleOn = Boolean(item.querySelector('.toggle.on'));
      let ok = Boolean(entry);
      let score = 0;

      if (ok && tipos.size && !tipos.has(entry.kind)) ok = false;
      if (ok && visib === 'on' && !toggleOn) ok = false;
      if (ok && visib === 'off' && toggleOn) ok = false;
      if (ok) {
        for (const t of tokens) {
          const s = puntuarToken(entry, t);
          if (!s) { ok = false; break; }
          score += s;
        }
      }

      item.hidden = !ok;
      const nameEl = item.querySelector('.lname');
      if (nameEl) {
        const tmatch = ok ? tokens.find(t => entry.nameNorm.includes(t)) : null;
        resaltarCoincidencia(nameEl, tmatch || '');
      }
      if (ok) { totalVisibles++; conScore.push({ item, score }); }
    });

    group.hidden = conScore.length === 0;

    if (filtrando) {
      conScore.sort((a, b) => b.score - a.score || Number(a.item.dataset.origIdx || 0) - Number(b.item.dataset.origIdx || 0));
      conScore.forEach(({ item }) => layersBox.appendChild(item));
      if (conScore.length) {
        layersBox.classList.add('open');
        group.querySelector('.group-header')?.classList.add('open');
      }
    } else {
      items
        .sort((a, b) => Number(a.dataset.origIdx || 0) - Number(b.dataset.origIdx || 0))
        .forEach(item => layersBox.appendChild(item));
    }

    group._scoreMax = conScore.length ? Math.max(...conScore.map(c => c.score)) : 0;
  });

  // Reordenar grupos por relevancia mientras se filtra.
  if (filtrando) {
    groupBlocks
      .sort((a, b) => (b._scoreMax || 0) - (a._scoreMax || 0) || Number(a.dataset.origIdx || 0) - Number(b.dataset.origIdx || 0))
      .forEach(g => cont.appendChild(g));
  } else {
    groupBlocks
      .sort((a, b) => Number(a.dataset.origIdx || 0) - Number(b.dataset.origIdx || 0))
      .forEach(g => cont.appendChild(g));
  }

  // Mensaje de vacío con sugerencia "¿Quizás buscabas…?".
  let empty = cont.querySelector('.layer-search-empty');
  if (filtrando && totalVisibles === 0) {
    if (!empty) {
      empty = document.createElement('p');
      empty.className = 'layer-search-empty';
      cont.appendChild(empty);
    }
    const texto = (input?.value || '').trim();
    const primer = q ? q.split(/\s+/)[0] : '';
    const sug = sugerirCapas(texto);
    empty.textContent = sug
      ? `Nada coincide con “${texto}”. ¿Quizás buscabas “${sug}”?`
      : 'No hay capas que coincidan con el filtro actual.';
  } else if (empty) {
    empty.remove();
  }

  // Controles: botón limpiar + contador.
  const clearBtn = document.getElementById('layerSearchClear');
  const countEl = document.getElementById('layerSearchCount');
  if (clearBtn) clearBtn.hidden = !(input?.value);
  if (countEl) {
    countEl.hidden = !filtrando;
    if (filtrando) {
      countEl.textContent = totalVisibles === 1
        ? `1 de ${availableLayers.length} capa`
        : `${totalVisibles} de ${availableLayers.length} capas`;
    }
  }
}

// Devuelve el nombre de la capa más parecida al texto (para el aviso de arriba).
function sugerirCapas(texto) {
  const t = normalizarBusqueda(texto || '').split(/\s+/)[0];
  if (!t || t.length < 3) return '';
  let mejor = null;
  let mejorScore = 0;
  availableLayers.forEach(l => {
    const nameNorm = normalizarBusqueda(l.name || '');
    const palabras = nameNorm.split(/\s+/).filter(Boolean);
    let s = 0;
    if (nameNorm.includes(t)) s = 45;
    else if (palabras.some(w => w.length >= 4 && edDistMax1(t, w))) s = 14;
    if (s > mejorScore) { mejorScore = s; mejor = l; }
  });
  return mejor ? String(mejor.name || '') : '';
}

function limpiarBusquedaCapas() {
  const input = document.getElementById('layerSearch');
  if (!input) return;
  input.value = '';
  document.querySelectorAll('#layerSearchChips .ls-chip.active').forEach(c => {
    if (c.id === 'layerSearchHelp') return; // los tips se quedan como están
    c.classList.remove('active');
    c.setAttribute('aria-pressed', 'false');
  });
  aplicarBusquedaCapas();
  input.focus();
}

// Chips de filtro rápido + panel de tips.
function setupBusquedaChips() {
  const cont = document.getElementById('layerSearchChips');
  if (!cont) return;

  cont.querySelectorAll('.ls-chip[data-chip]').forEach(chip => {
    if (chip.id === 'layerSearchHelp') return;
    chip.addEventListener('click', () => {
      const v = chip.dataset.chip;
      if (v === 'on' || v === 'off') {
        const estaba = chip.classList.contains('active');
        cont.querySelectorAll('.ls-chip[data-chip="on"], .ls-chip[data-chip="off"]').forEach(c => {
          c.classList.remove('active');
          c.setAttribute('aria-pressed', 'false');
        });
        if (!estaba) {
          chip.classList.add('active');
          chip.setAttribute('aria-pressed', 'true');
        }
      } else {
        const activo = chip.classList.toggle('active');
        chip.setAttribute('aria-pressed', activo ? 'true' : 'false');
      }
      aplicarBusquedaCapas();
    });
  });

  const help = document.getElementById('layerSearchHelp');
  let tipsEl = null;
  help?.addEventListener('click', () => {
    const activo = help.classList.toggle('active');
    help.setAttribute('aria-pressed', activo ? 'true' : 'false');
    if (activo) {
      if (!tipsEl) {
        tipsEl = document.createElement('p');
        tipsEl.className = 'layer-search-tips';
        tipsEl.innerHTML = 'Varias palabras («pozos someros») · «puntos», «líneas», «polígonos» o «raster» filtran por tipo · <b>Activas</b> e <b>Inactivas</b> filtran por estado · <b>/</b> enfoca la búsqueda · <b>Esc</b> limpia · <b>Enter</b> busca al instante.';
        cont.parentNode.insertBefore(tipsEl, cont.nextSibling);
      }
      tipsEl.hidden = false;
    } else if (tipsEl) {
      tipsEl.hidden = true;
    }
  });
}

// =========================================================================
// RENDER DE LA LISTA DE CAPAS (conserva estado al reagrupar)
// =========================================================================
function gruposParaRender() {
  if (IS_SHOWROOM) {
    if (organizacionActual && organizacionActual.length) {
      return construirGruposDesdeCarpetas(organizacionActual, wsGroupsBase, 'Sin organización');
    }
    return wsGroupsBase;
  }
  if (organizacionActual) return construirGruposDesdeCarpetas(organizacionActual, wsGroupsBase);
  return wsGroupsBase;
}

// Habilita/deshabilita el botón "Apagar todas" según haya capas activas.
function actualizarBotonApagar() {
  const btn = document.getElementById('layerOffAllBtn');
  if (!btn) return;
  const activas = document.querySelectorAll('#layersGroupsContainer .toggle.on').length;
  btn.disabled = activas === 0;
  btn.title = activas ? `Apagar las ${activas} capas activas` : 'No hay capas activas';
}

/**
 * Renderiza grupos en el sidebar preservando: toggles activos, conteos,
 * opacidad, grupos abiertos y estilos guardados. Al terminar aplica la
 * búsqueda activa.
 */
function renderizarListaCapas(grupos) {
  const cont = document.getElementById('layersGroupsContainer');
  if (!cont) return;

  // 1) Capturar estado antes de reconstruir el DOM.
  const activas = new Set([...cont.querySelectorAll('.toggle.on')].map(t => t.getAttribute('data-table')));
  const opacidades = new Map([...cont.querySelectorAll('.layer-opacity-slider')].map(s => [s.getAttribute('data-table'), s.value]));
  const gruposAbiertos = new Set(
    [...cont.querySelectorAll('.group-header.open .group-name')].map(el => (el.textContent || '').trim())
  );

  // 2) Render nuevo.
  renderLayerGroups(grupos, 'layersGroupsContainer');
  gruposRenderizados = grupos;

  // Orden original (para restaurar al limpiar la búsqueda).
  cont.querySelectorAll('.layer-group').forEach((g, gi) => {
    g.dataset.origIdx = String(gi);
    g.querySelectorAll('.layer-item').forEach((it, ii) => { it.dataset.origIdx = String(ii); });
  });

  // 3) Reaplicar estilos guardados por el analista.
  applySavedStyleColors(stylesMap);

  // 4) Restaurar toggles activos y conteos (las capas siguen en el mapa).
  activas.forEach(id => {
    const toggle = cont.querySelector(`.toggle[data-table="${CSS.escape(id)}"]`);
    if (!toggle) return;
    toggle.classList.add('on');
    toggle.closest('.layer-row')?.classList.remove('off');
    toggle.closest('.layer-item')?.classList.add('active');
    const layer = availableLayers.find(l => l.id === id);
    if (layer && Number.isFinite(layer.featureCount)) updateLayerFeatureCount(id, layer.featureCount);
  });

  // 5) Restaurar opacidades individuales.
  opacidades.forEach((val, id) => {
    const slider = cont.querySelector(`.layer-opacity-slider[data-table="${CSS.escape(id)}"]`);
    if (!slider) return;
    slider.value = val;
    const label = slider.parentElement?.querySelector('.layer-opacity-value');
    if (label) label.textContent = `${val}%`;
    setLayerFillOpacity(id, val);
  });

  // 6) Grupos que estaban abiertos siguen abiertos.
  cont.querySelectorAll('.layer-group').forEach(group => {
    const name = (group.querySelector('.group-name')?.textContent || '').trim();
    if (name && gruposAbiertos.has(name)) {
      group.querySelector('.group-header')?.classList.add('open');
      group.querySelector('.group-layers')?.classList.add('open');
    }
  });

  refreshCount();
  updateLegendUI(availableLayers);
  actualizarBotonApagar();
  aplicarBusquedaCapas();
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
    const response = await apiFetch(`/api/v1/layers/${encodeURIComponent(ESTADOS_LAYER_NAME)}`, { signal: signalTimeout(180000) });
    if (!response.ok) {
      throw new Error(`Error ${response.status}: ${response.statusText}`);
    }
    const data = await response.json();

    const featuresByName = {};
    data.features.forEach(f => {
      try {
        const nombre = obtenerNombreEstado(f.properties);
        if (!nombre) return;
        const geometry = f.geometry;
        // Algunas tablas traen filas sin geometría o con coordinates nulo.
        // Sin esta guarda se rompe toda la carga y el filtro queda vacío.
        if (!geometry || !Array.isArray(geometry.coordinates)) return;
        if (!featuresByName[nombre]) {
          featuresByName[nombre] = {
            type: 'Feature',
            properties: { ...f.properties },
            geometry: { type: 'MultiPolygon', coordinates: [] }
          };
        }
        if (geometry.type === 'Polygon') {
          featuresByName[nombre].geometry.coordinates.push(geometry.coordinates);
        } else if (geometry.type === 'MultiPolygon') {
          geometry.coordinates.forEach(coords => {
            featuresByName[nombre].geometry.coordinates.push(coords);
          });
        }
      } catch (error) {
        console.warn('Entidad de estados inválida; se omite:', error, f);
      }
    });
    data.features = Object.values(featuresByName);

    // Normaliza el nombre visible del estado. En particular, el polígono
    // de la reclamación viene como "Zona en Reclamación" y debe mostrarse
    // como "Guayana Esequiba" en el filtro y en la etiqueta del mapa.
    data.features.forEach(f => {
      try {
        const nombre = obtenerNombreEstado(f.properties);
        if (!nombre) return;

        const nombreNormalizado = normalizarNombreEstado(nombre);
        f.properties._estado_nombre = nombreNormalizado;

        const claveNombre = Object.keys(f.properties).find(k =>
          ['entidad', 'estado', 'nombre', 'name'].includes(k.toLowerCase())
        );
        if (claveNombre) f.properties[claveNombre] = nombreNormalizado;
      } catch (error) {
        console.warn('No se pudo normalizar el estado; se omite:', error, f);
      }
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

    const styleEstados = getStyleCapa(ESTADOS_LAYER_NAME);
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

    updateLayerFeatureCount(ESTADOS_LAYER_NAME, data.features.length);
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
    const response = await apiFetch(`/api/v1/layers/${encodeURIComponent(BLOQUES_LAYER_NAME)}`, { signal: signalTimeout() });
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
          'fill-color': [
            'case',
            ['boolean', ['feature-state', 'active'], false], '#facc15',
            '#8a4baf'
          ],
          'fill-opacity': [
            'case',
            ['boolean', ['feature-state', 'active'], false], 0.35,
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
          'line-color': [
            'case',
            ['boolean', ['feature-state', 'active'], false], '#facc15',
            '#8a4baf'
          ],
          'line-width': [
            'case',
            ['boolean', ['feature-state', 'active'], false], 4,
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
        const clickedId = ev.features[0].id;

        if (activeBloqueId !== null) {
          map.setFeatureState({ source: BLOQUE_SOURCE_ID, id: activeBloqueId }, { active: false });
        }
        activeBloqueId = clickedId;
        const token = ++bloqueSelectionToken;
        map.setFeatureState({ source: BLOQUE_SOURCE_ID, id: activeBloqueId }, { active: true });

        if (typeof window.handleFeatureClick === 'function') {
          window.handleFeatureClick(BLOQUES_LAYER_NAME, props, ev.lngLat, () => {
            if (token !== bloqueSelectionToken) return;
            if (activeBloqueId === clickedId) {
              try {
                map.setFeatureState({ source: BLOQUE_SOURCE_ID, id: clickedId }, { active: false });
              } catch (_) { /* capa eliminada */ }
              activeBloqueId = null;
            }
          });
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
// Candado POR CAPA (no global): cada capa se puede cargar en paralelo, pero
// no se permite re-entrar en la misma mientras su GeoJSON está en vuelo.
// El candado global anterior descartaba clics consecutivos (p. ej. al
// restaurar un enlace de "compartir vista"): la capa quedaba marcada como
// activa en la UI pero nunca se dibujaba en el mapa.
const cargandoCapas = new Set();

async function handleLayerToggle(tableName, isVisible, toggleBtn, rowTarget) {
  if (cargandoCapas.has(tableName)) return;
  cargandoCapas.add(tableName);

  if (!isVisible) closeFeaturePopup(tableName);

  try {
    const map = getMap();
    const shortName = tableName.split(':').pop();

    if (esCapa(shortName, ESTADOS_LAYER_BASE)) {
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
      cargandoCapas.delete(tableName);
      return;
    }

    if (esCapa(shortName, BLOQUES_LAYER_BASE)) {
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
      cargandoCapas.delete(tableName);
      return;
    }

    const sourceId = `source-${tableName}`;
    const layerId = `layer-${tableName}`;

    // ---- Capas raster (WMS): sin GeoJSON, sin conteo de features ----
    const layerInfo = getAvailableLayers().find(l => l.id === tableName);
    if (isRasterLayer(layerInfo)) {
      if (isVisible) {
        rowTarget?.classList.add('is-loading');
        mostrarCargando(true);
        try {
          addRasterLayerToMap(layerInfo, map);
          await esperarMapaListo(map);
        } finally {
          rowTarget?.classList.remove('is-loading');
          mostrarCargando(false);
        }
      } else {
        removeRasterLayer(tableName, map);
        clearSelectedLayerMetadataIfMatches(tableName);
      }
      refreshCount();
      updateLegendUI(getAvailableLayers());
      renderInfoPanel();
      cargandoCapas.delete(tableName);
      return;
    }

    if (isVisible) {
      rowTarget?.classList.add('is-loading');
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
        rowTarget?.classList.remove('is-loading');
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
    cargandoCapas.delete(tableName);
    rowTarget?.classList.remove('is-loading');
  }
}

// =========================================================================
// RESALTADO DE FEATURES FILTRADAS
// Al aplicar un filtro (estado/bloque/área) las features que caen dentro se
// marcan con `feature-state.selected` para que se pinten en amarillo.
// Se lleva un registro por fuente para poder limpiarlas sin pisar el resaltado
// de clic de una sola feature.
// =========================================================================
const filterHighlightRegistry = new Map(); // sourceId -> Set(featureId)

function limpiarResaltadoFiltro() {
  const map = getMap();
  for (const [source, ids] of filterHighlightRegistry) {
    ids.forEach((id) => {
      try { map.setFeatureState({ source, id }, { selected: false }); } catch (_) { /* ignorar */ }
    });
  }
  filterHighlightRegistry.clear();
}

function resaltarFeaturesFiltradas(sourceId, indices) {
  const map = getMap();
  const previos = filterHighlightRegistry.get(sourceId);
  if (previos) {
    previos.forEach((id) => {
      try { map.setFeatureState({ source: sourceId, id }, { selected: false }); } catch (_) { /* ignorar */ }
    });
  }

  const nuevos = new Set(indices);
  nuevos.forEach((id) => {
    try { map.setFeatureState({ source: sourceId, id }, { selected: true }); } catch (_) { /* ignorar */ }
  });
  filterHighlightRegistry.set(sourceId, nuevos);
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
    const indicesDentro = [];
    // Dedupe de filas gemelas exactas (duplicados ETL en las tablas base).
    const vistos = new Set();

    sourceData.features.forEach((ptFeature, index) => {
      if (!ptFeature || !ptFeature.geometry) return;
      if (ptFeature.geometry.type !== 'Point' && ptFeature.geometry.type !== 'MultiPoint') return;
      const clave = JSON.stringify(ptFeature.geometry) + '~' + JSON.stringify(ptFeature.properties || null);
      if (vistos.has(clave)) return;
      try {
        if (turf.booleanPointInPolygon(ptFeature, estadoPolygonFeature)) {
          vistos.add(clave);
          countInPolygon++;
          featuresInLayer.push(ptFeature.properties);
          indicesDentro.push(index);
        }
      } catch (_) { /* geometría inválida, ignorar */ }
    });

    resaltarFeaturesFiltradas(sourceId, indicesDentro);

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
    const indicesDentro = [];
    // Dedupe de filas gemelas exactas (duplicados ETL en las tablas base).
    const vistos = new Set();

    sourceData.features.forEach((ptFeature, index) => {
      if (!ptFeature || !ptFeature.geometry) return;
      if (ptFeature.geometry.type !== 'Point' && ptFeature.geometry.type !== 'MultiPoint') return;
      const clave = JSON.stringify(ptFeature.geometry) + '~' + JSON.stringify(ptFeature.properties || null);
      if (vistos.has(clave)) return;
      try {
        if (turf.booleanPointInPolygon(ptFeature, bloquePolygonFeature)) {
          vistos.add(clave);
          countInPolygon++;
          featuresInLayer.push(ptFeature.properties);
          indicesDentro.push(index);
        }
      } catch (_) { /* ignore */ }
    });

    resaltarFeaturesFiltradas(sourceId, indicesDentro);

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

    // El filtro cuenta SOLO puntos (decisión de producto): las líneas/ductos
    // se siguen viendo en el mapa pero no entran al conteo.
    if (!esPunto) return;

    let countInPoligonos = 0;
    const featuresInLayer = [];
    const indicesDentro = [];
    // Claves de fila ya contadas: varias tablas llegan de GeoServer con
    // duplicados exactos (misma geometría y mismos atributos; p. ej.
    // Estaciones x3). Sin esto, un punto visible contaría varias veces.
    const vistos = new Set();

    sourceData.features.forEach((feature, index) => {
      if (!feature || !feature.geometry) return;
      const gtipo = feature.geometry.type;
      if (gtipo !== 'Point' && gtipo !== 'MultiPoint') return;

      const clave = JSON.stringify(feature.geometry) + '~' + JSON.stringify(feature.properties || null);
      if (vistos.has(clave)) return; // fila gemela: no se cuenta ni resalta otra vez

      if (estadoFeature && !geometriaDentroDePoligono(feature, estadoFeature)) return;
      if (areaFeature && !geometriaDentroDePoligono(feature, areaFeature)) return;

      vistos.add(clave);
      countInPoligonos++;
      featuresInLayer.push(feature.properties);
      indicesDentro.push(index);
    });

    resaltarFeaturesFiltradas(sourceId, indicesDentro);

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
  revokeSession();
  localStorage.removeItem('auth_token');
  localStorage.removeItem('auth_session');
  sessionStorage.clear();
  window.location.href = '/login';
}