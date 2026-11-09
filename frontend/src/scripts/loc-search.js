// loc-search.js
// Buscador de ubicación en la topbar: estados, bloques y capas.
// Reutiliza los mismos handlers de los dropdowns de filtro (clic en la
// .loc-option) para que la UI y el resaltado queden exactamente igual que
// si el usuario hubiera filtrado a mano.
import * as turf from '@turf/turf';
import { getMap } from './map-config.js';
import { getEstadosCache, getBloquesCache } from './filters.js';
import { getAvailableLayers, getLayerRawData } from './layer-manager.js';
import { obtenerNombreEstado, obtenerNombreBloque } from './utils.js';

const MAX_PER_GROUP = 8;

// Plegado de acentos/minúsculas (igual que utils.normalizarNombreEstado).
function norm(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Resalta la coincidencia dentro del nombre (mismo <mark> que el buscador de capas).
function marcarCoincidencia(nombre, q) {
  const n = String(nombre ?? '');
  const i = norm(n).indexOf(norm(q));
  if (i < 0) return escHtml(n);
  return `${escHtml(n.slice(0, i))}<mark>${escHtml(n.slice(i, i + q.length))}</mark>${escHtml(n.slice(i + q.length))}`;
}

// ------------------------------------------------------------------
// Recolección de resultados
// ------------------------------------------------------------------
function dedupNombres(cache, getter) {
  const set = new Set();
  (cache?.features ?? []).forEach((f) => {
    const nombre = getter(f.properties);
    if (nombre) set.add(nombre);
  });
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'es'));
}

function buscar(texto) {
  const q = norm(texto);
  if (!q) return [];
  const resultados = [];

  const pushGrupo = (titulo, items, icono) => {
    if (!items.length) return;
    resultados.push({ tipo: 'grupo', titulo, icono });
    items.forEach((it) => resultados.push({ tipo: 'item', ...it }));
  };

  // Estados (solo si el filtro existe en esta página)
  if (document.getElementById('dropdownEstado')) {
    const estados = dedupNombres(getEstadosCache(), obtenerNombreEstado)
      .filter((n) => norm(n).includes(q))
      .slice(0, MAX_PER_GROUP)
      .map((n) => ({ kind: 'estado', nombre: n }));
    pushGrupo('Estados', estados, 'pin');
  }

  // Bloques (el analista oculta este filtro; respetar su visibilidad)
  const filterBloque = document.getElementById('filterBloque');
  if (filterBloque && !filterBloque.hidden) {
    const bloques = dedupNombres(getBloquesCache(), obtenerNombreBloque)
      .filter((n) => norm(n).includes(q))
      .slice(0, MAX_PER_GROUP)
      .map((n) => ({ kind: 'bloque', nombre: n }));
    pushGrupo('Bloques', bloques, 'pin');
  }

  // Capas
  const capas = getAvailableLayers()
    .filter((l) => norm(l.name).includes(q) || norm(l.id).includes(q))
    .slice(0, MAX_PER_GROUP)
    .map((l) => ({ kind: 'capa', nombre: l.name, table: l.id, geom: l.type }));
  pushGrupo('Capas', capas, 'layers');

  return resultados;
}

// ------------------------------------------------------------------
// Render del dropdown de resultados
// ------------------------------------------------------------------
const ICON_PIN = '<svg class="lsd-icon" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-7.2-7-12a7 7 0 0 1 14 0c0 4.8-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/></svg>';
const ICON_LAYERS = '<svg class="lsd-icon" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>';

const GEOM_LABEL = {
  circle: 'punto', point: 'punto', fill: 'polígono',
  line: 'línea', raster: 'ráster',
};

function render(items, dropdown, query) {
  if (!items.length) {
    dropdown.innerHTML = `<div class="loc-search-empty">Sin resultados para “${escHtml(query)}”.</div>`;
    return;
  }
  dropdown.innerHTML = items.map((it, idx) => {
    if (it.tipo === 'grupo') {
      return `<div class="lsd-group"><span>${escHtml(it.titulo)}</span></div>`;
    }
    const icono = it.kind === 'capa' ? ICON_LAYERS : ICON_PIN;
    const sub = it.kind === 'capa'
      ? `<span class="lsd-sub">${GEOM_LABEL[String(it.geom).toLowerCase()] || ''}</span>`
      : '';
    return `<div class="lsd-item" role="option" data-idx="${idx}">
      ${icono}<span class="lsd-name">${marcarCoincidencia(it.nombre, query)}</span>${sub}
    </div>`;
  }).join('');
}

// ------------------------------------------------------------------
// Selección de resultados
// ------------------------------------------------------------------
function clickOptionLoc(dropdownId, nombre) {
  const dropdown = document.getElementById(dropdownId);
  if (!dropdown) return;
  const opt = Array.from(dropdown.querySelectorAll('.loc-option'))
    .find((o) => norm(o.getAttribute('data-value') || o.textContent) === norm(nombre));
  if (opt) opt.click();
}

function esperarDatosCapa(tableName, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const tick = () => {
      const data = getLayerRawData(tableName);
      if (data) { resolve(data); return; }
      if (Date.now() - t0 > timeoutMs) { resolve(null); return; }
      setTimeout(tick, 200);
    };
    tick();
  });
}

async function seleccionarCapa(table) {
  const map = getMap();
  if (!map) return;

  // Si el buscador lateral tiene un filtro activo, limpiarlo para que la
  // fila sea visible (su handler escucha 'input' con debounce).
  const ls = document.getElementById('layerSearch');
  if (ls && ls.value) {
    ls.value = '';
    ls.dispatchEvent(new Event('input', { bubbles: true }));
  }

  const item = document.querySelector(`#layersGroupsContainer .layer-item[data-table="${CSS.escape(table)}"]`);
  if (!item) return;

  // Abrir el grupo si está colapsado.
  const group = item.closest('.layer-group');
  const list = group?.querySelector('.group-layers');
  if (group && list && !list.classList.contains('open')) {
    group.querySelector('.group-header')?.click();
  }

  // Encender la capa si está apagada (mismo camino que el clic manual).
  const toggle = item.querySelector('.toggle');
  const yaActiva = toggle?.classList.contains('on');
  if (toggle && !yaActiva) toggle.click();

  item.classList.remove('ls-flash');
  void item.offsetWidth;              // reiniciar la animación
  item.classList.add('ls-flash');
  setTimeout(() => item.classList.remove('ls-flash'), 1800);
  item.scrollIntoView({ block: 'center', behavior: 'smooth' });

  if (String(item.getAttribute('data-geom')).toLowerCase() === 'raster') return;

  const data = await esperarDatosCapa(table);
  if (!data?.features?.length) return;
  try {
    const bbox = turf.bbox(turf.featureCollection(data.features));
    map.fitBounds(bbox, { padding: 70, maxZoom: 11, duration: 1200 });
  } catch (_) { /* geometría rara: no ajustar */ }
}

// ------------------------------------------------------------------
// Inicialización (solo si la página trae #locSearch)
// ------------------------------------------------------------------
export function initLocationSearch() {
  const input = document.getElementById('locSearch');
  const dropdown = document.getElementById('locSearchDropdown');
  const wrap = input?.closest('.loc-search');
  if (!input || !dropdown || !wrap) return;

  let items = [];
  let activo = -1;
  let debounce = null;

  const cerrar = () => {
    wrap.classList.remove('open');
    activo = -1;
  };

  const opciones = () => Array.from(dropdown.querySelectorAll('.lsd-item'));

  const pintarActivo = () => {
    const els = opciones();
    // activo indexa `items` (que incluye las filas de grupo); las opciones
    // del DOM solo son los resultados: convertir el índice.
    const pos = activo < 0 ? -1
      : items.slice(0, activo + 1).filter((x) => x.tipo === 'item').length - 1;
    els.forEach((el, i) => el.classList.toggle('kb-active', i === pos));
    if (pos >= 0) els[pos]?.scrollIntoView({ block: 'nearest' });
  };

  const seleccionar = (idx) => {
    const it = items[idx];
    if (!it || it.tipo === 'grupo') return;
    cerrar();
    if (it.kind === 'estado') {
      clickOptionLoc('dropdownEstado', it.nombre);
    } else if (it.kind === 'bloque') {
      clickOptionLoc('dropdownBloque', it.nombre);
    } else if (it.kind === 'capa') {
      seleccionarCapa(it.table);
    }
    input.blur();
  };

  const refrescar = () => {
    const q = input.value.trim();
    if (!q) { cerrar(); dropdown.innerHTML = ''; return; }
    items = buscar(q);
    render(items, dropdown, q);
    activo = -1;
    wrap.classList.add('open');
    // Primer item como activo para Enter rápido.
    const first = opciones();
    if (first.length) { activo = items.findIndex((x) => x.tipo === 'item'); pintarActivo(); }
  };

  input.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(refrescar, 120);
  });
  input.addEventListener('focus', () => { if (input.value.trim()) refrescar(); });
  input.addEventListener('keydown', (e) => {
    const nItems = items.filter((x) => x.tipo === 'item').length;
    if (!nItems) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      do { activo = (activo + 1) % items.length; } while (items[activo]?.tipo === 'grupo');
      pintarActivo();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      do { activo = (activo - 1 + items.length) % items.length; } while (items[activo]?.tipo === 'grupo');
      pintarActivo();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activo >= 0) seleccionar(activo);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cerrar();
      input.blur();
    }
  });
  dropdown.addEventListener('click', (e) => {
    const el = e.target.closest('.lsd-item');
    if (!el) return;
    seleccionar(Number(el.dataset.idx));
  });
  document.addEventListener('click', (e) => {
    if (!wrap.contains(e.target)) cerrar();
  });

  // Ctrl+K / Cmd+K: enfoca el buscador de ubicación (el '/' sigue
  // reservado para el buscador de capas del sidebar).
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      input.focus();
      input.select();
    }
  });
}
