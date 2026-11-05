// src/lib/mapStyles.js
// Helpers para aplicar estilos guardados en MapLibre.

/** Ids candidatos según el tipo. */
function candidateLayerIds(baseId, type) {
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
        if (style.fill_color) {
          map.setPaintProperty(id, 'fill-color', [
            'case',
            ['boolean', ['feature-state', 'selected'], false], '#facc15',
            style.fill_color,
          ]);
        }
        if (style.has_fill === false) {
          map.setPaintProperty(id, 'fill-opacity', [
            'case',
            ['boolean', ['feature-state', 'selected'], false], 0.55,
            0,
          ]);
        } else if (style.opacity != null) {
          map.setPaintProperty(id, 'fill-opacity', style.opacity);
        }
        if (style.stroke_color) {
          map.setPaintProperty(id, 'fill-outline-color', [
            'case',
            ['boolean', ['feature-state', 'selected'], false], '#b45309',
            style.stroke_color,
          ]);
        }
      } else if (t === 'line') {
        if (style.stroke_color) {
          map.setPaintProperty(id, 'line-color', [
            'case',
            ['boolean', ['feature-state', 'selected'], false], '#facc15',
            style.stroke_color,
          ]);
        }
        if (style.line_width != null) {
          map.setPaintProperty(id, 'line-width', [
            'case',
            ['boolean', ['feature-state', 'selected'], false],
            Math.max(Number(style.line_width) + 2, 4),
            style.line_width,
          ]);
        }
        if (style.opacity != null) {
          map.setPaintProperty(id, 'line-opacity', [
            'case',
            ['boolean', ['feature-state', 'selected'], false], 1,
            style.opacity,
          ]);
        }
      } else if (t === 'circle' || t === 'point') {
        if (style.fill_color) {
          map.setPaintProperty(id, 'circle-color', [
            'case',
            ['boolean', ['feature-state', 'selected'], false], '#facc15',
            style.fill_color,
          ]);
        }
        if (style.opacity != null) {
          map.setPaintProperty(id, 'circle-opacity', [
            'case',
            ['boolean', ['feature-state', 'selected'], false], 1,
            style.opacity,
          ]);
        }
        if (style.stroke_color) {
          map.setPaintProperty(id, 'circle-stroke-color', [
            'case',
            ['boolean', ['feature-state', 'selected'], false], '#b45309',
            style.stroke_color,
          ]);
        }
        if (style.line_width != null) {
          map.setPaintProperty(id, 'circle-stroke-width', [
            'case',
            ['boolean', ['feature-state', 'selected'], false],
            Math.max(Number(style.line_width) + 2, 3),
            style.line_width,
          ]);
        }
      }
    } catch (_) { /* prop no aplicable */ }

    try {
      map.setLayerZoomRange(id, style.min_zoom ?? defaultMinZoom, style.max_zoom ?? defaultMaxZoom);
    } catch (_) { /* ignore */ }
  }
}