// map-labels.js
// ---------------------------------------------------------------------------
// Etiquetas fijas de países y océanos para el visor.
// Se mantienen independientes de las etiquetas de estados.
// ---------------------------------------------------------------------------
const COUNTRY_LABELS = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { label: 'COLOMBIA', size: 15, maxWidth: 7, letterSpacing: 0.18 },
      geometry: { type: 'Point', coordinates: [-72.8, 4.5] }
    },
    {
      type: 'Feature',
      properties: { label: 'BRASIL', size: 15, maxWidth: 7, letterSpacing: 0.18 },
      geometry: { type: 'Point', coordinates: [-62.2, 1.2] }
    },
    {
      type: 'Feature',
      properties: { label: 'TRINIDAD Y TOBAGO', size: 10, maxWidth: 6, letterSpacing: 0.08 },
      geometry: { type: 'Point', coordinates: [-61.1, 10.65] }
    },
    {
      // Al este del río Esequibo: la parte reclamada se rotula como estado.
      properties: { label: 'GUYANA', size: 12, maxWidth: 6, letterSpacing: 0.12 },
      geometry: { type: 'Point', coordinates: [-57.9, 5.0] }
    },
    {
      type: 'Feature',
      properties: { label: 'MAR CARIBE', size: 14, maxWidth: 10, letterSpacing: 0.25 },
      geometry: { type: 'Point', coordinates: [-66.8, 13.2] }
    },
    {
      type: 'Feature',
      properties: { label: 'OCÉANO ATLÁNTICO', size: 13, maxWidth: 9, letterSpacing: 0.18 },
      geometry: { type: 'Point', coordinates: [-59.4, 11.3] }
    }
  ]
};

const COUNTRY_SOURCE_ID = 'source-country-labels';
const COUNTRY_LAYER_ID = 'layer-country-labels';

export function addCountryLabels(map) {
  if (!map.getSource(COUNTRY_SOURCE_ID)) {
    map.addSource(COUNTRY_SOURCE_ID, {
      type: 'geojson',
      data: COUNTRY_LABELS
    });
  }

  if (!map.getLayer(COUNTRY_LAYER_ID)) {
    map.addLayer({
      id: COUNTRY_LAYER_ID,
      type: 'symbol',
      source: COUNTRY_SOURCE_ID,
      layout: {
        'text-field': ['get', 'label'],
        'text-font': ['Open Sans Regular'],
        'text-size': ['get', 'size'],
        'text-max-width': ['get', 'maxWidth'],
        'text-letter-spacing': ['get', 'letterSpacing'],
        'text-transform': 'uppercase',
        'text-line-height': 1.1,
        'text-allow-overlap': true,
        'text-ignore-placement': true,
        'text-padding': 4,
        'text-justify': 'center',
        'text-anchor': 'center'
      },
      paint: {
        'text-color': '#334155',
        'text-halo-color': '#ffffff',
        'text-halo-width': 1.6,
        'text-opacity': 0.9
      }
    });
  }

  bringCountryLabelsToFront(map);
}

export function bringCountryLabelsToFront(map) {
  if (!map || !map.getLayer(COUNTRY_LAYER_ID)) return;
  try {
    map.moveLayer(COUNTRY_LAYER_ID);
  } catch (_) { /* ignorar */ }
}
