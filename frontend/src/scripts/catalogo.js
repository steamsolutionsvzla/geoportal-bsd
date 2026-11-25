// scripts/catalogo.js
// Catálogo de datos: diccionario de campos de los esquemas PostGIS gis_*.
import { apiFetch } from './utils.js';

const state = {
  data: null,
  query: '',
  schema: '',
  onlyUndocumented: false,
  collapsed: new Set(),
  loading: false,
};

const PALETTE = ['#2d5296', '#0f766e', '#b45309', '#7c3aed', '#c1584a', '#0369a1', '#4d7c0f'];

const $ = (id) => document.getElementById(id);
const listEl = $('cat-list');
const emptyEl = $('cat-empty');
const statusEl = $('cat-status');
const errorEl = $('cat-error');
const errorTextEl = $('cat-error-text');
const refreshBtn = $('cat-refresh');
const exportBtn = $('cat-export');
const qInput = $('cat-q');
const schemaSelect = $('cat-schema');
const undocInput = $('cat-undoc');
const toggleAllBtn = $('cat-toggle-all');

const nf = new Intl.NumberFormat('es-VE');
const fmt = (n) => (n === null || n === undefined ? '—' : nf.format(n));

const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));

function schemaColor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) % 100000;
  }
  return PALETTE[hash % PALETTE.length];
}

function docBadge(documented, total) {
  if (!total) return 'doc-none';
  if (documented === total) return 'doc-ok';
  if (documented === 0) return 'doc-none';
  return 'doc-low';
}

function clock(iso) {
  try {
    return new Date(iso).toLocaleTimeString('es-VE', {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

/* ------------------------------------------------------------------ */
/* KPIs                                                                */
/* ------------------------------------------------------------------ */
function renderKpis() {
  const t = state.data?.totals;
  if (!t) return;
  const pct = t.fields ? Math.round((t.fields_documented / t.fields) * 100) : 0;

  $('kpi-schemas').textContent = fmt(t.schemas);
  $('kpi-layers').textContent = fmt(t.layers);
  $('kpi-fields').textContent = fmt(t.fields);
  $('kpi-documented').textContent = fmt(t.fields_documented);
  $('kpi-documented-hint').textContent = `${pct}% del total`;
  $('kpi-undocumented').textContent = fmt(t.fields_undocumented);

  document.querySelectorAll('.cat-kpi-value').forEach((el) => el.classList.remove('is-muted'));
}

/* ------------------------------------------------------------------ */
/* Filtros                                                             */
/* ------------------------------------------------------------------ */
function fillSchemaSelect() {
  const schemas = (state.data?.schemas || []).map((s) => s.name);
  schemaSelect.innerHTML =
    '<option value="">Todos los esquemas</option>' +
    schemas.map((name) => `<option value="${esc(name)}">${esc(name)}</option>`).join('');
  schemaSelect.value = state.schema;
}

function haystack(layer) {
  return [
    layer.title,
    layer.table,
    layer.schema,
    layer.abstract,
    layer.keywords,
    layer.license,
    layer.comment,
  ]
    .join(' ')
    .toLowerCase();
}

function fieldHaystack(field) {
  return [field.name, field.type, field.doc_type, field.doc_example, field.comment]
    .join(' ')
    .toLowerCase();
}

function filteredSchemas() {
  const q = state.query.trim().toLowerCase();
  const filtering = Boolean(q || state.onlyUndocumented);

  return (state.data?.schemas || [])
    .filter((schema) => !state.schema || schema.name === state.schema)
    .map((schema) => {
      const layers = [];
      for (const layer of schema.layers) {
        const layerMatches = !q || haystack(layer).includes(q);
        let fields = layer.fields;

        if (state.onlyUndocumented) {
          fields = fields.filter((field) => !field.documented);
        }
        if (q && !layerMatches) {
          fields = fields.filter((field) => fieldHaystack(field).includes(q));
        }
        if (!fields.length) continue;
        layers.push({ ...layer, fields });
      }
      // Los esquemas sin capas espaciales (p. ej. solo rasters) se muestran
      // como constancia de que también se han analizado, salvo al filtrar.
      const keepEmpty = !filtering && layers.length === 0;
      return { ...schema, layers, empty: keepEmpty };
    })
    .filter((schema) => schema.layers.length || schema.empty);
}

/* ------------------------------------------------------------------ */
/* Tabla                                                               */
/* ------------------------------------------------------------------ */
function fieldRow(field) {
  const length = field.length ?? '—';
  const precision = field.precision ?? '—';
  const example = field.doc_example || field.comment || '';
  const role =
    field.role === 'geometry' ? 'geometría' : field.role === 'id' ? 'clave' : 'atributo';
  const roleClass = field.role === 'geometry' || field.role === 'id' ? field.role : '';

  return `
    <tr>
      <td data-label="Campo">
        <span class="cat-field">
          <span class="cat-field-name">${esc(field.name)}</span>
          <span class="cat-role ${roleClass}">${role}</span>
        </span>
        ${field.comment ? `<span class="cat-field-comment">${esc(field.comment)}</span>` : ''}
      </td>
      <td data-label="Tipo"><span class="cat-type">${esc(field.type || '—')}</span></td>
      <td class="num" data-label="Longitud">${esc(length)}</td>
      <td class="num" data-label="Precisión">${esc(precision)}</td>
      <td data-label="Nulos">
        <span class="cat-flag neutral">
          <span class="cat-dot"></span>${field.nullable ? 'sí' : 'no'}
        </span>
      </td>
      <td data-label="Únicos">
        <span class="cat-flag neutral ${field.doc_uniques === null || field.doc_uniques === undefined ? 'is-empty' : ''}">
          <span class="cat-dot"></span>${field.doc_uniques === null || field.doc_uniques === undefined ? '—' : field.doc_uniques ? 'sí' : 'no'}
        </span>
      </td>
      <td data-label="Documentado">
        <span class="cat-flag ${field.documented ? 'yes' : 'no'}">
          <span class="cat-dot"></span>${field.documented ? 'Sí' : 'No'}
        </span>
        ${field.doc_type ? `<span class="cat-doc-type">${esc(field.doc_type)}</span>` : ''}
      </td>
      <td data-label="Ejemplo">
        <span class="cat-example ${example ? '' : 'is-empty'}" title="${esc(example)}">
          ${esc(example || 'sin ejemplo')}
        </span>
      </td>
    </tr>`;
}

function groupHtml(layer) {
  const accent = schemaColor(layer.schema);
  const collapsed = state.collapsed.has(layer.key);
  const docClass = docBadge(layer.fields_documented, layer.fields_total);
  const warnings = layer.warnings || [];

  return `
    <section class="cat-group ${collapsed ? 'is-collapsed' : ''}"
             data-key="${esc(layer.key)}" style="--group-accent:${accent}">
      <button type="button" class="cat-group-head"
              aria-expanded="${collapsed ? 'false' : 'true'}"
              aria-controls="fields-${esc(layer.key)}">
        <span class="cat-chevron">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
               stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        </span>
        <span class="cat-g-titlewrap">
          <span class="cat-g-title" title="${esc(layer.title || layer.table)}">
            ${esc(layer.title || layer.table)}
          </span>
          <span class="cat-g-sub">
            <code>${esc(layer.schema)}.${esc(layer.table)}</code>
            <span class="cat-schema-chip">${esc(layer.schema)}</span>
          </span>
        </span>
        <span class="cat-g-badges">
          ${layer.geom ? `<span class="cat-badge geom">${esc(layer.geom)}</span>` : ''}
          ${layer.epsg ? `<span class="cat-badge">EPSG:${esc(layer.epsg)}</span>` : ''}
          <span class="cat-badge">${fmt(layer.features)} objetos</span>
          <span class="cat-badge ${docClass}">
            ${fmt(layer.fields_documented)}/${fmt(layer.fields_total)} campos doc.
          </span>
          ${warnings.length ? `<span class="cat-badge warn" title="${esc(warnings.join(' · '))}">⚠ ${warnings.length}</span>` : ''}
        </span>
      </button>

      <div class="cat-group-body" id="fields-${esc(layer.key)}">
        ${
          layer.abstract || warnings.length
            ? `<div class="cat-layer-note">
                 ${
                   layer.abstract
                     ? `<p class="cat-layer-abstract" title="${esc(layer.abstract)}">${esc(layer.abstract)}</p>`
                     : ''
                 }
                 ${
                   warnings.length
                     ? `<div class="cat-layer-alerts">
                          ${warnings
                            .map((warning) => `<span class="cat-badge warn">${esc(warning)}</span>`)
                            .join('')}
                        </div>`
                     : ''
                 }
               </div>`
            : ''
        }
        <table class="cat-table">
          <thead>
            <tr>
              <th scope="col">Campo</th>
              <th scope="col">Tipo</th>
              <th scope="col">Long.</th>
              <th scope="col">Prec.</th>
              <th scope="col">Nulos</th>
              <th scope="col">Únicos</th>
              <th scope="col">Documentado</th>
              <th scope="col">Ejemplo</th>
            </tr>
          </thead>
          <tbody>
            ${layer.fields.map(fieldRow).join('')}
          </tbody>
        </table>
      </div>
    </section>`;
}

function emptySchemaHtml(schema) {
  const accent = schemaColor(schema.name);
  return `
    <section class="cat-group" style="--group-accent:${accent}">
      <div class="cat-group-head is-static">
        <span class="cat-chevron" aria-hidden="true"></span>
        <span class="cat-g-titlewrap">
          <span class="cat-g-title">${esc(schema.name)}</span>
          <span class="cat-g-sub">
            <span class="cat-schema-chip">${esc(schema.name)}</span>
            <code>sin capas vectoriales</code>
          </span>
        </span>
        <span class="cat-g-badges">
          <span class="cat-badge">0 capas espaciales</span>
        </span>
      </div>
    </section>`;
}

function renderList() {
  if (!state.data) return;

  const schemas = filteredSchemas();
  const layers = schemas.flatMap((schema) => schema.layers);
  const fields = layers.reduce((sum, layer) => sum + layer.fields.length, 0);

  listEl.innerHTML = schemas
    .map(
      (schema) => `
        <div class="cat-schema-block">
          ${
            schema.layers.length
              ? schema.layers.map(groupHtml).join('')
              : emptySchemaHtml(schema)
          }
        </div>`
    )
    .join('');

  const hasResults = schemas.length > 0;
  listEl.hidden = !hasResults;
  emptyEl.hidden = hasResults;

  if (hasResults) {
    const filtered = Boolean(state.query.trim() || state.schema || state.onlyUndocumented);
    const updated = clock(state.data.generated_at);
    statusEl.classList.remove('is-error');
    statusEl.textContent = filtered
      ? `${fmt(layers.length)} capas visibles · ${fmt(fields)} campos`
      : `${fmt(layers.length)} capas · ${fmt(fields)} campos · actualizado ${updated}`;
  } else {
    statusEl.textContent = '0 capas con los filtros actuales';
  }

  const allCollapsed =
    layers.length > 0 && layers.every((layer) => state.collapsed.has(layer.key));
  toggleAllBtn.textContent = allCollapsed ? 'Expandir todo' : 'Contraer todo';
}

/* ------------------------------------------------------------------ */
/* Carga de datos                                                      */
/* ------------------------------------------------------------------ */
function setLoading(isLoading) {
  state.loading = isLoading;
  refreshBtn.disabled = isLoading;
  exportBtn.disabled = isLoading;
  listEl.setAttribute('aria-busy', String(isLoading));
  if (isLoading) {
    refreshBtn.querySelector('span').textContent = 'Actualizando…';
    if (!state.data) {
      listEl.innerHTML =
        '<div class="cat-skeleton"></div><div class="cat-skeleton"></div><div class="cat-skeleton"></div>';
    }
  } else {
    refreshBtn.querySelector('span').textContent = 'Actualizar';
  }
}

function showError(message) {
  errorTextEl.textContent = message;
  errorEl.hidden = false;
  statusEl.textContent = 'Error al cargar el catálogo';
  statusEl.classList.add('is-error');
}

function hideError() {
  errorEl.hidden = true;
}

async function load({ refresh = false } = {}) {
  if (state.loading) return;
  hideError();
  setLoading(true);
  try {
    const res = await apiFetch(`/api/v1/diccionario${refresh ? '?refresh=1' : ''}`, {
      signal: AbortSignal.timeout(120000),
    });
    if (res.status === 403) {
      throw new Error('Tu rol no tiene acceso al catálogo de datos.');
    }
    if (!res.ok) {
      throw new Error(`El servidor respondió ${res.status}.`);
    }
    state.data = await res.json();
    fillSchemaSelect();
    renderKpis();
    renderList();
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      showError('La consulta tardó demasiado. Inténtalo de nuevo.');
    } else {
      showError(error?.message || 'No se pudo cargar el catálogo.');
    }
  } finally {
    setLoading(false);
  }
}

/* ------------------------------------------------------------------ */
/* Exportación                                                         */
/* ------------------------------------------------------------------ */
async function exportExcel() {
  if (state.loading) return;
  const label = exportBtn.querySelector('span');
  const original = label.textContent;
  hideError();
  exportBtn.disabled = true;
  label.textContent = 'Generando…';

  try {
    const res = await apiFetch('/api/v1/diccionario/export?refresh=1', {
      signal: AbortSignal.timeout(180000),
    });
    if (!res.ok) {
      throw new Error(`No se pudo generar el Excel (HTTP ${res.status}).`);
    }
    const blob = await res.blob();
    const disposition = res.headers.get('Content-Disposition') || '';
    const match = /filename="?([^";]+)"?/i.exec(disposition);
    const filename = match ? match[1] : 'diccionario_geoportal.xlsx';

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  } catch (error) {
    showError(error?.message || 'No se pudo descargar el Excel.');
  } finally {
    exportBtn.disabled = false;
    label.textContent = original;
  }
}

/* ------------------------------------------------------------------ */
/* Eventos                                                             */
/* ------------------------------------------------------------------ */
let searchTimer = null;

function wireEvents() {
  refreshBtn.addEventListener('click', () => load({ refresh: true }));
  exportBtn.addEventListener('click', exportExcel);
  $('cat-retry').addEventListener('click', () => load({ refresh: true }));

  qInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.query = qInput.value;
      renderList();
    }, 140);
  });

  schemaSelect.addEventListener('change', () => {
    state.schema = schemaSelect.value;
    renderList();
  });

  undocInput.addEventListener('change', () => {
    state.onlyUndocumented = undocInput.checked;
    renderList();
  });

  toggleAllBtn.addEventListener('click', () => {
    const visible = filteredSchemas().flatMap((schema) => schema.layers);
    if (!visible.length) return;
    const allCollapsed = visible.every((layer) => state.collapsed.has(layer.key));
    visible.forEach((layer) => {
      if (allCollapsed) state.collapsed.delete(layer.key);
      else state.collapsed.add(layer.key);
    });
    renderList();
  });

  // Delegación: plegar/desplegar por capa.
  listEl.addEventListener('click', (event) => {
    const head = event.target.closest('.cat-group-head');
    if (!head) return;
    const group = head.closest('.cat-group');
    const key = group?.dataset.key;
    if (!key) return;
    const collapsed = group.classList.toggle('is-collapsed');
    head.setAttribute('aria-expanded', String(!collapsed));
    if (collapsed) state.collapsed.add(key);
    else state.collapsed.delete(key);
  });
}

wireEvents();
load();
