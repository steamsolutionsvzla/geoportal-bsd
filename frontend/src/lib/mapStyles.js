// src/lib/mapStyles.js
// Helpers para aplicar estilos guardados en MapLibre.

/** Ids candidatos según el tipo. Para puntos, incluye sub-capas de cluster. */
function candidateLayerIds(baseId, type) {
  const t = (type || '').toLowerCase();
  if (t === 'circle' || t === 'point') {
    return [
      baseId,
      `${baseId}-cluster-count`,
      `${baseId}-clusters`,
      `${baseId}-unclustered`,
    ];
  }
  return [baseId];
}

/**
 * Aplica un estilo a una capa ya añadida al mapa.
 * @param {import('maplibre-gl').Map} map
 * @param {string} baseId  Id base de la capa (ej: `layer-Petróleo:pozos`)
 * @param {string} type    'circle' | 'line' | 'fill'
 * @param {object} style   Estilo guardado
 * @param {number} [defaultMinZoom=0]
 * @param {number} [defaultMaxZoom=22]
 */
export function applyStyle(map, baseId, type, style, defaultMinZoom = 0, defaultMaxZoom = 22) {
  if (!style) return;
  const t = (type || '').toLowerCase();
  const ids = candidateLayerIds(baseId, t);

  for (const id of ids) {
    if (!map.getLayer(id)) continue;

    try {
      if (t === 'fill') {
        if (style.fill_color)   map.setPaintProperty(id, 'fill-color', style.fill_color);
        if (style.opacity != null) map.setPaintProperty(id, 'fill-opacity', style.opacity);
        if (style.stroke_color) map.setPaintProperty(id, 'fill-outline-color', style.stroke_color);
      } else if (t === 'line') {
        if (style.stroke_color) map.setPaintProperty(id, 'line-color', style.stroke_color);
        if (style.line_width != null) map.setPaintProperty(id, 'line-width', style.line_width);
      } else if (t === 'circle' || t === 'point') {
        // En capas de cluster, aplicamos a las 3 sub-capas.
        // -clusters (cluster): cambia color de burbuja
        // -unclustered (punto individual): cambia color del punto
        // -cluster-count (texto): no aplica paint de color, se ignora
        if (style.fill_color) {
          if (id.endsWith('-clusters') || id.endsWith('-unclustered') || id === baseId) {
            map.setPaintProperty(id, 'circle-color', style.fill_color);
          }
        }
        if (style.opacity != null) {
          if (id.endsWith('-clusters') || id.endsWith('-unclustered') || id === baseId) {
            map.setPaintProperty(id, 'circle-opacity', style.opacity);
          }
        }
        if (style.stroke_color) {
          if (id.endsWith('-clusters') || id.endsWith('-unclustered') || id === baseId) {
            map.setPaintProperty(id, 'circle-stroke-color', style.stroke_color);
          }
        }
        if (style.line_width != null) {
          if (id.endsWith('-unclustered') || id === baseId) {
            map.setPaintProperty(id, 'circle-stroke-width', style.line_width);
          }
        }
      }
    } catch (_) { /* prop no aplicable */ }

    try {
      map.setLayerZoomRange(id, style.min_zoom ?? defaultMinZoom, style.max_zoom ?? defaultMaxZoom);
    } catch (_) { /* ignore */ }
  }
}