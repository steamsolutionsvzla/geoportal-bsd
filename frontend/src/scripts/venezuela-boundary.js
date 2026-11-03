// venezuela-boundary.js
// ---------------------------------------------------------------------------
// Contorno nacional oficial de Venezuela (incluye Guayana Esequiba) y
// ocultamiento de la frontera de facto que dibujan algunos mapas base online.
//
// La geometría oficial está en src/assets/venezuela-oficial.json y se
// dibuja solo como línea: sin relleno y sin etiqueta de "zona en reclamación".
// ---------------------------------------------------------------------------
import venezuelaOficial from '../assets/venezuela-oficial.json';

const OFFICIAL_SOURCE = 'source-venezuela-oficial';
const OFFICIAL_CASING_LAYER = 'layer-venezuela-oficial-casing';
const OFFICIAL_LAYER = 'layer-venezuela-oficial-outline';

const ERASE_SOURCE = 'source-venezuela-frontera-facto';
const ERASE_LAYER = 'layer-venezuela-frontera-erase';

const ERASE_GUYANA_SURINAME_SOURCE = 'source-guyana-suriname-erase';
const ERASE_GUYANA_SURINAME_LAYER = 'layer-guyana-suriname-erase';

const BOUNDARY_COLOR = '#93a8bd';
const ERASE_COLOR = '#fafaf8';

// Frontera de facto Venezuela–Guyana. Solo se usa para tapar la línea que
// pinta el mapa base claro; no forma parte del contorno oficial.
const FRONTERA_DE_FACTO = [
  [-60.742139,5.202051],[-60.954004,5.437402],[-61.167187,5.674219],[-61.376807,5.906982],
  [-61.390820,5.938770],[-61.303125,6.049512],[-61.224951,6.129199],[-61.159473,6.174414],
  [-61.128711,6.214307],[-61.152295,6.385107],[-61.151025,6.446533],[-61.181592,6.513379],
  [-61.203613,6.588379],[-61.177246,6.650928],[-61.145605,6.694531],[-61.104785,6.711377],
  [-61.007080,6.726611],[-60.937988,6.732764],[-60.913574,6.757812],[-60.873340,6.786914],
  [-60.820850,6.788477],[-60.717920,6.768311],[-60.671045,6.805957],[-60.586084,6.857080],
  [-60.395020,6.945361],[-60.352100,7.002881],[-60.322070,7.092041],[-60.325488,7.133984],
  [-60.345068,7.150000],[-60.392383,7.164551],[-60.464941,7.166553],[-60.523193,7.143701],
  [-60.583203,7.156201],[-60.633301,7.211084],[-60.636182,7.256592],[-60.606543,7.320850],
  [-60.623730,7.363330],[-60.719238,7.498682],[-60.718652,7.535937],[-60.649463,7.596631],
  [-60.610107,7.648340],[-60.556348,7.772021],[-60.513623,7.813184],[-60.380615,7.827637],
  [-60.346777,7.854004],[-60.278906,7.919434],[-60.178174,7.994043],[-60.032422,8.053564],
  [-59.990723,8.162012],[-59.964844,8.191602],[-59.849072,8.248682],[-59.828906,8.279150],
  [-59.831641,8.305957],[-59.836523,8.373828],
  [-59.756738,8.339502],[-59.739941,8.338721],[-59.739307,8.379980],[-59.666113,8.362598]
];

// Frontera Guyana–Suriname que pinta CARTO. Se tapa con una línea del color
// del fondo para que no compita con la delimitación oficial.
const FRONTERA_GUYANA_SURINAME = [
  [-57.150, 6.050],
  [-57.147, 5.973],
  [-57.220, 5.600],
  [-57.307, 5.074],
  [-57.300, 4.500],
  [-57.290, 4.000],
  [-57.281, 3.333],
  [-57.220, 3.000],
  [-57.150, 2.769],
  [-57.250, 2.300],
  [-57.336, 1.949],
  [-56.900, 1.900]
];

export function addVenezuelaBoundaryLayers(map) {
  if (!map.getSource(OFFICIAL_SOURCE)) {
    map.addSource(OFFICIAL_SOURCE, {
      type: 'geojson',
      data: venezuelaOficial
    });
  }

  if (!map.getSource(ERASE_SOURCE)) {
    map.addSource(ERASE_SOURCE, {
      type: 'geojson',
      data: {
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: FRONTERA_DE_FACTO }
      }
    });
  }

  if (!map.getSource(ERASE_GUYANA_SURINAME_SOURCE)) {
    map.addSource(ERASE_GUYANA_SURINAME_SOURCE, {
      type: 'geojson',
      data: {
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: FRONTERA_GUYANA_SURINAME }
      }
    });
  }

  // Casing blanco: hace visible el contorno sobre satélite y relieve.
  if (!map.getLayer(OFFICIAL_CASING_LAYER)) {
    map.addLayer({
      id: OFFICIAL_CASING_LAYER,
      type: 'line',
      source: OFFICIAL_SOURCE,
      layout: { visibility: 'visible' },
      paint: {
        'line-color': '#ffffff',
        'line-width': [
          'interpolate', ['linear'], ['zoom'],
          4, 2.2,
          8, 3,
          12, 4
        ],
        'line-opacity': 0.32
      }
    });
  }

  if (!map.getLayer(OFFICIAL_LAYER)) {
    map.addLayer({
      id: OFFICIAL_LAYER,
      type: 'line',
      source: OFFICIAL_SOURCE,
      layout: { visibility: 'visible' },
      paint: {
        'line-color': BOUNDARY_COLOR,
        'line-width': [
          'interpolate', ['linear'], ['zoom'],
          4, 0.8,
          8, 1.1,
          12, 1.5
        ],
        'line-opacity': 0.7
      }
    });
  }

  if (!map.getLayer(ERASE_LAYER)) {
    map.addLayer({
      id: ERASE_LAYER,
      type: 'line',
      source: ERASE_SOURCE,
      layout: { visibility: 'none' },
      paint: {
        'line-color': ERASE_COLOR,
        'line-width': [
          'interpolate', ['linear'], ['zoom'],
          5, 6,
          8, 9,
          11, 12,
          13, 16,
          16, 24
        ],
        'line-blur': 0.6
      }
    });
  }

  if (!map.getLayer(ERASE_GUYANA_SURINAME_LAYER)) {
    map.addLayer({
      id: ERASE_GUYANA_SURINAME_LAYER,
      type: 'line',
      source: ERASE_GUYANA_SURINAME_SOURCE,
      layout: { visibility: 'none' },
      paint: {
        'line-color': ERASE_COLOR,
        'line-width': [
          'interpolate', ['linear'], ['zoom'],
          5, 6,
          8, 9,
          11, 12,
          13, 16,
          16, 24
        ],
        'line-blur': 0.6
      }
    });
  }

  bringVenezuelaBoundaryToFront(map);
}

export function actualizarFronteraOficial(map, basemapActivo) {
  // El fondo estándar actual (Esri Terrain Base) no pinta fronteras
  // políticas; las líneas de borrado quedan desactivadas.
  const visibilidadBorrado = 'none';

  if (map.getLayer(OFFICIAL_CASING_LAYER)) {
    map.setLayoutProperty(OFFICIAL_CASING_LAYER, 'visibility', 'visible');
  }
  if (map.getLayer(OFFICIAL_LAYER)) {
    map.setLayoutProperty(OFFICIAL_LAYER, 'visibility', 'visible');
  }
  if (map.getLayer(ERASE_LAYER)) {
    map.setLayoutProperty(ERASE_LAYER, 'visibility', visibilidadBorrado);
  }
  if (map.getLayer(ERASE_GUYANA_SURINAME_LAYER)) {
    map.setLayoutProperty(ERASE_GUYANA_SURINAME_LAYER, 'visibility', visibilidadBorrado);
  }
}

export function bringVenezuelaBoundaryToFront(map) {
  // Orden final: borrados abajo, casing en medio, contorno oficial arriba.
  if (map.getLayer(ERASE_LAYER)) {
    try { map.moveLayer(ERASE_LAYER); } catch (_) { /* ignorar */ }
  }
  if (map.getLayer(ERASE_GUYANA_SURINAME_LAYER)) {
    try { map.moveLayer(ERASE_GUYANA_SURINAME_LAYER); } catch (_) { /* ignorar */ }
  }
  if (map.getLayer(OFFICIAL_CASING_LAYER)) {
    try { map.moveLayer(OFFICIAL_CASING_LAYER); } catch (_) { /* ignorar */ }
  }
  if (map.getLayer(OFFICIAL_LAYER)) {
    try { map.moveLayer(OFFICIAL_LAYER); } catch (_) { /* ignorar */ }
  }
}
