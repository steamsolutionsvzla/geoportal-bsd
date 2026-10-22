// metadata-qgis.js
// Réplica web (solo lectura) del editor de metadatos de QGIS:
// tira de pestañas, group boxes, campos con etiqueta encima y listas/tablas
// tipo Qt. Compartida por el panel del Geoportal y por Personalizar Geoportal.

const TABS = [
  { id: 'identificacion', label: 'Identificación' },
  { id: 'categorias', label: 'Categorías' },
  { id: 'palabras_clave', label: 'Palabras clave' },
  { id: 'acceso', label: 'Acceso' },
  { id: 'extension', label: 'Extensión' },
  { id: 'contacto', label: 'Contacto' },
  { id: 'enlaces', label: 'Enlaces' },
  { id: 'historial', label: 'Historial' },
];

// Pestañas que no se muestran en el proyecto. Sus datos siguen en la BD y en
// este módulo: para volver a mostrarlas basta con quitar su id de esta lista.
const HIDDEN_TAB_IDS = new Set(['categorias', 'palabras_clave', 'extension', 'enlaces']);
const VISIBLE_TABS = TABS.filter((t) => !HIDDEN_TAB_IDS.has(t.id));

const HINT_IDENTIFICACION =
  'Esta página describe la atribución básica del conjunto de datos. Por favor, use la ayuda emergente de las herramientas para más información.';
const HINT_PALABRAS_CLAVE =
  'Las palabras clave son opcionales y proporcionan una forma de ofrecer información descriptiva adicional sobre el conjunto de datos. Para el concepto, sugerimos usar un vocabulario estándar tal como GEMET.';
const HINT_ACCESO = 'Las tarifas, licencias y derechos para este conjunto de datos.';
const HINT_EXTENSION =
  'Sistema de referencia de coordenadas y extensión espacial para este conjunto de datos.';
const HINT_CATEGORIAS =
  'Categorías del conjunto de datos según el vocabulario temático aplicado (por ejemplo, ISO Topic Category).';
const HINT_HISTORIAL =
  'Historial de cambios y fechas asociadas al metadato de este conjunto de datos.';

const CONTACT_FIELDS = [
  ['nombre', 'Nombre'],
  ['rol', 'Rol'],
  ['organizacion', 'Organización'],
  ['posicion', 'Posición'],
  ['correo_electronico', 'Correo electrónico'],
  ['voz', 'Voz'],
  ['fax', 'Fax'],
  ['direccion', 'Dirección'],
  ['tipo', 'Tipo'],
  ['codigo_postal', 'Código postal'],
  ['ciudad', 'Ciudad'],
  ['area_administrativa', 'Área administrativa'],
  ['pais', 'País'],
];

const CONTACT_ALWAYS = ['nombre', 'rol', 'organizacion'];

const ENLACE_FIELDS = [
  ['tipo', 'Tipo'],
  ['url', 'URL'],
  ['descripcion', 'Descripción'],
  ['formato', 'Formato'],
  ['mime', 'Tipo MIME'],
  ['tamano', 'Tamaño'],
];

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

function has(value) {
  return value !== null && value !== undefined && String(value).trim() !== '';
}

function str(value) {
  return has(value) ? String(value) : '';
}

function arr(value) {
  return Array.isArray(value) ? value : [];
}

function num(value, decimals = 6) {
  if (!has(value)) return '';
  const n = Number(value);
  if (Number.isNaN(n)) return String(value);
  return n.toLocaleString('es-VE', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function entero(value) {
  if (!has(value)) return '';
  const n = Number(value);
  if (Number.isNaN(n)) return String(value);
  return n.toLocaleString('es-VE');
}

function fecha(value, conHora = false) {
  if (!has(value)) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  if (conHora) {
    return d.toLocaleString('es-VE', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  }
  return d.toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' });
}

function parseList(value) {
  if (Array.isArray(value)) return value.map((x) => String(x)).filter((x) => x.trim());
  if (!has(value)) return [];
  const raw = String(value).trim();
  if (raw.startsWith('[')) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map((x) => String(x)).filter((x) => x.trim());
    } catch {
      // no era JSON: se tratas como lista separada por comas
    }
  }
  return raw.split(/\n|,/).map((x) => x.trim()).filter(Boolean);
}

function hint(text) {
  return `<p class="qgis-hint">${esc(text)}</p>`;
}

function field(label, value, opts = {}) {
  const safeLabel = esc(label);
  if (opts.area) {
    const rows = opts.rows || 6;
    return `
      <div class="qgis-field qgis-field--wide">
        <label>${safeLabel}</label>
        <textarea class="qgis-textarea" readonly rows="${rows}">${esc(str(value))}</textarea>
      </div>`;
  }
  const display = opts.display ? opts.display(value) : str(value);
  return `
    <div class="qgis-field">
      <label>${safeLabel}</label>
      <input class="qgis-input" type="text" readonly value="${esc(display)}" />
    </div>`;
}

function group(title, body, extraClass = '') {
  return `<fieldset class="qgis-group ${extraClass}"><legend>${esc(title)}</legend>${body}</fieldset>`;
}

function grid(fieldsHtml, cols = 2) {
  return `<div class="qgis-grid qgis-grid--${cols}">${fieldsHtml.join('')}</div>`;
}

function listBox(items, emptyText) {
  const rows = items.length
    ? items.map((item) => `<li>${esc(item)}</li>`).join('')
    : `<li class="qgis-list-empty">${esc(emptyText || 'Sin registros.')}</li>`;
  return `<ul class="qgis-list">${rows}</ul>`;
}

function table(headers, rows, emptyText) {
  if (!rows.length) {
    return `<div class="qgis-empty">${esc(emptyText || 'Sin registros.')}</div>`;
  }
  const head = `<tr><th class="qgis-th-n"></th>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr>`;
  const body = rows
    .map((cells, i) => `<tr><td class="qgis-td-n">${i + 1}</td>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`)
    .join('');
  return `
    <div class="qgis-table-wrap">
      <table class="qgis-table">
        <thead>${head}</thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;
}

function emptyBlock(text) {
  return `<div class="qgis-empty">${esc(text)}</div>`;
}

function pageIdentificacion(m) {
  return `
    ${hint(HINT_IDENTIFICACION)}
    ${field('Resumen', m.resumen, { area: true, rows: 9 })}`;
}

function pageCategorias(m) {
  const categorias = parseList(m.categorias_iso);
  return `
    ${hint(HINT_CATEGORIAS)}
    ${listBox(categorias, 'Sin categorías registradas.')}`;
}

function pagePalabrasClave(m) {
  const rows = arr(m.palabras_clave);
  const byConcept = new Map();
  rows.forEach((r) => {
    const concepto = str(r?.concepto) || 'general';
    const palabra = str(r?.palabra);
    if (!palabra) return;
    if (!byConcept.has(concepto)) byConcept.set(concepto, []);
    byConcept.get(concepto).push(palabra);
  });
  const tableRows = [...byConcept.entries()].map(([concepto, palabras]) => [
    esc(concepto),
    esc(palabras.join(', ')),
  ]);
  const body = tableRows.length
    ? table(['Concepto', 'Palabras clave'], tableRows, 'Sin palabras clave registradas.')
    : emptyBlock('Sin palabras clave registradas.');
  return `
    ${hint(HINT_PALABRAS_CLAVE)}
    ${body}`;
}

function pageAcceso(m) {
  const restricciones = parseList(m.restricciones).map((r) => [esc(r)]);
  const restriccionesHtml = restricciones.length
    ? table(['Restricción'], restricciones, 'Sin restricciones registradas.')
    : emptyBlock('Sin restricciones registradas.');
  return `
    ${hint(HINT_ACCESO)}
    ${field('Cuotas', m.cuotas)}
    <div class="qgis-field qgis-field--wide">
      <label>Licencias</label>
      ${listBox(parseList(m.licencias), 'Sin licencias registradas.')}
    </div>
    <div class="qgis-field qgis-field--wide">
      <label>Derechos (atribución o copyright)</label>
      ${listBox(parseList(m.derechos), 'Sin derechos registrados.')}
    </div>
    <div class="qgis-field qgis-field--wide">
      <label>Restricciones</label>
      ${restriccionesHtml}
    </div>`;
}

function pageExtension(m) {
  const src = [
    m.crs_epsg ? `EPSG:${m.crs_epsg}` : '',
    str(m.crs_nombre),
  ].filter(Boolean).join(' - ');
  const srcLine = src ? `SRC: ${src}` : '';
  const wkt = m.crs_wkt
    ? `<details class="qgis-details"><summary>Ver WKT del sistema de referencia</summary><textarea class="qgis-textarea" readonly rows="6">${esc(str(m.crs_wkt))}</textarea></details>`
    : '';
  const extension = `
    <div class="qgis-extent">
      <div class="qgis-extent-cell"></div>
      <div class="qgis-extent-cell">${field('Norte', m.bbox_norte, { display: (v) => num(v) })}</div>
      <div class="qgis-extent-cell">${field('Oeste', m.bbox_oeste, { display: (v) => num(v) })}</div>
      <div class="qgis-extent-cell">${field('Este', m.bbox_este, { display: (v) => num(v) })}</div>
      <div class="qgis-extent-cell"></div>
      <div class="qgis-extent-cell">${field('Sur', m.bbox_sur, { display: (v) => num(v) })}</div>
    </div>`;
  const zonas = grid([
    field('Z máxima', m.z_maxima, { display: (v) => num(v, 2) }),
    field('Z mínima', m.z_minima, { display: (v) => num(v, 2) }),
  ]);
  return `
    ${hint(HINT_EXTENSION)}
    ${group('Sistema de referencia de coordenadas', `
      ${field('Sistema de referencia', srcLine)}
      <p class="qgis-note">El mismo que en las propiedades de la capa y el proveedor.</p>
      ${wkt}`)}
    ${group('Extensión (actual: capa)', extension)}
    ${group('Alturas (Z)', zonas)}`;
}

function pageContacto(m) {
  const contactos = arr(m.contactos);
  if (!contactos.length) {
    return `${hint('Contactos asociados a este conjunto de datos.')}${emptyBlock('Sin contactos registrados.')}`;
  }
  const blocks = contactos.map((c, i) => {
    const campos = CONTACT_FIELDS
      .filter(([key]) => CONTACT_ALWAYS.includes(key) || has(c?.[key]))
      .map(([key, label]) => field(label, c?.[key]));
    const titulo = str(c?.nombre) || `Contacto ${i + 1}`;
    return group(titulo, grid(campos));
  }).join('');
  return `${hint('Contactos asociados a este conjunto de datos.')}${blocks}`;
}

function pageEnlaces(m) {
  const enlaces = arr(m.enlaces);
  if (!enlaces.length) {
    return `${hint('Enlaces relacionados con este conjunto de datos.')}${emptyBlock('Sin enlaces registrados.')}`;
  }
  const blocks = enlaces.map((e, i) => {
    const campos = ENLACE_FIELDS.map(([key, label]) => {
      if (key === 'url') {
        const url = str(e?.url);
        const safe = /^(https?:\/\/|mailto:)/i.test(url) ? url : '';
        const contenido = safe
          ? `<a class="qgis-link" href="${esc(safe)}" target="_blank" rel="noopener noreferrer">${esc(url)}</a>`
          : '';
        return `
          <div class="qgis-field qgis-field--wide">
            <label>${esc(label)}</label>
            <div class="qgis-input qgis-input--static">${contenido}</div>
          </div>`;
      }
      return field(label, e?.[key]);
    }).join('');
    const titulo = str(e?.nombre) || `Enlace ${i + 1}`;
    return group(titulo, campos);
  }).join('');
  return `${hint('Enlaces relacionados con este conjunto de datos.')}${blocks}`;
}

function pageHistorial(m) {
  const dateDefs = [
    ['Fecha de creación', m.fecha_creado],
    ['Fecha de publicación', m.fecha_publicado],
    ['Fecha de revisión', m.fecha_revisado],
    ['Fecha de supresión', m.fecha_suprimido],
    ['Fecha de carga', m.fecha_carga],
  ].filter(([, value]) => has(value));
  const fechas = dateDefs.length
    ? group('Fechas del metadato',
        grid(dateDefs.map(([label, value]) =>
          field(label, value, { display: (v) => fecha(v, label === 'Fecha de carga') }))))
    : '';
  return `
    ${hint(HINT_HISTORIAL)}
    ${field('Historial', m.historial, { area: true, rows: 4 })}
    ${fechas}`;
}

function buildPage(id, m) {
  switch (id) {
    case 'identificacion': return pageIdentificacion(m);
    case 'categorias': return pageCategorias(m);
    case 'palabras_clave': return pagePalabrasClave(m);
    case 'acceso': return pageAcceso(m);
    case 'extension': return pageExtension(m);
    case 'contacto': return pageContacto(m);
    case 'enlaces': return pageEnlaces(m);
    case 'historial': return pageHistorial(m);
    default: return '';
  }
}

export function buildQgisMetadataHtml(metadata, options = {}) {
  const variant = options.variant === 'panel' ? 'panel' : 'config';
  const m = metadata || {};
  const tabs = VISIBLE_TABS.map((t, i) => {
    const on = i === 0;
    return `<button type="button" class="qgis-tab${on ? ' active' : ''}" role="tab" aria-selected="${on}" data-qtab="${t.id}">${t.label}</button>`;
  }).join('');
  const pages = VISIBLE_TABS.map((t, i) => `
    <section class="qgis-page" role="tabpanel" data-qpage="${t.id}"${i === 0 ? '' : ' hidden'}>
      ${buildPage(t.id, m)}
    </section>`).join('');
  return `
    <div class="qgis-meta qgis-meta--${variant}" data-qgis-meta>
      <div class="qgis-tabs" role="tablist" aria-label="Secciones de metadatos">${tabs}</div>
      <div class="qgis-pages">${pages}</div>
    </div>`;
}

export function initQgisMetadataWidgets(root = document) {
  const scope = root && root.querySelectorAll ? root : document;
  scope.querySelectorAll('[data-qgis-meta]').forEach((widget) => {
    if (widget.dataset.qgisReady === '1') return;
    widget.dataset.qgisReady = '1';
    widget.addEventListener('click', (event) => {
      const tab = event.target.closest('.qgis-tab');
      if (!tab || !widget.contains(tab)) return;
      const id = tab.dataset.qtab;
      widget.querySelectorAll('.qgis-tab').forEach((t) => {
        const on = t.dataset.qtab === id;
        t.classList.toggle('active', on);
        t.setAttribute('aria-selected', String(on));
      });
      widget.querySelectorAll('.qgis-page').forEach((page) => {
        page.hidden = page.dataset.qpage !== id;
      });
    });
  });
}
