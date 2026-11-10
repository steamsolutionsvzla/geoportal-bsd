// loc-search.js
// Buscador de ubicación en la topbar.
// - Estado / bloque → lista las capas con datos en esa zona (en el dropdown).
// - Coordenadas      → zona circular (Punto / 15 / 50 km) con las capas.
// - Capa             → la enciende en el catálogo y ajusta el mapa a ella.
import * as turf from '@turf/turf';
import { getMap } from './map-config.js';
import { getEstadosCache, getBloquesCache } from './filters.js';
import { getAvailableLayers, getLayerRawData } from './layer-manager.js';
import { obtenerNombreEstado, obtenerNombreBloque } from './utils.js';
import {
  parseCoordenadas, geometriaDeZona, dibujarZona, limpiarZona,
  consultarZona, capaActiva, activarCapaEnCatalogo, alternarCapaEnCatalogo,
} from './zone-scan.js';
import { beginBusy, endBusy } from './busy-overlay.js';

const MAX_PER_GROUP = 8;
const RADIOS = [
  { km: 0, label: 'Punto' },
  { km: 15, label: '15 km' },
  { km: 50, label: '50 km' },
];

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

const GEOM_LABEL = {
  circle: 'punto', point: 'punto', fill: 'polígono',
  line: 'línea', raster: 'ráster',
};

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

  // Coordenadas → zona circular.
  const coords = parseCoordenadas(texto);
  if (coords) {
    pushGrupo('Coordenadas', [{
      kind: 'coords',
      nombre: `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`,
      lat: coords.lat,
      lng: coords.lng,
    }], 'pin');
  }

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
      : it.kind === 'coords' ? '<span class="lsd-sub">zona</span>' : '';
    return `<div class="lsd-item" role="option" data-idx="${idx}">
      ${icono}<span class="lsd-name">${marcarCoincidencia(it.nombre, query)}</span>${sub}
    </div>`;
  }).join('');
}

// ------------------------------------------------------------------
// Modo zona (estado / bloque / coordenadas)
// ------------------------------------------------------------------
let zona = null;
let zonaToken = 0;

function renderZona(dropdown) {
  if (!zona) return;
  const colores = new Map(getAvailableLayers().map((l) => [l.id, l.color]));
  const capas = zona.capas || [];

  const chips = zona.tipo === 'coords'
    ? `<div class="lsd-radius">${RADIOS.map((r) =>
        `<button type="button" class="ls-chip${r.km === zona.radioKm ? ' active' : ''}" data-km="${r.km}">${r.label}</button>`,
      ).join('')}</div>`
    : '';

  let cuerpo;
  if (zona.cargando) {
    cuerpo = '<div class="loc-search-empty">Buscando capas en la zona…</div>';
  } else if (zona.error) {
    cuerpo = `<div class="loc-search-empty">No se pudo analizar la zona: ${escHtml(zona.error)}</div>`;
  } else if (!capas.length) {
    cuerpo = '<div class="loc-search-empty">Sin capas con datos en esta zona.</div>';
  } else {
    cuerpo = capas.map((c) => {
      const activa = capaActiva(c.id);
      return `<div class="lsd-item lsd-zone-item${activa ? ' is-active' : ''}" data-table="${escHtml(c.id)}" role="button" aria-pressed="${activa ? 'true' : 'false'}" title="Clic para ${activa ? 'apagar' : 'encender'} la capa">
        <span class="lsd-dot" style="--c:${escHtml(colores.get(c.id) || '#6fa3e0')}"></span>
        <span class="lsd-name">${escHtml(c.name)}</span>
        <span class="lsd-sub">${GEOM_LABEL[String(c.type).toLowerCase()] || ''}</span>
        <span class="lsd-count">${Number(c.count).toLocaleString('es')}</span>
        <span class="lsd-check">${activa ? '✓' : '○'}</span>
      </div>`;
    }).join('');
  }

  const todas = capas.length > 0 && capas.every((c) => capaActiva(c.id));
  dropdown.innerHTML = `
    <div class="lsd-head">
      <button type="button" class="lsd-cancel" data-acc="cancelar" title="Cerrar la zona" aria-label="Cancelar zona">Cancelar</button>
      <span class="lsd-head-title" title="Capas con datos en la zona">Capas en «${escHtml(zona.titulo)}»</span>
      <button type="button" class="lsd-activate-all" data-acc="todas" ${(!capas.length) ? 'disabled' : ''}>${todas ? 'Desactivar todas' : 'Activar todas'}</button>
    </div>
    <p class="lsd-zone-hint">La zona permanece activa hasta pulsar Cancelar.</p>
    ${chips}
    ${cuerpo}`;
}

async function consultarZonaActual(dropdown) {
  if (!zona) return;
  const token = ++zonaToken;
  zona.cargando = true;
  zona.error = null;
  renderZona(dropdown);

  beginBusy('Buscando capas en la zona…');
  try {
    const data = await consultarZona(zona.geometry);
    if (token !== zonaToken || !zona) return;
    zona.capas = data?.layers || [];
    zona.cargando = false;
    renderZona(dropdown);
  } catch (e) {
    if (token !== zonaToken || !zona) return;
    zona.cargando = false;
    zona.error = String(e.message || e);
    renderZona(dropdown);
  } finally {
    // Siempre liberar el busy, aunque la respuesta sea obsoleta.
    endBusy();
  }
}

function abrirModoZona(cfg, dropdown) {
  const map = getMap();
  const input = document.getElementById('locSearch');
  dropdown.closest('.loc-search')?.classList.add('open');
  if (input) {
    input.readOnly = true;
    input.blur();
  }
  zona = {
    tipo: cfg.tipo,
    titulo: cfg.titulo,
    lat: cfg.lat ?? null,
    lng: cfg.lng ?? null,
    radioKm: cfg.radioKm ?? 15,
    capas: [],
    cargando: true,
    error: null,
    geometry: null,
  };

  if (cfg.tipo === 'coords' && map) {
    zona.geometry = geometriaDeZona(zona.lat, zona.lng, zona.radioKm);
    dibujarZona(zona.geometry, [zona.lng, zona.lat]);
  } else {
    zona.geometry = cfg.geometry;
    limpiarZona();
  }

  consultarZonaActual(dropdown);
}

/**
 * Cierra el modo zona sin tocar el encendido/apagado de las capas.
 * Solo se invoca desde el botón Cancelar o con Escape.
 */
function cancelarZona(dropdown) {
  const input = document.getElementById('locSearch');
  zona = null;
  zonaToken++;
  limpiarZona();
  dropdown.innerHTML = '';
  dropdown.closest('.loc-search')?.classList.remove('open');
  if (input) {
    input.readOnly = false;
    input.value = '';
    input.blur();
  }
}

// ------------------------------------------------------------------
// Capa: encenderla y volar a su extensión
// ------------------------------------------------------------------
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

  activarCapaEnCatalogo(table);

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
    if (zona) {
      zona = null;
      zonaToken++;
      limpiarZona();
    }
  };

  const opciones = () => Array.from(dropdown.querySelectorAll('.lsd-item:not(.lsd-zone-item)'));

  const pintarActivo = () => {
    const els = opciones();
    // activo indexa `items` (que incluye las filas de grupo); las opciones
    // del DOM solo son los resultados: convertir el índice.
    const pos = activo < 0 ? -1
      : items.slice(0, activo + 1).filter((x) => x.tipo === 'item').length - 1;
    els.forEach((el, i) => el.classList.toggle('kb-active', i === pos));
    if (pos >= 0) els[pos]?.scrollIntoView({ block: 'nearest' });
  };

  function refrescar(dd = dropdown) {
    // En modo zona la lista es persistente: un debounce pendiente del input
    // no debe borrar los resultados.
    if (zona) return;
    const q = input.value.trim();
    zona = null;
    zonaToken++;
    if (!q) { cerrar(); dd.innerHTML = ''; return; }
    items = buscar(q);
    render(items, dd, q);
    activo = -1;
    wrap.classList.add('open');
    const first = opciones();
    if (first.length) { activo = items.findIndex((x) => x.tipo === 'item'); pintarActivo(); }
  }

  const seleccionar = (idx) => {
    const it = items[idx];
    if (!it || it.tipo === 'grupo') return;

    if (it.kind === 'estado' || it.kind === 'bloque') {
      const esEstado = it.kind === 'estado';
      const cache = esEstado ? getEstadosCache() : getBloquesCache();
      const getter = esEstado ? obtenerNombreEstado : obtenerNombreBloque;
      const feature = (cache?.features || []).find((f) => {
        const n = getter(f.properties);
        return n && norm(n) === norm(it.nombre);
      });
      if (feature) abrirModoZona({ tipo: it.kind, titulo: it.nombre, geometry: feature.geometry }, dropdown);
      return;
    }

    if (it.kind === 'coords') {
      abrirModoZona({ tipo: 'coords', titulo: `${it.lat}, ${it.lng}`, lat: it.lat, lng: it.lng }, dropdown);
      return;
    }

    if (it.kind === 'capa') {
      cerrar();
      seleccionarCapa(it.table);
      input.blur();
    }
  };

  input.addEventListener('input', () => {
    // En modo zona el input está bloqueado: la lista se mantiene hasta Cancelar.
    if (zona) return;
    clearTimeout(debounce);
    debounce = setTimeout(() => refrescar(), 120);
  });
  input.addEventListener('focus', () => {
    // El busy overlay devuelve el foco al input al terminar una consulta;
    // en modo zona no debe reiniciar la búsqueda.
    if (zona) return;
    if (input.value.trim()) refrescar();
  });
  input.addEventListener('keydown', (e) => {
    if (zona) {
      if (e.key === 'Escape') {
        e.preventDefault();
        cancelarZona(dropdown);
      }
      return;
    }
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
    // Controles del modo zona
    const acc = e.target.closest('[data-acc]');
    if (acc) {
      const accion = acc.getAttribute('data-acc');
      if (accion === 'cancelar') cancelarZona(dropdown);
      else if (accion === 'todas' && zona) {
        const capas = zona.capas || [];
        const todas = capas.length > 0 && capas.every((c) => capaActiva(c.id));
        capas.forEach((c) => {
          if (todas) {
            if (capaActiva(c.id)) alternarCapaEnCatalogo(c.id);
          } else if (!capaActiva(c.id)) {
            activarCapaEnCatalogo(c.id);
          }
        });
        renderZona(dropdown);
      }
      return;
    }
    const chip = e.target.closest('.ls-chip[data-km]');
    if (chip && zona && zona.tipo === 'coords') {
      zona.radioKm = Number(chip.dataset.km) || 0;
      zona.geometry = geometriaDeZona(zona.lat, zona.lng, zona.radioKm);
      dibujarZona(zona.geometry, [zona.lng, zona.lat]);
      consultarZonaActual(dropdown);
      return;
    }
    const fila = e.target.closest('.lsd-zone-item[data-table]');
    if (fila && zona) {
      alternarCapaEnCatalogo(fila.dataset.table);
      renderZona(dropdown);
      return;
    }
    // Resultados de búsqueda normales
    const el = e.target.closest('.lsd-item[data-idx]');
    if (el) seleccionar(Number(el.dataset.idx));
  });

  // Cierre al clicar fuera. Se usa pointerdown (no click) porque los clics
  // programáticos del catálogo (activar capas) burbujean un click a document
  // que cerraba el buscador sin ser una interacción real del usuario.
  document.addEventListener('pointerdown', (e) => {
    if (!e.target.isConnected) return;
    // En modo zona el panel es persistente: mover el mapa o interactuar con
    // las capas no lo cierra. Solo Cancelar o Escape salen del modo zona.
    if (zona) return;
    if (!wrap.contains(e.target)) cerrar();
  });

  document.addEventListener('keydown', (e) => {
    if (zona && e.key === 'Escape') {
      e.preventDefault();
      cancelarZona(dropdown);
    }
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
