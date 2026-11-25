// data-packages.js
// Crea un paquete de datos en Odoo a partir del filtro poligonal activo.
// El backend calcula los archivos indexados y Odoo guarda la selección.
import { apiFetch } from './utils.js';

async function leerError(response) {
  try {
    const text = await response.text();
    if (!text) return `Error ${response.status}`;
    try {
      const data = JSON.parse(text);
      if (data && data.detail) {
        return typeof data.detail === 'string'
          ? data.detail
          : JSON.stringify(data.detail);
      }
    } catch (_) { /* no era JSON */ }
    return text.slice(0, 400);
  } catch (_) {
    return `Error ${response.status}`;
  }
}

/**
 * Guarda el área activa como paquete de datos.
 *
 * @param {object} opts
 * @param {string} opts.name             Nombre del paquete.
 * @param {object} opts.geometry         Polígono del área (GeoJSON).
 * @param {object} [opts.maskGeometry]   Polígono de intersección.
 * @param {Array}  opts.layers           [{id, name}] de capas con hits.
 * @param {string} [opts.label]          Etiqueta del área.
 * @param {string} [opts.polygonEntity]  Entidad de la poligonal.
 * @param {string} [opts.stateEntity]    Estado/entidad de la intersección.
 */
export async function createDataPackage({
  name,
  geometry,
  maskGeometry = null,
  layers,
  label = 'Área',
  polygonEntity = '',
  stateEntity = '',
}) {
  if (!geometry) throw new Error('No hay un área activa para guardar.');
  if (!Array.isArray(layers) || !layers.length) {
    throw new Error('No hay capas con datos dentro del área.');
  }
  const response = await apiFetch('/api/v1/data-packages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      geometry,
      mask_geometry: maskGeometry || null,
      layers: layers.map((layer) => ({
        id: layer.id,
        name: layer.name || '',
      })),
      label,
      polygon_entity: polygonEntity,
      state_entity: stateEntity,
    }),
    signal: AbortSignal.timeout(15 * 60 * 1000),
  });
  if (!response.ok) {
    throw new Error(await leerError(response));
  }
  return response.json();
}
