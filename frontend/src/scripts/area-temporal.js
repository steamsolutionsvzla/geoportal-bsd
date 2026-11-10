// area-temporal.js
// ---------------------------------------------------------------------------
// Capa de área temporal para el filtro del analista.
//
// La capa vive solo en el navegador: puede venir de un archivo
// GeoJSON / Shapefile (.zip) o de un polígono dibujado sobre el mapa.
// No se envía al backend ni se guarda en PostGIS.
//
// Visualmente no tiene relleno: solo se dibujan los bordes. La entidad
// seleccionada para el filtro se resalta con otro color y mayor grosor.
// ---------------------------------------------------------------------------
import shp from 'shpjs';
import { Archive } from 'libarchive.js';
import * as turf from '@turf/turf';
import { getMap } from './map-config.js';

const AREA_SOURCE_ID = 'source-area-temporal';
const AREA_LINE_LAYER_ID = 'layer-area-temporal-line';
const AREA_LABEL_SOURCE_ID = 'source-area-temporal-label';
const AREA_LABEL_LAYER_ID = 'layer-area-temporal-label';

const AREA_BASE_COLOR = '#2d5296';
const AREA_SELECTED_COLOR = '#0f766e';

const MAX_FILE_BYTES = 30 * 1024 * 1024;
// Tope de datos descomprimidos al leer un .rar (evita bombas de compresión).
const MAX_EXTRACTED_BYTES = 150 * 1024 * 1024;
const ARCHIVE_SKIP_DIRS = ['__MACOSX', '.DS_Store', 'Thumbs.db'];
const LABEL_CANDIDATES = ['nombre', 'name', 'entidad', 'bloque', 'titulo', 'title', 'label'];

let areaCollection = null;
let areaLabelKey = null;
let areaFileName = '';
let areaSourceType = ''; // 'file' | 'drawn'
let selectedAreaIndex = null;

// Coordenada interior calculada para la etiqueta de cada entidad.
// Se recalcula solo al cargar/cambiar el área o el campo de etiqueta;
// cambiar de entidad seleccionada no vuelve a calcular geometrías.
let areaLabelPositions = [];

// ---------------------------------------------------------------------------
// Normalización de archivos
// ---------------------------------------------------------------------------
function isPolygonGeometry(geometry) {
  return geometry && (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon');
}

function cleanupFeature(feature) {
  if (!feature || feature.type !== 'Feature' || !isPolygonGeometry(feature.geometry)) return null;
  return {
    type: 'Feature',
    properties: { ...(feature.properties || {}) },
    geometry: feature.geometry
  };
}

/**
 * Convierte cualquier entrada de shpjs/GeoJSON en una lista plana de
 * features de polígono, contando las geometrías que se omiten.
 */
function normalizarEntrada(entrada) {
  const features = [];
  let omitidas = 0;

  const visitar = (nodo) => {
    if (!nodo) return;
    if (Array.isArray(nodo)) {
      nodo.forEach(visitar);
      return;
    }
    if (nodo.type === 'FeatureCollection') {
      (nodo.features || []).forEach(visitar);
      return;
    }
    if (nodo.type === 'Feature') {
      const f = cleanupFeature(nodo);
      if (f) features.push(f);
      else omitidas++;
      return;
    }
    if (nodo.type === 'Polygon' || nodo.type === 'MultiPolygon') {
      features.push({
        type: 'Feature',
        properties: {},
        geometry: nodo
      });
      return;
    }
    if (nodo.type === 'GeometryCollection') {
      (nodo.geometries || []).forEach(visitar);
      return;
    }
    omitidas++;
  };

  visitar(entrada);
  return { features, omitidas };
}

function extensionDe(nombre) {
  const n = String(nombre || '');
  const punto = n.lastIndexOf('.');
  return punto > -1 ? n.slice(punto + 1).toLowerCase() : '';
}

async function parseKmlText(text) {
  const doc = new DOMParser().parseFromString(text, 'text/xml');
  if (doc.querySelector('parsererror')) {
    throw new Error('El KML no es válido o está dañado.');
  }
  const { kml } = await import('@tmcw/togeojson');
  return kml(doc);
}

async function parseGeoJsonText(text) {
  return JSON.parse(text);
}

/**
 * Lee un KMZ (ZIP con uno o varios KML) usando la API nativa del navegador
 * para descomprimir, sin depender del worker WASM.
 */
async function parseKmzFile(file) {
  const { unzip } = await import('but-unzip');
  const bytes = new Uint8Array(await file.arrayBuffer());
  let entradas;

  try {
    entradas = unzip(bytes);
  } catch (_) {
    throw new Error('El archivo KMZ no es un ZIP válido o está dañado.');
  }

  const capas = [];
  for (const entrada of entradas) {
    if (!String(entrada.filename || '').toLowerCase().endsWith('.kml')) continue;
    const datos = await entrada.read();
    const texto = new TextDecoder('utf-8').decode(datos);
    capas.push(await parseKmlText(texto));
  }

  if (!capas.length) {
    throw new Error('El KMZ no contiene ningún archivo KML.');
  }
  return capas;
}

function rutaIgnorada(path) {
  const partes = String(path || '').split(/[\\/]/);
  return partes.some((p) => ARCHIVE_SKIP_DIRS.includes(p));
}

function aplanarArchivo(node, prefijo = '', salida = []) {
  if (!node || typeof node !== 'object') return salida;

  for (const [clave, valor] of Object.entries(node)) {
    const ruta = prefijo ? `${prefijo}/${clave}` : clave;
    if (valor instanceof File) {
      salida.push({ path: ruta, file: valor });
    } else if (valor && typeof valor === 'object') {
      aplanarArchivo(valor, ruta, salida);
    }
  }
  return salida;
}

/**
 * Lee un archivo comprimido (RAR/KMZ) con libarchive.js + WASM y devuelve
 * una lista de entradas GeoJSON/Shapefile/KML ya parseadas.
 */
async function parseArchiveEntries(file, etiqueta = 'archivo comprimido') {
  Archive.init({ workerUrl: '/vendor/libarchive/worker-bundle.js' });

  let extraidos;
  try {
    const archive = await Archive.open(file);

    // Primero se listan los tamaños (sin descomprimir) para frenar bombas ZIP.
    const listado = await archive.getFilesArray();
    const totalDeclarado = listado.reduce((suma, e) => suma + (e.file?.size || 0), 0);
    if (totalDeclarado > MAX_EXTRACTED_BYTES) {
      await archive.close();
      throw new Error(`El contenido del ${etiqueta} supera el límite de 150 MB descomprimidos.`);
    }

    extraidos = await archive.extractFiles();
  } catch (error) {
    if (error?.message?.startsWith('El contenido')) throw error;
    const mensaje = String(error?.message || error || '');
    if (/pass|encrypt/i.test(mensaje)) {
      throw new Error(`El archivo ${etiqueta} está protegido con contraseña y no se puede leer.`);
    }
    throw new Error(`No se pudo abrir el archivo ${etiqueta}. Verifica que no esté dañado.`);
  }

  const entradas = aplanarArchivo(extraidos).filter((e) => !rutaIgnorada(e.path));
  if (!entradas.length) {
    throw new Error(`El archivo ${etiqueta} está vacío.`);
  }

  const totalBytes = entradas.reduce((suma, e) => suma + (e.file.size || 0), 0);
  if (totalBytes > MAX_EXTRACTED_BYTES) {
    throw new Error(`El contenido del ${etiqueta} supera el límite de 150 MB descomprimidos.`);
  }

  // Agrupa componentes de Shapefile por ruta base (sin extensión).
  const shapefiles = new Map();
  const parseados = [];

  for (const entrada of entradas) {
    const ext = extensionDe(entrada.path || entrada.file.name);
    if (!ext) continue;

    if (ext === 'shp' || ext === 'dbf' || ext === 'shx' || ext === 'prj' || ext === 'cpg') {
      const base = (entrada.path || entrada.file.name).replace(/\.[^.]+$/, '');
      const grupo = shapefiles.get(base) || {};
      grupo[ext] = entrada.file;
      shapefiles.set(base, grupo);
      continue;
    }

    try {
      if (ext === 'kml') {
        parseados.push(await parseKmlText(await entrada.file.text()));
      } else if (ext === 'geojson' || ext === 'json') {
        parseados.push(await parseGeoJsonText(await entrada.file.text()));
      } else if (ext === 'zip') {
        parseados.push(await shp(await entrada.file.arrayBuffer()));
      }
    } catch (error) {
      console.warn(`No se pudo leer "${entrada.path}" dentro del .rar:`, error);
    }
  }

  for (const grupo of shapefiles.values()) {
    if (!grupo.shp) continue;
    try {
      // shpjs acepta directamente el objeto con las piezas del shapefile.
      const capa = await shp({
        shp: await grupo.shp.arrayBuffer(),
        dbf: grupo.dbf ? await grupo.dbf.arrayBuffer() : undefined,
        prj: grupo.prj ? await grupo.prj.arrayBuffer() : undefined,
        cpg: grupo.cpg ? await grupo.cpg.arrayBuffer() : undefined
      });
      parseados.push(capa);
    } catch (error) {
      console.warn('No se pudo leer un Shapefile dentro del .rar:', error);
    }
  }

  if (!parseados.length) {
    throw new Error(`El ${etiqueta} no contiene capas compatibles (SHP, KML, GeoJSON o ZIP).`);
  }

  return parseados;
}

function obtenerClavesCampos(features) {
  const claves = [];
  const vistas = new Set();
  features.forEach((f) => {
    Object.keys(f.properties || {}).forEach((k) => {
      if (k.startsWith('__')) return;
      if (vistas.has(k)) return;
      vistas.add(k);
      claves.push(k);
    });
  });
  return claves;
}

function detectarClaveEtiqueta(features, claves) {
  if (!claves.length) return null;
  for (const candidata of LABEL_CANDIDATES) {
    const clave = claves.find((k) => k.toLowerCase() === candidata);
    if (!clave) continue;
    const tieneValor = features.some((f) => {
      const v = f.properties?.[clave];
      return v !== null && v !== undefined && String(v).trim() !== '';
    });
    if (tieneValor) return clave;
  }
  return claves[0];
}

export function formatearAreaNombre(nombre) {
  const n = String(nombre || '').trim();
  if (!n) return 'Área de análisis';
  return n.length > 42 ? `${n.slice(0, 40)}…` : n;
}

// ---------------------------------------------------------------------------
// Lectura de archivos
// ---------------------------------------------------------------------------
export async function parseAreaFile(file) {
  if (!file) throw new Error('No se seleccionó ningún archivo.');
  if (file.size > MAX_FILE_BYTES) {
    throw new Error('El archivo supera el límite de 30 MB.');
  }

  const nombre = file.name || '';
  const ext = nombre.includes('.') ? nombre.split('.').pop().toLowerCase() : '';

  let entrada;
  try {
    if (ext === 'zip') {
      entrada = await shp(await file.arrayBuffer());
    } else if (ext === 'geojson' || ext === 'json') {
      entrada = JSON.parse(await file.text());
    } else if (ext === 'kml') {
      entrada = await parseKmlText(await file.text());
    } else if (ext === 'kmz') {
      entrada = await parseKmzFile(file);
    } else if (ext === 'rar') {
      entrada = await parseArchiveEntries(file, 'RAR');
    } else {
      throw new Error('Formato no compatible. Usa KML, KMZ, GeoJSON, Shapefile (.zip) o RAR.');
    }
  } catch (error) {
    if (error?.message?.startsWith('Formato')) throw error;
    // Los errores propios (KML/KMZ/RAR/Shapefile) son más útiles que el genérico.
    if (error?.message && /^(El |No |Formato)/.test(error.message)) throw error;
    throw new Error('No se pudo leer el archivo. Verifica que sea KML, KMZ, GeoJSON, Shapefile o RAR válido.');
  }

  const { features, omitidas } = normalizarEntrada(entrada);
  if (!features.length) {
    throw new Error('El archivo no contiene polígonos válidos.');
  }

  const claves = obtenerClavesCampos(features);
  const labelKey = detectarClaveEtiqueta(features, claves);

  return {
    collection: { type: 'FeatureCollection', features },
    fieldKeys: claves,
    labelKey,
    fileName: nombre,
    skipped: omitidas
  };
}

// ---------------------------------------------------------------------------
// Capa de MapLibre
// ---------------------------------------------------------------------------
function asegurarCapa() {
  const map = getMap();
  if (!map) return null;

  if (!map.getSource(AREA_SOURCE_ID)) {
    map.addSource(AREA_SOURCE_ID, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
      generateId: true
    });
  }

  if (!map.getLayer(AREA_LINE_LAYER_ID)) {
    map.addLayer({
      id: AREA_LINE_LAYER_ID,
      type: 'line',
      source: AREA_SOURCE_ID,
      paint: {
        'line-color': [
          'case',
          ['boolean', ['feature-state', 'selected'], false],
          AREA_SELECTED_COLOR,
          AREA_BASE_COLOR
        ],
        'line-width': [
          'case',
          ['boolean', ['feature-state', 'selected'], false],
          3.4,
          1.4
        ],
        'line-opacity': [
          'case',
          ['boolean', ['feature-state', 'selected'], false],
          1,
          0.78
        ]
      }
    });
  }

  if (!map.getSource(AREA_LABEL_SOURCE_ID)) {
    map.addSource(AREA_LABEL_SOURCE_ID, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] }
    });
  }

  if (!map.getLayer(AREA_LABEL_LAYER_ID)) {
    map.addLayer({
      id: AREA_LABEL_LAYER_ID,
      type: 'symbol',
      source: AREA_LABEL_SOURCE_ID,
      layout: {
        'text-field': ['get', 'label'],
        'text-font': ['Open Sans Regular'],
        'text-size': [
          'interpolate', ['linear'], ['zoom'],
          5, ['case', ['get', 'selected'], 12, 9],
          10, ['case', ['get', 'selected'], 15, 12],
          14, ['case', ['get', 'selected'], 18, 14]
        ],
        'text-max-width': 12,
        'text-line-height': 1.1,
        'text-allow-overlap': true,
        'text-ignore-placement': true,
        'text-padding': 2
      },
      paint: {
        'text-color': AREA_SELECTED_COLOR,
        'text-halo-color': '#ffffff',
        'text-halo-width': 1.6,
        'text-opacity': 0.95
      }
    });
  }

  // Los bordes y luego las etiquetas deben quedar por encima de las capas de datos.
  try {
    map.moveLayer(AREA_LINE_LAYER_ID);
    map.moveLayer(AREA_LABEL_LAYER_ID);
  } catch (_) { /* capa recién creada */ }

  return map;
}

// ---------------------------------------------------------------------------
// Etiquetas de todas las entidades del área
// ---------------------------------------------------------------------------
function posicionEtiqueta(feature) {
  // pointOnFeature devuelve el "pole of inaccessibility": el punto interior
  // más alejado de los bordes. Funciona bien en polígonos finos o irregulares.
  try {
    const punto = turf.pointOnFeature(feature);
    if (punto?.geometry?.coordinates && turf.booleanPointInPolygon(punto, feature)) {
      return punto.geometry.coordinates;
    }
  } catch (_) { /* geometría inválida */ }

  try {
    const punto = turf.centerOfMass(feature);
    if (punto?.geometry?.coordinates && turf.booleanPointInPolygon(punto, feature)) {
      return punto.geometry.coordinates;
    }
  } catch (_) { /* geometría inválida */ }

  // Último recurso: centro del bounding box.
  try {
    const [minX, minY, maxX, maxY] = turf.bbox(feature);
    return [(minX + maxX) / 2, (minY + maxY) / 2];
  } catch (_) {
    return null;
  }
}

function recalcularPosicionesEtiquetas() {
  areaLabelPositions = getAreaFeatures().map((feature) => posicionEtiqueta(feature));
}

function renderAreaLabels() {
  const map = getMap();
  if (!map) return;

  const features = getAreaFeatures();
  const puntos = [];

  features.forEach((feature, index) => {
    const coords = areaLabelPositions[index];
    if (!coords) return;

    puntos.push({
      type: 'Feature',
      properties: {
        label: getAreaLabel(feature, index),
        selected: index === selectedAreaIndex
      },
      geometry: { type: 'Point', coordinates: coords }
    });
  });

  const source = map.getSource(AREA_LABEL_SOURCE_ID);
  if (source) source.setData({ type: 'FeatureCollection', features: puntos });

  bringAreaToFront();
}

function limpiarSeleccion() {
  const map = getMap();
  if (!map || !map.getSource(AREA_SOURCE_ID) || selectedAreaIndex === null) return;
  try {
    map.setFeatureState({ source: AREA_SOURCE_ID, id: selectedAreaIndex }, { selected: false });
  } catch (_) { /* fuente recién recreada */ }
  selectedAreaIndex = null;
}

function ajustarVista(features) {
  const map = getMap();
  if (!map || !features?.length) return;
  try {
    const bbox = turf.bbox({ type: 'FeatureCollection', features });
    if (!bbox.every((n) => Number.isFinite(n))) return;
    map.fitBounds(bbox, { padding: 70, duration: 1400, maxZoom: 13 });
  } catch (_) { /* geometría inválida */ }
}

function aplicarColeccion(collection, { labelKey, fileName, sourceType, fit = true }) {
  const map = asegurarCapa();
  if (!map) return;

  limpiarSeleccion();

  areaCollection = collection;
  areaLabelKey = labelKey || null;
  areaFileName = fileName || '';
  areaSourceType = sourceType || 'file';

  const source = map.getSource(AREA_SOURCE_ID);
  if (source) source.setData(collection);

  recalcularPosicionesEtiquetas();
  renderAreaLabels();

  try {
    map.moveLayer(AREA_LINE_LAYER_ID);
    map.moveLayer(AREA_LABEL_LAYER_ID);
  } catch (_) { /* ignorar */ }

  if (fit) ajustarVista(collection.features);
}

/**
 * Carga un archivo y lo convierte en el área activa.
 * Devuelve la metadata necesaria para actualizar la interfaz.
 */
export async function loadAreaFromFile(file) {
  const parsed = await parseAreaFile(file);
  aplicarColeccion(parsed.collection, {
    labelKey: parsed.labelKey,
    fileName: parsed.fileName,
    sourceType: 'file',
    fit: true
  });
  return { ...parsed, fileName: parsed.fileName, sourceType: 'file' };
}

/**
 * Usa un polígono dibujado como área activa, reemplazando la anterior.
 * Devuelve la metadata de la nueva capa.
 */
export function setDrawnArea(feature) {
  const featureConEtiqueta = {
    type: 'Feature',
    properties: {
      ...(feature.properties || {}),
      __area_label: 'Polígono dibujado'
    },
    geometry: feature.geometry
  };
  const collection = { type: 'FeatureCollection', features: [featureConEtiqueta] };

  aplicarColeccion(collection, {
    labelKey: '__area_label',
    fileName: 'Polígono dibujado',
    sourceType: 'drawn',
    fit: true
  });

  return {
    collection,
    fieldKeys: [],
    labelKey: '__area_label',
    fileName: 'Polígono dibujado',
    sourceType: 'drawn',
    skipped: 0
  };
}

export function clearAreaLayer() {
  const map = getMap();
  if (!map) return;
  limpiarSeleccion();
  try {
    if (map.getLayer(AREA_LABEL_LAYER_ID)) map.removeLayer(AREA_LABEL_LAYER_ID);
    if (map.getSource(AREA_LABEL_SOURCE_ID)) map.removeSource(AREA_LABEL_SOURCE_ID);
    if (map.getLayer(AREA_LINE_LAYER_ID)) map.removeLayer(AREA_LINE_LAYER_ID);
    if (map.getSource(AREA_SOURCE_ID)) map.removeSource(AREA_SOURCE_ID);
  } catch (_) { /* fuente en uso */ }

  areaCollection = null;
  areaLabelKey = null;
  areaFileName = '';
  areaSourceType = '';
  selectedAreaIndex = null;
  areaLabelPositions = [];
}

export function selectAreaFeature(index) {
  const map = getMap();
  if (!map || !map.getSource(AREA_SOURCE_ID)) return;

  if (selectedAreaIndex !== null) {
    try {
      map.setFeatureState({ source: AREA_SOURCE_ID, id: selectedAreaIndex }, { selected: false });
    } catch (_) { /* ignorar */ }
  }

  selectedAreaIndex = Number.isInteger(index) ? index : null;
  if (selectedAreaIndex !== null) {
    try {
      map.setFeatureState({ source: AREA_SOURCE_ID, id: selectedAreaIndex }, { selected: true });
    } catch (_) { /* ignorar */ }
  }

  renderAreaLabels();
  bringAreaToFront();
}

export function bringAreaToFront() {
  const map = getMap();
  if (!map) return;
  try {
    if (map.getLayer(AREA_LINE_LAYER_ID)) map.moveLayer(AREA_LINE_LAYER_ID);
    if (map.getLayer(AREA_LABEL_LAYER_ID)) map.moveLayer(AREA_LABEL_LAYER_ID);
  } catch (_) { /* ignorar */ }
}

export function getAreaCollection() {
  return areaCollection;
}

export function getAreaFeatures() {
  return areaCollection?.features || [];
}

export function getAreaFeature(index) {
  return getAreaFeatures()[index] || null;
}

export function getSelectedAreaIndex() {
  return selectedAreaIndex;
}

export function getAreaLabelKey() {
  return areaLabelKey;
}

export function setAreaLabelKey(key) {
  areaLabelKey = key || null;
  renderAreaLabels();
}

export function getAreaFileName() {
  return areaFileName;
}

export function getAreaSourceType() {
  return areaSourceType;
}

export function hasAreaLayer() {
  return Boolean(areaCollection?.features?.length);
}

export function getAreaFieldKeys() {
  return obtenerClavesCampos(getAreaFeatures());
}

export function getAreaLabel(feature, index) {
  if (!feature) return `Entidad ${index + 1}`;
  const props = feature.properties || {};

  if (areaLabelKey) {
    const valor = props[areaLabelKey];
    if (valor !== null && valor !== undefined && String(valor).trim() !== '') {
      return String(valor).trim();
    }
  }

  return `Entidad ${index + 1}`;
}

export const AREA_COLORS = {
  base: AREA_BASE_COLOR,
  selected: AREA_SELECTED_COLOR
};
