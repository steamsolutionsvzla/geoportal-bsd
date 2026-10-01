// analista-main.js - Vista de configuración de estilos por capa
import { setWorkerUrl, Popup } from 'maplibre-gl';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

import {
  initMap, setupZoomControls, addBaseLayers, setupBasemapSwitcher, getMap,
} from './map-config.js';
import {
  setAvailableLayers, loadLayerToMap, getLayerDisplayName,
} from './layer-manager.js';
import { apiFetch, getPaletteForType, hashCode, esperarMapaListo } from './utils.js';
import { applyStyle } from '../lib/mapStyles.js';
import {
  fetchStyles, saveStyle, resetStyle, fetchLayerAttributes,
} from '../services/styles.js';

setWorkerUrl(maplibreWorkerUrl);

// ---------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------
let availableLayers = [];
let workspaceGroups = [];
const openGroups = new Set();      // grupos (workspaces) desplegados
const expandedLayers = new Set();  // capas con ajustes desplegados
const stylesMap = new Map();      // layer_name -> LayerStyle
const layerToggleState = new Map(); // layer_name -> bool (capa activa en el mapa)
const attrsCache = new Map();     // layer_name -> string[]
let map = null;

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', async () => {
  map = initMap('map');
  window.map = map;

  map.on('load', async () => {
    addBaseLayers(map);
    setupZoomControls(map);
    setupBasemapSwitcher(map);

    await cargarCapasYEstilos();
    renderPanel();
  });
});

// ---------------------------------------------------------------------------
// Carga inicial
// ---------------------------------------------------------------------------
async function cargarCapasYEstilos() {
  // 1. Capas (filtradas por workspace del usuario desde el backend)
  const r = await apiFetch('/api/v1/layers/workspaces');
  if (!r.ok) throw new Error(`Error capas (${r.status})`);
  const groups = await r.json();
  workspaceGroups = groups;

  // 2. Aplanar y asignar color default (mismo criterio que el geoportal)
  const allLayers = groups.flatMap(g => g.layers);
  allLayers.forEach(layer => {
    if (!layer.color) {
      const palette = getPaletteForType(layer.type);
      layer.color = palette[hashCode(layer.id) % palette.length];
    }
  });
  availableLayers = allLayers;
  setAvailableLayers(availableLayers);

  // 3. Estilos guardados
  const styles = await fetchStyles();
  styles.forEach(s => stylesMap.set(s.layer_name, s));
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------
function renderPanel() {
  const cont = document.getElementById('panel-capas');
  if (!cont) return;
  cont.innerHTML = '';

  // Primer render: despliega el primer grupo para no mostrar un panel vacío
  if (openGroups.size === 0 && workspaceGroups.length) {
    openGroups.add(workspaceGroups[0].name);
  }

  workspaceGroups.forEach(group => {
    const groupKey = group.name;
    const isOpen = openGroups.has(groupKey);

    const groupDiv = document.createElement('div');
    groupDiv.className = 'layer-group';

    const header = document.createElement('div');
    header.className = 'group-header' + (isOpen ? ' open' : '');
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
    layersContainer.className = 'group-layers' + (isOpen ? ' open' : '');
    groupDiv.appendChild(layersContainer);

    header.addEventListener('click', () => {
      const open = !header.classList.contains('open');
      header.classList.toggle('open', open);
      layersContainer.classList.toggle('open', open);
      if (open) openGroups.add(groupKey); else openGroups.delete(groupKey);
    });

    const GEOM_ORDER = { circle: 0, point: 0, line: 1, fill: 2 };
    [...group.layers]
      .sort((a, b) => (GEOM_ORDER[a.type] ?? 99) - (GEOM_ORDER[b.type] ?? 99))
      .forEach(layer => layersContainer.appendChild(buildLayerCard(layer)));

    cont.appendChild(groupDiv);
  });

  actualizarContador();
}

function actualizarContador() {
  const el = document.getElementById('layerCount');
  if (!el) return;
  const n = [...layerToggleState.values()].filter(Boolean).length;
  el.textContent = `${n} ${n === 1 ? 'activa' : 'activas'}`;
}

function buildLayerCard(layer) {
  const style = stylesMap.get(layer.id) ?? null;
  const isActive = layerToggleState.get(layer.id) === true;

  const card = document.createElement('div');
  card.className = 'capa-card layer-item' + (isActive ? ' active' : '');
  card.dataset.layerId = layer.id;

  // Determinar qué controles mostrar
  const t = (layer.type || '').toLowerCase();
  const isFill   = t === 'fill';
  const isLine   = t === 'line';
  const isCircle = t === 'circle' || t === 'point';

  // Colores / valores iniciales
  const fillColor   = style?.fill_color   ?? (isFill ? layer.color : null);
  const strokeColor = style?.stroke_color ?? (isLine ? layer.color : '#333333');
  const opacity     = style?.opacity      ?? (isFill ? 0.5 : 1);
  const lineWidth   = style?.line_width   ?? (isLine ? 2 : 1);
  const minZoom     = style?.min_zoom     ?? 0;
  const maxZoom     = style?.max_zoom     ?? 22;

  const geomClass = isCircle ? 'geom-point' : isLine ? 'geom-line' : 'geom-fill';
  const expanded = expandedLayers.has(layer.id);

  card.innerHTML = `
    <div class="capa-header">
      <span class="layer-icon ${geomClass}" style="--geom-color: ${colorDeIcono(layer, style)};"></span>
      <span class="capa-nombre" title="${layer.name}">${layer.name}</span>
      <button type="button" class="capa-expand${expanded ? ' open' : ''}" data-rol="expand"
              aria-label="Ajustes de estilo" aria-expanded="${expanded}" title="Ajustes de estilo">
        <svg viewBox="0 0 20 20" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8l4 4 4-4"/></svg>
      </button>
      <label class="switch" title="Mostrar en el mapa">
        <input type="checkbox" data-rol="toggle" ${isActive ? 'checked' : ''}>
        <span class="switch-track"></span>
      </label>
    </div>

    <div class="capa-controles"${expanded ? '' : ' hidden'}>
      ${isFill ? `
        <label class="ctrl">
          <span>Color de relleno</span>
          <input type="color" data-rol="fill_color" value="${fillColor ?? '#3388ff'}">
        </label>
        <label class="ctrl">
          <span>Opacidad <b data-out="opacity">${opacity}</b></span>
          <input type="range" min="0" max="1" step="0.05" data-rol="opacity" value="${opacity}">
        </label>
        <label class="ctrl">
          <span>Color de borde</span>
          <input type="color" data-rol="stroke_color" value="${strokeColor ?? '#000000'}">
        </label>
      ` : ''}

      ${isLine ? `
        <label class="ctrl">
          <span>Color de línea</span>
          <input type="color" data-rol="stroke_color" value="${strokeColor ?? '#3388ff'}">
        </label>
        <label class="ctrl">
          <span>Grosor <b data-out="line_width">${lineWidth}</b></span>
          <input type="range" min="0.5" max="20" step="0.5" data-rol="line_width" value="${lineWidth}">
        </label>
      ` : ''}

      ${isCircle ? `
        <label class="ctrl">
          <span>Color de punto</span>
          <input type="color" data-rol="fill_color" value="${fillColor ?? '#3388ff'}">
        </label>
        <label class="ctrl">
          <span>Opacidad <b data-out="opacity">${opacity}</b></span>
          <input type="range" min="0" max="1" step="0.05" data-rol="opacity" value="${opacity}">
        </label>
        <label class="ctrl">
          <span>Grosor borde <b data-out="line_width">${lineWidth}</b></span>
          <input type="range" min="0" max="10" step="0.5" data-rol="line_width" value="${lineWidth}">
        </label>
      ` : ''}

      <div class="ctrl-row">
        <label class="ctrl ctrl-mini">
          <span>Zoom mín.</span>
          <input type="number" min="0" max="24" step="1" data-rol="min_zoom" value="${minZoom}">
        </label>
        <label class="ctrl ctrl-mini">
          <span>Zoom máx.</span>
          <input type="number" min="0" max="24" step="1" data-rol="max_zoom" value="${maxZoom}">
        </label>
      </div>

      <div class="capa-acciones">
        <button type="button" data-rol="save" class="btn-primary">Guardar</button>
        <button type="button" data-rol="reset" class="btn-ghost">Restablecer</button>
      </div>
    </div>
  `;

  // ---------- Listeners ----------
  // Toggle: activar/desactivar capa en el mapa
  const toggle = card.querySelector('[data-rol="toggle"]');
  toggle.addEventListener('change', () => handleToggle(layer, toggle.checked, card));

  // Desplegar / replegar ajustes
  const expandBtn = card.querySelector('[data-rol="expand"]');
  expandBtn.addEventListener('click', () => setExpandido(card, layer.id, card.querySelector('.capa-controles').hidden));

  // Controles: preview en vivo
  card.querySelectorAll('input[data-rol]').forEach(inp => {
    if (inp.dataset.rol === 'toggle') return;
    inp.addEventListener('input', () => {
      actualizarOut(card, inp);
      const patch = leerPatch(card, layer);
      actualizarIcono(card, layer, patch);
      previewEstilo(layer, patch);
    });
  });

  // Guardar
  card.querySelector('[data-rol="save"]').addEventListener('click', async () => {
    try {
      const payload = leerPatch(card, layer);
      const guardado = await saveStyle(layer.id, payload);
      stylesMap.set(layer.id, guardado);
      actualizarIcono(card, layer, guardado);
      flash(card, 'ok', 'Guardado');
    } catch (e) {
      console.error(e);
      flash(card, 'error', `Error al guardar${sufijoError(e)}`);
    }
  });

  // Restablecer
  card.querySelector('[data-rol="reset"]').addEventListener('click', async () => {
    if (!confirm('¿Restablecer estilo por defecto?')) return;
    try {
      await resetStyle(layer.id);
      stylesMap.delete(layer.id);
      renderPanel();
      if (layerToggleState.get(layer.id)) {
        // Aplicar default (layer.color)
        previewEstilo(layer, {
          fill_color: isFill ? layer.color : null,
          stroke_color: isLine ? layer.color : null,
          opacity: isFill ? 0.5 : 1,
          line_width: isLine ? 2 : 1,
          min_zoom: 0,
          max_zoom: 22,
        });
      }
    } catch (e) {
      console.error(e);
      alert('No se pudo restablecer');
    }
  });

  return card;
}

// Color que representa a la capa en el panel: el del estilo guardado/en edición,
// o el color por defecto de la capa.
function colorDeIcono(layer, style) {
  const t = (layer.type || '').toLowerCase();
  const elegido = t === 'line' ? style?.stroke_color : style?.fill_color;
  return elegido || layer.color;
}

function actualizarIcono(card, layer, style) {
  const icono = card.querySelector('.layer-icon');
  if (icono) icono.style.setProperty('--geom-color', colorDeIcono(layer, style));
}

function actualizarOut(card, inp) {
  const out = card.querySelector(`[data-out="${inp.dataset.rol}"]`);
  if (out) out.textContent = inp.value;
}

function leerPatch(card, layer) {
  const get = (rol) => {
    const el = card.querySelector(`input[data-rol="${rol}"]`);
    if (!el) return null;
    if (el.type === 'number' || el.type === 'range') return parseFloat(el.value);
    return el.value;
  };
  return {
    fill_color:   get('fill_color'),
    stroke_color: get('stroke_color'),
    opacity:      get('opacity'),
    line_width:   get('line_width'),
    min_zoom:     get('min_zoom'),
    max_zoom:     get('max_zoom'),
    // Los atributos del popup se editan desde el popup del mapa (clic en un elemento)
    visible_attributes: stylesMap.get(layer.id)?.visible_attributes ?? [],
  };
}

function previewEstilo(layer, patch) {
  if (!layerToggleState.get(layer.id)) return;
  applyStyle(map, `layer-${layer.id}`, layer.type, patch);
}

// Loader sobre el mapa mientras se activa una capa
function mostrarCargando(mostrar) {
  const wrap = document.querySelector('.map-wrap');
  if (!wrap) return;
  let loader = document.getElementById('map-loader');
  if (!loader) {
    loader = document.createElement('div');
    loader.id = 'map-loader';
    loader.className = 'map-loader';
    loader.innerHTML = '<span class="map-loader-spin"></span><span>Cargando datos...</span>';
    wrap.appendChild(loader);
  }
  loader.style.display = mostrar ? 'flex' : 'none';
}

// ---------------------------------------------------------------------------
// Toggle de capa
// ---------------------------------------------------------------------------
function setExpandido(card, layerId, open) {
  const ctrl = card.querySelector('.capa-controles');
  const btn = card.querySelector('[data-rol="expand"]');
  if (!ctrl || !btn) return;
  ctrl.hidden = !open;
  btn.classList.toggle('open', open);
  btn.setAttribute('aria-expanded', String(open));
  if (open) expandedLayers.add(layerId); else expandedLayers.delete(layerId);
}

async function handleToggle(layer, isVisible, card) {
  try {
    if (isVisible) {
      mostrarCargando(true);
      await loadLayerToMap(layer.id, map, availableLayers, () => {});
      layerToggleState.set(layer.id, true);
      card.classList.add('active');
      setExpandido(card, layer.id, true);

      // Aplicar estilo guardado o defaults
      const style = stylesMap.get(layer.id);
      if (style) {
        applyStyle(map, `layer-${layer.id}`, layer.type, style);
      } else {
        const t = (layer.type || '').toLowerCase();
        applyStyle(map, `layer-${layer.id}`, layer.type, {
          fill_color: t === 'fill' ? layer.color : null,
          stroke_color: t === 'line' ? layer.color : null,
          opacity: t === 'fill' ? 0.5 : 1,
          line_width: t === 'line' ? 2 : 1,
        });
      }
      await esperarMapaListo(map);
    } else {
      removeLayerFromMap(layer);
      if (editorLayerId === layer.id) cerrarEditorPopup();
      layerToggleState.set(layer.id, false);
      card.classList.remove('active');
    }
  } catch (e) {
    console.error(e);
    alert(`No se pudo cargar "${layer.name}"`);
    card.querySelector('[data-rol="toggle"]').checked = false;
  } finally {
    mostrarCargando(false);
  }
  actualizarContador();
}

function removeLayerFromMap(layer) {
  const t = (layer.type || '').toLowerCase();
  const sourceId = `source-${layer.id}`;
  const baseId   = `layer-${layer.id}`;

  if (t === 'circle' || t === 'point') {
    [`${baseId}-cluster-count`, `${baseId}-clusters`, `${baseId}-unclustered`].forEach(id => {
      if (map.getLayer(id)) map.removeLayer(id);
    });
  } else {
    if (map.getLayer(baseId)) map.removeLayer(baseId);
  }
  if (map.getSource(sourceId)) map.removeSource(sourceId);
}

// ---------------------------------------------------------------------------
// Editor del popup: clic en un elemento → elegir qué campos se muestran.
// Al aplicar, el cambio vale para todos los popups de ESA capa.
// ---------------------------------------------------------------------------
let editorPopup = null;
let editorLayerId = null;

const esCampoId = (k) => {
  const l = k.toLowerCase();
  return ['id', 'geoid', 'gid', 'objectid'].includes(l) || l.endsWith('_id') || l.startsWith('id_');
};

function cerrarEditorPopup() {
  if (editorPopup) { editorPopup.remove(); editorPopup = null; }
  editorLayerId = null;
}

// Los layers del mapa llaman a window.handleFeatureClick(tableName, props, lngLat)
window.handleFeatureClick = (layerId, props, lngLat) => {
  abrirEditorPopup(layerId, props || {}, lngLat);
};

async function abrirEditorPopup(layerId, props, lngLat) {
  const layer = availableLayers.find(l => l.id === layerId);
  if (!layer) return;

  // Todos los campos de la capa (no solo los del elemento clicado)
  if (!attrsCache.has(layerId)) {
    attrsCache.set(layerId, await fetchLayerAttributes(layerId));
  }
  const campos = [...new Set([...(attrsCache.get(layerId) ?? []), ...Object.keys(props)])];

  // Selección inicial: lo guardado, o el modo por defecto (todo menos ids)
  const guardados = stylesMap.get(layerId)?.visible_attributes ?? [];
  const seleccion = new Set(
    guardados.length ? guardados.filter(k => campos.includes(k)) : campos.filter(k => !esCampoId(k))
  );

  cerrarEditorPopup();

  // ----- Contenido -----
  const root = document.createElement('div');
  root.className = 'fp fp-edit';

  const head = document.createElement('div');
  head.className = 'fp-head';
  head.innerHTML = '<span class="fp-title"></span><span class="fp-sub">Elige los campos que se muestran en el popup</span>';
  head.querySelector('.fp-title').textContent = getLayerDisplayName(layerId);
  root.appendChild(head);

  const tools = document.createElement('div');
  tools.className = 'fp-edit-tools';
  const resumen = document.createElement('span');
  const btnTodos = document.createElement('button');
  btnTodos.type = 'button'; btnTodos.textContent = 'Todos';
  const btnNinguno = document.createElement('button');
  btnNinguno.type = 'button'; btnNinguno.textContent = 'Ninguno';
  tools.append(resumen, btnTodos, btnNinguno);
  root.appendChild(tools);

  const body = document.createElement('div');
  body.className = 'fp-body';
  const checks = [];
  campos.forEach(k => {
    const row = document.createElement('label');
    row.className = 'fp-edit-row';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = seleccion.has(k);
    cb.addEventListener('change', () => {
      if (cb.checked) seleccion.add(k); else seleccion.delete(k);
      refrescar();
    });
    checks.push([k, cb]);

    const txt = document.createElement('div');
    txt.className = 'fp-edit-txt';
    const key = document.createElement('span');
    key.className = 'fp-key';
    key.textContent = k;
    const val = document.createElement('span');
    val.className = 'fp-val';
    const v = props[k];
    val.textContent = (v === null || v === undefined || v === '') ? '—' : String(v);
    txt.append(key, val);

    row.append(cb, txt);
    body.appendChild(row);
  });
  if (!campos.length) body.innerHTML = '<p class="fp-empty">Esta capa no tiene atributos.</p>';
  root.appendChild(body);

  const foot = document.createElement('div');
  foot.className = 'fp-edit-foot';
  const estado = document.createElement('span');
  estado.className = 'fp-edit-status';
  const aplicar = document.createElement('button');
  aplicar.type = 'button';
  aplicar.className = 'btn-primary';
  aplicar.textContent = 'Aplicar a la capa';
  foot.append(estado, aplicar);
  root.appendChild(foot);

  function refrescar() {
    const n = seleccion.size;
    resumen.textContent = `${n} de ${campos.length} visibles`;
    aplicar.disabled = n === 0;
    if (n === 0) { estado.textContent = 'Marca al menos un campo'; estado.className = 'fp-edit-status error'; }
    else if (estado.className.includes('error')) { estado.textContent = ''; estado.className = 'fp-edit-status'; }
  }
  btnTodos.addEventListener('click', () => {
    checks.forEach(([k, cb]) => { cb.checked = true; seleccion.add(k); });
    refrescar();
  });
  btnNinguno.addEventListener('click', () => {
    checks.forEach(([k, cb]) => { cb.checked = false; seleccion.delete(k); });
    refrescar();
  });

  aplicar.addEventListener('click', async () => {
    aplicar.disabled = true;
    aplicar.textContent = 'Guardando…';
    estado.textContent = ''; estado.className = 'fp-edit-status';
    try {
      // Mantiene el resto del estilo guardado (colores, opacidad, zoom…)
      const visible_attributes = campos.filter(k => seleccion.has(k));
      const actual = stylesMap.get(layerId) ?? {};
      const guardado = await saveStyle(layerId, { ...actual, visible_attributes });
      stylesMap.set(layerId, guardado);
      estado.textContent = 'Aplicado a todos los popups de esta capa';
      estado.className = 'fp-edit-status ok';
    } catch (e) {
      console.error(e);
      estado.textContent = `No se pudo guardar${sufijoError(e)}`;
      estado.className = 'fp-edit-status error';
    } finally {
      aplicar.textContent = 'Aplicar a la capa';
      aplicar.disabled = seleccion.size === 0;
    }
  });

  refrescar();

  editorPopup = new Popup({
    closeButton: true,
    closeOnClick: false,
    closeOnMove: false,
    className: 'feature-attr-popup',
    maxWidth: '320px',
    offset: 16,
    anchor: 'bottom',
  })
    .setLngLat(lngLat)
    .setDOMContent(root)
    .addTo(map);
  editorLayerId = layerId;
  editorPopup.on('close', () => { editorPopup = null; editorLayerId = null; });
}

function sufijoError(e) {
  const m = /\((\d{3})\)/.exec(e?.message || '');
  return m ? ` (${m[1]})` : '';
}

// ---------------------------------------------------------------------------
// Feedback visual
// ---------------------------------------------------------------------------
function flash(card, tipo, msg) {
  const el = document.createElement('div');
  el.className = `flash flash-${tipo}`;
  el.textContent = msg;
  card.appendChild(el);
  setTimeout(() => el.remove(), 1500);
}