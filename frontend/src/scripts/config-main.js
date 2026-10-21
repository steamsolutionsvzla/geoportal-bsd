// src/scripts/config-main.js
// Editor de configuración del Geoportal: capas, simbología, popup y metadatos.
import { apiFetch, getPaletteForType, hashCode } from './utils.js';
import { ROL } from './session.js';
import { buildQgisMetadataHtml, initQgisMetadataWidgets } from './metadata-qgis.js';
import { fetchStyles, saveStyle, resetStyle, fetchLayerAttributes } from '../services/styles.js';
import { initMap, addBaseLayers } from './map-config.js';
import { loadLayerToMap, getLayerRawData, addRasterLayerToMap } from './layer-manager.js';
import { applyStyle } from '../lib/mapStyles.js';

const TIPOS = {
  fill: 'Polígono',
  line: 'Línea',
  circle: 'Punto',
  point: 'Punto',
  raster: 'Raster',
};

const CAMPOS_ID = ['id', 'geoid', 'gid', 'objectid'];
const esCampoId = (k) => {
  const l = String(k).toLowerCase();
  return CAMPOS_ID.includes(l) || l.endsWith('_id') || l.startsWith('id_');
};

const DEFAULTS = {
  fill: { fill_color: '#2d5296', stroke_color: '#122b5a', opacity: 0.5, line_width: 1 },
  line: { fill_color: '#2d5296', stroke_color: '#122b5a', opacity: 1, line_width: 2 },
  circle: { fill_color: '#2d5296', stroke_color: '#122b5a', opacity: 1, line_width: 1 },
  raster: { fill_color: '#2d5296', stroke_color: '#122b5a', opacity: 1, line_width: 1 },
};

const state = {
  workspaces: [],
  layers: [],
  abiertos: new Set(),
  stylesMap: new Map(),
  selected: null,
  attrs: new Map(),
  metadata: new Map(),
  form: null,
  visible: new Set(),
  labels: {},
  fieldOrder: [],
  metadataCampos: [],
  dirty: false,
  tab: 'simbologia',
  requestId: 0,
  previewMap: null,
  previewReady: false,
  previewLayerId: null,
  previewToken: 0,
};

const $ = (sel) => document.querySelector(sel);

document.addEventListener('DOMContentLoaded', init);

document.addEventListener('session:ready', (e) => ajustarModulosAdmin(e.detail?.rol));

function ajustarModulosAdmin(rol) {
  if (!rol || rol === ROL.ADMIN) return;
  $('.cfg-nav-modules')?.remove();
}

async function init() {
  if (window.currentUser) ajustarModulosAdmin(window.currentUser.rol);
  bindUI();
  try {
    const [workspaces, styles] = await Promise.all([
      apiFetch('/api/v1/layers/workspaces').then((r) => {
        if (!r.ok) throw new Error(`capas (${r.status})`);
        return r.json();
      }),
      fetchStyles(),
    ]);
    state.workspaces = Array.isArray(workspaces) ? workspaces : [];
    styles.forEach((s) => state.stylesMap.set(s.layer_name, s));
    state.layers = state.workspaces.flatMap((w) =>
      (w.layers || []).map((l) => {
        const layer = { ...l, workspace: w.name };
        if (!layer.color) {
          const palette = getPaletteForType(layer.type);
          layer.color = palette[hashCode(layer.id) % palette.length];
        }
        return layer;
      }),
    );
  } catch (e) {
    console.error(e);
    mostrarAviso(`No se pudieron cargar las capas: ${e.message}`, 'error');
    return;
  }

  renderLista();

  const desdeHash = decodeURIComponent((location.hash || '').replace(/^#/, ''));
  const inicial = state.layers.find((l) => l.id === desdeHash) || state.layers[0];
  if (inicial) seleccionar(inicial.id);
}

// ---------------------------------------------------------------------------
// UI estática
// ---------------------------------------------------------------------------
function bindUI() {
  $('#cfgSearch')?.addEventListener('input', renderLista);

  document.querySelectorAll('.cfg-tab').forEach((btn) => {
    btn.addEventListener('click', () => setTab(btn.dataset.tab));
  });

  $('#cfgSaveBtn')?.addEventListener('click', guardar);
  $('#cfgResetBtn')?.addEventListener('click', restablecer);

  const fill = $('#cfgFill');
  const fillHex = $('#cfgFillHex');
  const stroke = $('#cfgStroke');
  const strokeHex = $('#cfgStrokeHex');

  const sincronizarColor = (colorEl, hexEl, campo) => {
    colorEl?.addEventListener('input', () => {
      state.form[campo] = colorEl.value;
      if (hexEl) hexEl.value = colorEl.value;
      marcarDirty(true);
      renderPreview();
    });
    hexEl?.addEventListener('input', () => {
      const v = normalizarHex(hexEl.value);
      if (!v) return;
      state.form[campo] = v;
      if (colorEl) colorEl.value = v;
      marcarDirty(true);
      renderPreview();
    });
    hexEl?.addEventListener('blur', () => {
      if (!normalizarHex(hexEl.value) && state.form) {
        hexEl.value = state.form[campo] || '#000000';
      }
    });
  };
  sincronizarColor(fill, fillHex, 'fill_color');
  sincronizarColor(stroke, strokeHex, 'stroke_color');

  bindRango('#cfgOpacity', '#cfgOpacityOut', 'opacity', (v) => v.toFixed(2));
  bindRango('#cfgLineWidth', '#cfgLineWidthOut', 'line_width', (v) => `${v} px`);

  $('#cfgMinZoom')?.addEventListener('input', (e) => {
    if (!state.form) return;
    state.form.min_zoom = numero(e.target.value, 0, 24, 0);
    marcarDirty(true);
    renderPreview();
  });
  $('#cfgMaxZoom')?.addEventListener('input', (e) => {
    if (!state.form) return;
    state.form.max_zoom = numero(e.target.value, 0, 24, 24);
    marcarDirty(true);
    renderPreview();
  });

  $('#cfgShowLabels')?.addEventListener('change', (e) => {
    if (!state.form) return;
    state.form.show_labels = e.target.checked;
    mostrarControlesEtiqueta(e.target.checked);
    marcarDirty(true);
  });
  $('#cfgLabelSelectBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const dd = $('#cfgLabelSelect');
    if (!dd) return;
    const btn = e.currentTarget;
    const menu = $('#cfgLabelSelectMenu');
    const abrir = !dd.classList.contains('open');
    cerrarDropdowns();
    if (abrir && menu) {
      // position: fixed — escapa al overflow del contenedor scrollable.
      const rect = btn.getBoundingClientRect();
      const MENU_GAP = 6;
      const espacioAbajo = window.innerHeight - rect.bottom;
      const dropup = espacioAbajo < 240 && rect.top > 240;
      dd.classList.toggle('dropup', dropup);
      menu.style.left = `${rect.left}px`;
      menu.style.width = `${rect.width}px`;
      if (dropup) {
        const h = Math.min(224, rect.top - MENU_GAP - 8);
        menu.style.maxHeight = `${h}px`;
        menu.style.top = 'auto';
        menu.style.bottom = `${window.innerHeight - rect.top + MENU_GAP}px`;
      } else {
        menu.style.maxHeight = '224px';
        menu.style.bottom = 'auto';
        menu.style.top = `${rect.bottom + MENU_GAP}px`;
      }
    }
    dd.classList.toggle('open', abrir);
    btn.setAttribute('aria-expanded', String(abrir));
  });
  sincronizarColor($('#cfgLabelColor'), $('#cfgLabelColorHex'), 'label_color');
  document.addEventListener('click', cerrarDropdowns);

  $('#cfgFieldSearch')?.addEventListener('input', renderCampos);
  $('#cfgAllFields')?.addEventListener('click', () => {
    state.fieldOrder.forEach((k) => state.visible.add(k));
    marcarDirty(true);
    renderCampos();
    renderPreview();
    actualizarStats();
  });
  $('#cfgNoFields')?.addEventListener('click', () => {
    state.visible.clear();
    marcarDirty(true);
    renderCampos();
    renderPreview();
    actualizarStats();
  });

  window.addEventListener('hashchange', () => {
    const id = decodeURIComponent((location.hash || '').replace(/^#/, ''));
    if (id && id !== state.selected?.id) seleccionar(id);
  });

  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      guardar();
    }
  });

  window.addEventListener('beforeunload', (e) => {
    if (!state.dirty) return;
    e.preventDefault();
    e.returnValue = '';
  });
}

function bindRango(sel, outSel, campo, fmt) {
  const el = $(sel);
  const out = $(outSel);
  el?.addEventListener('input', () => {
    if (!state.form) return;
    state.form[campo] = parseFloat(el.value);
    if (out) out.textContent = fmt(state.form[campo]);
    marcarDirty(true);
    renderPreview();
  });
}

function numero(valor, min, max, fallback) {
  const n = parseFloat(valor);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function normalizarHex(valor) {
  const v = String(valor || '').trim();
  if (/^#[0-9a-f]{6}$/i.test(v)) return v.toLowerCase();
  if (/^[0-9a-f]{6}$/i.test(v)) return `#${v.toLowerCase()}`;
  return null;
}

// ---------------------------------------------------------------------------
// Lista de capas
// ---------------------------------------------------------------------------
function renderLista() {
  const cont = $('#cfgLayerList');
  if (!cont) return;

  const q = ($('#cfgSearch')?.value || '').trim().toLowerCase();
  const coincide = (l) =>
    !q || l.name.toLowerCase().includes(q) || l.id.toLowerCase().includes(q);

  const total = state.layers.length;
  const configuradas = state.layers.filter((l) => state.stylesMap.has(l.id)).length;
  const count = $('#cfgLayerCount');
  if (count) count.textContent = `${configuradas}/${total} configuradas`;

  cont.innerHTML = '';
  let visibles = 0;

  state.workspaces.forEach((w) => {
    const capas = (w.layers || [])
      .map((l) => ({ ...l, workspace: w.name }))
      .filter(coincide);
    if (!capas.length) return;
    visibles += capas.length;

    const grupo = document.createElement('div');
    grupo.className = 'cfg-group';
    const abierto = state.abiertos.has(w.name);
    if (abierto) grupo.classList.add('open');

    const titulo = document.createElement('button');
    titulo.type = 'button';
    titulo.className = 'cfg-group-title';
    titulo.setAttribute('aria-expanded', String(abierto));
    titulo.innerHTML = `
      <svg class="cfg-group-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"></polyline></svg>
      <span class="cfg-group-name">${escapeHtml(w.name)}</span>
      <span class="cfg-group-count">${capas.length}</span>
    `;
    grupo.appendChild(titulo);

    const cuerpo = document.createElement('div');
    cuerpo.className = 'cfg-group-body';
    cuerpo.hidden = !abierto;

    titulo.addEventListener('click', () => {
      const expandir = cuerpo.hidden;
      cuerpo.hidden = !expandir;
      titulo.setAttribute('aria-expanded', String(expandir));
      grupo.classList.toggle('open', expandir);
      if (expandir) state.abiertos.add(w.name);
      else state.abiertos.delete(w.name);
    });

    capas.forEach((l) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cfg-layer-btn';
      btn.dataset.layer = l.id;
      if (state.selected?.id === l.id) btn.classList.add('active');

      const configurada = state.stylesMap.has(l.id);
      btn.innerHTML = `
        <span class="cfg-layer-ico cfg-ico-${l.type || 'fill'}">${iconoTipo(l.type)}</span>
        <span class="cfg-layer-txt">
          <span class="cfg-layer-name">${escapeHtml(l.name)}</span>
          <span class="cfg-layer-type">${TIPOS[l.type] || l.type || 'Capa'}</span>
        </span>
        <span class="cfg-layer-dot${configurada ? ' on' : ''}" title="${configurada ? 'Personalizada' : 'Sin configurar'}"></span>
      `;
      btn.addEventListener('click', () => seleccionar(l.id));
      cuerpo.appendChild(btn);
    });

    grupo.appendChild(cuerpo);
    cont.appendChild(grupo);
  });

  if (!visibles) {
    cont.innerHTML = '<p class="cfg-empty-mini">No hay capas que coincidan con la búsqueda.</p>';
  }
}

// ---------------------------------------------------------------------------
// Selección de capa
// ---------------------------------------------------------------------------
async function seleccionar(layerId) {
  const layer = state.layers.find((l) => l.id === layerId);
  if (!layer) return;

  if (state.dirty && !window.confirm('Hay cambios sin guardar. ¿Descartarlos?')) return;

  state.selected = layer;
  state.requestId += 1;
  const req = state.requestId;
  state.dirty = false;
  state.labels = {};
  state.visible = new Set();
  state.fieldOrder = [];
  state.metadataCampos = [];

  history.replaceState(null, '', `#${encodeURIComponent(layerId)}`);
  mostrarEditor(true);
  asegurarPreviewMap();
  renderLista();
  renderHeader();
  renderLoadingState();

  const style = state.stylesMap.get(layer.id);
  state.form = {
    fill_color: style?.fill_color || DEFAULTS[layer.type]?.fill_color || DEFAULTS.fill.fill_color,
    stroke_color: style?.stroke_color || DEFAULTS[layer.type]?.stroke_color || DEFAULTS.fill.stroke_color,
    opacity: style?.opacity ?? DEFAULTS[layer.type]?.opacity ?? 1,
    line_width: style?.line_width ?? DEFAULTS[layer.type]?.line_width ?? 1,
    min_zoom: style?.min_zoom ?? 0,
    max_zoom: style?.max_zoom ?? 24,
    show_labels: style?.show_labels ?? false,
    label_attribute: style?.label_attribute ?? null,
    label_color: style?.label_color ?? '#3b1650',
  };
  state.labels = { ...(style?.attribute_labels || {}) };
  rellenarFormulario();
  actualizarMapaPreview();

  const [attrs, meta] = await Promise.all([
    cargarAtributos(layer.id),
    cargarMetadata(layer.id),
  ]);
  if (req !== state.requestId) return;

  state.metadataCampos = meta?.metadata?.campos || [];
  state.fieldOrder = unicos([...attrs, ...state.metadataCampos.map((c) => c.nombre).filter(Boolean)]);

  // Emparejar campos guardados tolerando diferencias de mayúsculas
  // (PostGIS/GeoServer devuelve minúsculas aunque se guardó MAYÚSCULAS).
  const fieldOrderLower = new Map(state.fieldOrder.map((k) => [k.toLowerCase(), k]));
  const guardados = (style?.visible_attributes || [])
    .map((k) => fieldOrderLower.get(String(k).toLowerCase()) || k)
    .filter((k) => state.fieldOrder.includes(k));
  state.visible = new Set(
    guardados.length ? guardados : state.fieldOrder.filter((k) => !esCampoId(k)),
  );

  renderHeader();
  renderCampos();
  renderMetadata(meta);
  renderPreview();
  actualizarStats();
  rellenarSelectEtiqueta();
  setTab(state.tab);
}

function unicos(arr) {
  return [...new Set(arr.filter(Boolean))];
}

async function cargarAtributos(layerId) {
  if (state.attrs.has(layerId)) return state.attrs.get(layerId);
  const attrs = await fetchLayerAttributes(layerId);
  state.attrs.set(layerId, attrs);
  return attrs;
}

async function cargarMetadata(layerId) {
  if (state.metadata.has(layerId)) return state.metadata.get(layerId);
  try {
    const r = await apiFetch(`/api/v1/layers/${encodeURIComponent(layerId)}/metadata`);
    if (!r.ok) return null;
    const data = await r.json();
    state.metadata.set(layerId, data);
    return data;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Cabecera y estado
// ---------------------------------------------------------------------------
function renderHeader() {
  const layer = state.selected;
  if (!layer) return;

  const configurada = state.stylesMap.has(layer.id);
  $('#cfgLayerTitle').textContent = layer.name || layer.id;
  $('#cfgLayerId').textContent = layer.id;
  $('#cfgWorkspaceBadge').textContent = layer.workspace || '—';
  $('#cfgTypeBadge').textContent = TIPOS[layer.type] || layer.type || 'Capa';
  $('#cfgStatusBadge').textContent = configurada ? 'Personalizada' : 'Sin configurar';
  $('#cfgStatusBadge').classList.toggle('on', configurada);

  const style = state.stylesMap.get(layer.id);
  const auto = $('#cfgUpdatedBy');
  if (auto) {
    auto.textContent = style?.updated_by
      ? `${style.updated_by}${style.updated_at ? ' · ' + formatearFecha(style.updated_at) : ''}`
      : '—';
  }

  const esRaster = layer.type === 'raster';
  $('#cfgRasterNotice').hidden = !esRaster;
  $('#cfgFormFields').classList.toggle('disabled', esRaster);
  $('#cfgFormFields').querySelectorAll('input, button, select').forEach((el) => {
    el.disabled = esRaster;
  });
  $('#cfgSaveBtn').disabled = esRaster;
  $('#cfgResetBtn').disabled = esRaster || !configurada;
  marcarDirty(state.dirty);
}

function renderLoadingState() {
  $('#cfgFields').innerHTML = '<p class="cfg-empty-mini">Cargando atributos…</p>';
  $('#cfgMetadata').innerHTML = '<p class="cfg-empty-mini">Cargando metadatos…</p>';
}

function actualizarStats() {
  const layer = state.selected;
  if (!layer) return;

  const style = state.stylesMap.get(layer.id);
  $('#statCampos').textContent = state.fieldOrder.length;
  $('#statVisibles').textContent = state.visible.size;
  $('#statEstado').textContent = style ? 'Personalizada' : 'Por defecto';
  $('#statEstado').classList.toggle('on', !!style);
  $('#cfgVisibleCount').textContent = `${state.visible.size} de ${state.fieldOrder.length}`;
}

function marcarDirty(dirty) {
  state.dirty = dirty;
  const badge = $('#cfgDirty');
  const btn = $('#cfgSaveBtn');
  if (badge) {
    badge.hidden = !dirty;
    badge.textContent = 'Cambios sin guardar';
  }
  if (btn) {
    const esRaster = state.selected?.type === 'raster';
    btn.disabled = esRaster || !dirty;
  }
  const reset = $('#cfgResetBtn');
  if (reset) {
    reset.disabled = !state.selected || state.selected.type === 'raster' ||
      !state.stylesMap.has(state.selected.id);
  }
}

function mostrarEditor(mostrar) {
  $('#cfgEmpty').hidden = mostrar;
  $('#cfgEditor').hidden = !mostrar;
}

function mostrarAviso(texto, tipo = 'info') {
  const box = $('#cfgNotice');
  if (!box) return;
  box.textContent = texto;
  box.className = `cfg-notice ${tipo}`;
  box.hidden = false;
  clearTimeout(mostrarAviso._t);
  mostrarAviso._t = setTimeout(() => { box.hidden = true; }, 6000);
}

// ---------------------------------------------------------------------------
// Formulario de simbología
// ---------------------------------------------------------------------------
function rellenarFormulario() {
  const f = state.form;
  if (!f) return;

  $('#cfgFill').value = f.fill_color;
  $('#cfgFillHex').value = f.fill_color;
  $('#cfgStroke').value = f.stroke_color;
  $('#cfgStrokeHex').value = f.stroke_color;

  $('#cfgOpacity').value = f.opacity;
  $('#cfgOpacityOut').textContent = Number(f.opacity).toFixed(2);
  $('#cfgLineWidth').value = f.line_width;
  $('#cfgLineWidthOut').textContent = `${f.line_width} px`;
  $('#cfgMinZoom').value = f.min_zoom;
  $('#cfgMaxZoom').value = f.max_zoom;

  const chk = $('#cfgShowLabels');
  if (chk) chk.checked = !!f.show_labels;
  mostrarControlesEtiqueta(!!f.show_labels);
  $('#cfgLabelColor').value = f.label_color || '#3b1650';
  $('#cfgLabelColorHex').value = f.label_color || '#3b1650';
  rellenarSelectEtiqueta();
}

function rellenarSelectEtiqueta() {
  const menu = $('#cfgLabelSelectMenu');
  const label = $('#cfgLabelSelectLabel');
  if (!menu || !label) return;
  const actualGuardado = state.form?.label_attribute ?? '';
  // Normalizar al nombre real del fieldOrder (tolerante a mayúsculas)
  const actual =
    state.fieldOrder.find((k) => k.toLowerCase() === String(actualGuardado).toLowerCase()) ||
    actualGuardado;

  label.textContent = actual || 'Seleccionar atributo…';
  label.classList.toggle('has-value', !!actual);
  menu.innerHTML = '';

  if (!state.fieldOrder.length) {
    menu.innerHTML = '<p class="cfg-select-empty">Sin atributos disponibles.</p>';
    return;
  }

  state.fieldOrder.forEach((k) => {
    const opt = document.createElement('div');
    opt.className = 'cfg-select-option' + (k === actual ? ' selected' : '');
    opt.dataset.value = k;
    opt.setAttribute('role', 'option');
    opt.textContent = k;
    opt.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!state.form) return;
      state.form.label_attribute = k;
      label.textContent = k;
      label.classList.add('has-value');
      menu.querySelectorAll('.cfg-select-option').forEach((o) => {
        o.classList.toggle('selected', o.dataset.value === k);
      });
      cerrarDropdowns();
      marcarDirty(true);
    });
    menu.appendChild(opt);
  });
}

function cerrarDropdowns() {
  document.querySelectorAll('.cfg-select.open').forEach((dd) => {
    dd.classList.remove('open', 'dropup');
    const menu = dd.querySelector('.cfg-select-menu');
    if (menu) {
      menu.style.top = '';
      menu.style.bottom = '';
      menu.style.left = '';
      menu.style.width = '';
      menu.style.maxHeight = '';
    }
    dd.querySelector('.cfg-select-btn')?.setAttribute('aria-expanded', 'false');
  });
}

function mostrarControlesEtiqueta(mostrar) {
  const cont = $('#cfgLabelControls');
  if (cont) cont.hidden = !mostrar;
}

// ---------------------------------------------------------------------------
// Campos del popup
// ---------------------------------------------------------------------------
function renderCampos() {
  const cont = $('#cfgFields');
  if (!cont) return;

  const q = ($('#cfgFieldSearch')?.value || '').trim().toLowerCase();
  const campos = state.fieldOrder.filter((k) => !q || k.toLowerCase().includes(q));

  cont.innerHTML = '';
  if (!state.fieldOrder.length) {
    cont.innerHTML = '<p class="cfg-empty-mini">Esta capa no tiene atributos detectados.</p>';
    return;
  }
  if (!campos.length) {
    cont.innerHTML = '<p class="cfg-empty-mini">Ningún campo coincide con la búsqueda.</p>';
    return;
  }

  campos.forEach((k) => {
    const row = document.createElement('div');
    row.className = 'cfg-field-row';
    if (!state.visible.has(k)) row.classList.add('off');

    const check = document.createElement('label');
    check.className = 'cfg-field-check';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = state.visible.has(k);
    cb.addEventListener('change', () => {
      if (cb.checked) state.visible.add(k); else state.visible.delete(k);
      row.classList.toggle('off', !cb.checked);
      marcarDirty(true);
      renderPreview();
      actualizarStats();
    });

    const nombre = document.createElement('span');
    nombre.className = 'cfg-field-name';
    nombre.textContent = k;
    nombre.title = k;
    check.append(cb, nombre);

    const label = document.createElement('input');
    label.type = 'text';
    label.className = 'cfg-field-label';
    label.maxLength = 120;
    label.placeholder = 'Nombre visible';
    label.value = state.labels[k] || '';
    label.addEventListener('input', () => {
      const t = label.value.trim();
      if (t) state.labels[k] = t; else delete state.labels[k];
      marcarDirty(true);
      renderPreview();
    });

    row.append(check, label);
    cont.appendChild(row);
  });
}

// ---------------------------------------------------------------------------
// Metadatos
// ---------------------------------------------------------------------------
function renderMetadata(meta) {
  const cont = $('#cfgMetadata');
  if (!cont) return;

  if (!meta || !meta.has_metadata || !meta.metadata) {
    cont.innerHTML = `
      <div class="cfg-empty-block">
        <strong>Sin metadatos registrados</strong>
        <p>Esta capa no tiene ficha en el catálogo. Puedes configurar su simbología y su popup igualmente.</p>
      </div>`;
    return;
  }

  cont.innerHTML = buildQgisMetadataHtml(meta.metadata, { variant: 'config' });
  initQgisMetadataWidgets(cont);
}

// ---------------------------------------------------------------------------
// Vista previa
// ---------------------------------------------------------------------------
function renderPreview() {
  const layer = state.selected;
  const f = state.form;
  if (!layer || !f) return;

  aplicarEstiloPreview();
  renderPreviewPopup(layer);
}

function renderPreviewPopup(layer) {
  const cont = $('#cfgPreviewPopup');
  if (!cont) return;

  if (layer.type === 'raster') {
    cont.innerHTML = `
      <div class="cfg-pp">
        <div class="cfg-pp-head">${escapeHtml(layer.name || layer.id)}</div>
        <div class="cfg-pp-body">
          <p class="cfg-empty-mini">El popup de atributos no aplica a capas raster.</p>
        </div>
      </div>`;
    return;
  }

  const campos = state.fieldOrder.filter((k) => state.visible.has(k)).slice(0, 8);
  const filas = campos.map((k) => `
    <div class="cfg-pp-row">
      <span class="cfg-pp-key">${escapeHtml(state.labels[k] || k)}</span>
      <span class="cfg-pp-val">${escapeHtml(valorEjemplo(k))}</span>
    </div>`).join('');

  cont.innerHTML = `
    <div class="cfg-pp">
      <div class="cfg-pp-head">${escapeHtml(layer.name || layer.id)}</div>
      <div class="cfg-pp-body">
        ${filas || '<p class="cfg-empty-mini">Sin atributos visibles.</p>'}
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// Vista previa sobre el mapa
// ---------------------------------------------------------------------------
const PREVIEW_CENTER = [-65.9, 7.5];

function asegurarPreviewMap() {
  const cont = $('#cfgPreviewMap');
  if (!cont) return;

  if (state.previewMap) {
    state.previewMap.resize();
    return;
  }

  try {
    const map = initMap('cfgPreviewMap');
    state.previewMap = map;

    let listo = false;
    const alCargar = () => {
      if (listo) return;
      listo = true;
      try {
        addBaseLayers(map);
      } catch (e) {
        console.error('Vista previa: no se pudieron cargar las capas base:', e);
      }
      state.previewReady = true;
      map.resize();
      actualizarMapaPreview();
    };

    if (map.isStyleLoaded()) alCargar();
    else map.on('load', alCargar);

    // Respaldo: si el evento 'load' nunca llega (estilo bloqueado en el
    // servidor), forzar la inicialización para no quedarse en "Cargando…".
    setTimeout(() => {
      if (!listo) {
        console.warn('Vista previa: "load" no se disparó; forzando inicialización.');
        alCargar();
      }
    }, 5000);

    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(() => map.resize()).observe(cont);
    }
  } catch (e) {
    console.error(e);
    estadoPreview('No se pudo iniciar la vista previa del mapa.');
  }
}

async function actualizarMapaPreview() {
  const map = state.previewMap;
  const layer = state.selected;
  if (!map || !layer || !state.previewReady) return;

  const token = ++state.previewToken;
  limpiarCapaPreview();

  if (layer.type === 'raster') {
    try {
      addRasterLayerToMap(layer, map);
      state.previewLayerId = layer.id;
      map.easeTo({ center: PREVIEW_CENTER, zoom: 6, duration: 0 });
      estadoPreview('');
    } catch (e) {
      console.error(e);
      estadoPreview('No se pudo mostrar el raster en la vista previa.');
    }
    return;
  }

  estadoPreview('Cargando capa…');
  try {
    await loadLayerToMap(layer.id, map, state.layers);
    if (token !== state.previewToken) {
      quitarCapaPreview(layer.id);
      return;
    }
    state.previewLayerId = layer.id;
    ajustarVistaPreview(getLayerRawData(layer.id));
    aplicarEstiloPreview();
    estadoPreview('');
  } catch (e) {
    if (token !== state.previewToken) return;
    console.warn('Vista previa:', e);
    estadoPreview(
      e?.message === 'No features'
        ? 'Esta capa no tiene datos para mostrar en la vista previa.'
        : `No se pudo cargar la vista previa: ${e?.message || e}`,
    );
  }
}

function limpiarCapaPreview() {
  if (!state.previewLayerId) return;
  quitarCapaPreview(state.previewLayerId);
  state.previewLayerId = null;
}

function quitarCapaPreview(layerId) {
  const map = state.previewMap;
  if (!map) return;
  const layerKey = `layer-${layerId}`;
  const sourceKey = `source-${layerId}`;
  try {
    if (map.getLayer(layerKey)) map.removeLayer(layerKey);
    if (map.getSource(sourceKey)) map.removeSource(sourceKey);
  } catch (e) {
    console.warn('No se pudo limpiar la capa de la vista previa:', e);
  }
}

function aplicarEstiloPreview() {
  const map = state.previewMap;
  const layer = state.selected;
  if (!map || !layer || !state.form || layer.type === 'raster') return;
  if (state.previewLayerId !== layer.id) return;
  if (!map.getLayer(`layer-${layer.id}`)) return;

  applyStyle(map, `layer-${layer.id}`, layer.type, {
    ...state.form,
    min_zoom: 0,
    max_zoom: 24,
  });
}

function ajustarVistaPreview(datos) {
  const map = state.previewMap;
  const bbox = bboxDeFeatures(datos?.features);
  if (!map || !bbox) return;

  const [minX, minY, maxX, maxY] = bbox;
  if (minX === maxX && minY === maxY) {
    map.easeTo({ center: [minX, minY], zoom: 11, duration: 0 });
    return;
  }
  map.fitBounds([[minX, minY], [maxX, maxY]], { padding: 32, maxZoom: 11, duration: 0 });
}

function bboxDeFeatures(features) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const visitar = (coords) => {
    if (!Array.isArray(coords)) return;
    if (typeof coords[0] === 'number' && typeof coords[1] === 'number') {
      minX = Math.min(minX, coords[0]);
      minY = Math.min(minY, coords[1]);
      maxX = Math.max(maxX, coords[0]);
      maxY = Math.max(maxY, coords[1]);
      return;
    }
    coords.forEach(visitar);
  };

  (features || []).forEach((f) => visitar(f?.geometry?.coordinates));
  return Number.isFinite(minX) && Number.isFinite(minY) ? [minX, minY, maxX, maxY] : null;
}

function estadoPreview(texto) {
  const el = $('#cfgPreviewState');
  if (!el) return;
  el.textContent = texto || '';
  el.hidden = !texto;
}

function valorEjemplo(campo) {
  const c = state.metadataCampos.find((x) => x.nombre === campo);
  if (c?.ejemplo != null && c.ejemplo !== '') return String(c.ejemplo);
  const tipo = String(c?.tipo || '').toLowerCase();
  if (tipo.includes('int') || tipo.includes('num') || tipo.includes('double')) return '123';
  if (tipo.includes('bool')) return 'Sí';
  if (tipo.includes('fecha') || tipo.includes('date')) return '2026-01-01';
  return '—';
}

// ---------------------------------------------------------------------------
// Guardar / restablecer
// ---------------------------------------------------------------------------
async function guardar() {
  const layer = state.selected;
  if (!layer || layer.type === 'raster' || !state.form) return;
  if (!state.dirty) return;
  if (Number(state.form.min_zoom) > Number(state.form.max_zoom)) {
    mostrarAviso('El zoom mínimo no puede ser mayor que el zoom máximo.', 'error');
    return;
  }

  const btn = $('#cfgSaveBtn');
  const estado = $('#cfgSaveState');
  btn.disabled = true;
  if (estado) { estado.textContent = 'Guardando…'; estado.className = 'cfg-save-state'; }

  const payload = {
    ...state.form,
    visible_attributes: state.fieldOrder.filter((k) => state.visible.has(k)),
    attribute_labels: { ...state.labels },
  };

  try {
    const guardado = await saveStyle(layer.id, payload);
    state.stylesMap.set(layer.id, guardado);
    marcarDirty(false);
    renderLista();
    renderHeader();
    actualizarStats();
    if (estado) { estado.textContent = 'Cambios guardados'; estado.className = 'cfg-save-state ok'; }
    mostrarAviso('Configuración guardada. Se aplicará al recargar el Geoportal.', 'ok');
    clearTimeout(guardar._t);
    guardar._t = setTimeout(() => { if (estado) estado.textContent = ''; }, 4000);
  } catch (e) {
    console.error(e);
    if (estado) { estado.textContent = 'No se pudo guardar'; estado.className = 'cfg-save-state error'; }
    mostrarAviso(`No se pudo guardar: ${e.message}`, 'error');
  } finally {
    marcarDirty(state.dirty);
  }
}

async function restablecer() {
  const layer = state.selected;
  if (!layer || layer.type === 'raster') return;
  if (!window.confirm(`¿Restablecer la configuración de "${layer.name}"?`)) return;

  const btn = $('#cfgResetBtn');
  btn.disabled = true;
  try {
    await resetStyle(layer.id);
    state.stylesMap.delete(layer.id);
    state.labels = {};
    state.form = {
      ...DEFAULTS[layer.type] || DEFAULTS.fill,
      min_zoom: 0, max_zoom: 24,
      show_labels: false, label_attribute: null, label_color: '#3b1650',
    };
    state.visible = new Set(state.fieldOrder.filter((k) => !esCampoId(k)));
    state.dirty = false;
    rellenarFormulario();
    renderCampos();
    renderLista();
    renderHeader();
    renderPreview();
    actualizarStats();
    mostrarAviso('Configuración restablecida a los valores por defecto.', 'ok');
  } catch (e) {
    console.error(e);
    mostrarAviso(`No se pudo restablecer: ${e.message}`, 'error');
  } finally {
    marcarDirty(false);
  }
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------
function setTab(tab) {
  state.tab = tab || 'simbologia';
  document.querySelectorAll('.cfg-tab').forEach((btn) => {
    const on = btn.dataset.tab === state.tab;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-selected', String(on));
  });
  document.querySelectorAll('.cfg-panel').forEach((panel) => {
    panel.hidden = panel.dataset.panel !== state.tab;
  });
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------
function formatearFecha(iso) {
  try {
    return new Date(iso).toLocaleString('es-VE', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function iconoTipo(tipo) {
  switch (tipo) {
    case 'line':
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polyline points="3 17 9 7 15 14 21 5"/></svg>';
    case 'circle':
    case 'point':
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="6"/></svg>';
    case 'raster':
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 3v18"/></svg>';
    default:
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polygon points="12 3 21 8 18 20 6 20 3 8"/></svg>';
  }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}
