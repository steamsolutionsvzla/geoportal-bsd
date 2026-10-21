// estado-labels.js - Etiquetas de estados (siempre visibles en todos los mapas)
import * as turf from '@turf/turf';
import { apiFetch, obtenerNombreEstado } from './utils.js';

export const ESTADOS_LAYER_NAME = 'División Político Territorial';
export const ESTADO_LABEL_SOURCE_ID = 'source-estados-venezuela-labels';
export const ESTADO_LABEL_LAYER_ID = 'layer-estados-venezuela-label';

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

/**
 * Agrupa los polígonos por nombre de estado (1 feature por estado) y
 * calcula un centroide por estado: la fuente de las etiquetas.
 * Devuelve { featuresAgrupados, puntosEtiquetas }.
 */
export function construirCentroidesEstados(data) {
  const featuresByName = {};
  data.features.forEach(f => {
    const nombre = obtenerNombreEstado(f.properties);
    if (!nombre) return;
    if (!featuresByName[nombre]) {
      featuresByName[nombre] = {
        type: 'Feature',
        properties: { ...f.properties },
        geometry: { type: 'MultiPolygon', coordinates: [] }
      };
    }
    if (f.geometry.type === 'Polygon') {
      featuresByName[nombre].geometry.coordinates.push(f.geometry.coordinates);
    } else if (f.geometry.type === 'MultiPolygon') {
      f.geometry.coordinates.forEach(coords => {
        featuresByName[nombre].geometry.coordinates.push(coords);
      });
    }
  });

  const featuresAgrupados = Object.values(featuresByName);
  const puntosEtiquetas = { type: 'FeatureCollection', features: [] };
  featuresAgrupados.forEach(f => {
    try {
      const centroide = turf.centerOfMass(f);
      centroide.properties = { ...f.properties };
      puntosEtiquetas.features.push(centroide);
    } catch (e) {}
  });

  return { featuresAgrupados, puntosEtiquetas };
}

/**
 * Crea (o actualiza) la capa de etiquetas de estados. Siempre visible:
 * no depende del toggle de la capa ni de show_labels.
 * allow-overlap:true garantiza que TODOS los nombres se muestren.
 */
export function agregarEtiquetasEstadosMapa(map, puntosEtiquetas, styleEstados) {
  if (!map || !puntosEtiquetas || !puntosEtiquetas.features.length) return;

  const propPrimer = puntosEtiquetas.features[0]?.properties || {};
  const attrEstados = styleEstados?.label_attribute || 'entidad';
  // Primero el atributo configurado; si no existe, otros alias comunes
  const claveEstados =
    resolverClaveProp(propPrimer, attrEstados) ||
    ['entidad', 'estado', 'nombre', 'name']
      .map(alias => resolverClaveProp(propPrimer, alias))
      .find(Boolean) ||
    attrEstados;
  const colorEtiqueta = styleEstados?.label_color || '#1a2a3a';

  if (map.getSource(ESTADO_LABEL_SOURCE_ID)) {
    map.getSource(ESTADO_LABEL_SOURCE_ID).setData(puntosEtiquetas);
  } else {
    map.addSource(ESTADO_LABEL_SOURCE_ID, {
      type: 'geojson',
      data: puntosEtiquetas,
      generateId: true
    });
  }

  if (map.getLayer(ESTADO_LABEL_LAYER_ID)) {
    map.setLayoutProperty(ESTADO_LABEL_LAYER_ID, 'text-field', ['get', claveEstados]);
    map.setLayoutProperty(ESTADO_LABEL_LAYER_ID, 'visibility', 'visible');
    map.setPaintProperty(ESTADO_LABEL_LAYER_ID, 'text-color', colorEtiqueta);
    return;
  }

  map.addLayer({
    id: ESTADO_LABEL_LAYER_ID,
    type: 'symbol',
    source: ESTADO_LABEL_SOURCE_ID,
    layout: {
      'visibility': 'visible',
      'text-field': ['get', claveEstados],
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
      'text-allow-overlap': true,
      'text-ignore-placement': true,
      'text-justify': 'center',
      'symbol-placement': 'point'
    },
    paint: {
      'text-color': colorEtiqueta,
      'text-halo-color': '#ffffff',
      'text-halo-width': [
        'interpolate', ['linear'], ['zoom'],
        3, 1,
        10, 1.8,
      ],
    }
  });
}

/**
 * Descarga la capa de estados y agrega solo las etiquetas al mapa.
 * Para páginas sin carga completa de estados (showroom, analista, preview).
 * Nunca lanza: si el usuario no tiene acceso, se omite en silencio.
 */
export async function cargarSoloEtiquetasEstados(map, styleEstados) {
  if (!map) return;
  try {
    const response = await apiFetch(`/api/v1/layers/${encodeURIComponent(ESTADOS_LAYER_NAME)}`);
    if (!response.ok) throw new Error(`Error ${response.status}: ${response.statusText}`);
    const data = await response.json();
    const { puntosEtiquetas } = construirCentroidesEstados(data);
    agregarEtiquetasEstadosMapa(map, puntosEtiquetas, styleEstados);
  } catch (e) {
    console.warn('No se pudieron cargar las etiquetas de estados:', e);
  }
}

/**
 * Deja la capa de etiquetas de estados encima de todo (capas agregadas
 * después no deben taparla).
 */
export function subirEtiquetasEstados(map) {
  try {
    if (map && map.getLayer(ESTADO_LABEL_LAYER_ID)) {
      map.moveLayer(ESTADO_LABEL_LAYER_ID);
    }
  } catch (e) {}
}
