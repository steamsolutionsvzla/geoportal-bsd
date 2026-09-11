// feature-popup.js
// Cuadros flotantes con los atributos de una entidad (feature) clickeada en
// el mapa. Cada popup es independiente: se pueden abrir varios a la vez (uno
// por feature) y cada uno se cierra con su propio botón "X", sin afectar a
// los demás ni al panel de información (que muestra metadatos de la capa).

// Registro de los popups actualmente abiertos, para poder detectar solapes
// entre ellos cuando se abre uno nuevo.
const openPopups = [];

// Orden de preferencia de "anclas": el lado por el que nace la puntita del
// popup. Cambiar de ancla NO mueve la puntita respecto al punto seleccionado
// (siempre queda pegada a él); solo cambia hacia qué lado se abre la caja.
const ANCHOR_ORDER = [
  'bottom', 'top', 'right', 'left',
  'bottom-right', 'bottom-left', 'top-right', 'top-left'
];

const TIP_SIZE = 10; // debe aproximar el tamaño real de .maplibregl-popup-tip

function buildFeaturePopupHtml(displayName, props) {
  let rowsHtml = '';
  for (let key in props) {
    const lowerKey = key.toLowerCase();
    const isExcluded = ['id', 'geoid', 'gid', 'objectid'].includes(lowerKey) || lowerKey.endsWith('_id') || lowerKey.startsWith('id_');
    if (!isExcluded) {
      rowsHtml += `
        <div class="feature-popup-row">
          <span class="feature-popup-key">${key}</span>
          <span class="feature-popup-value">${props[key]}</span>
        </div>
      `;
    }
  }
  if (!rowsHtml) {
    rowsHtml = `<p class="feature-popup-empty">Sin atributos disponibles.</p>`;
  }
  return `
    <div class="feature-popup">
      <div class="feature-popup-title">${displayName}</div>
      <div class="feature-popup-body">${rowsHtml}</div>
    </div>
  `;
}

/**
 * Renderiza el HTML del popup fuera de pantalla, con las mismas clases/estilos
 * reales, para medir su ancho y alto antes de decidir en qué lado abrirlo.
 */
function measurePopupSize(html) {
  const probe = document.createElement('div');
  probe.style.position = 'absolute';
  probe.style.visibility = 'hidden';
  probe.style.pointerEvents = 'none';
  probe.style.left = '-9999px';
  probe.style.top = '-9999px';
  probe.className = 'maplibregl-popup feature-attr-popup';
  probe.innerHTML = `<div class="maplibregl-popup-content" style="max-width:240px;">${html}</div>`;
  document.body.appendChild(probe);
  const rect = probe.getBoundingClientRect();
  document.body.removeChild(probe);
  return { width: rect.width, height: rect.height };
}

/** Rectángulo en pantalla que ocuparía el popup si se abre con esa ancla, en ese punto. */
function rectFor(anchor, point, size) {
  const { width: w, height: h } = size;
  let left, top;
  switch (anchor) {
    case 'bottom':       left = point.x - w / 2; top = point.y - h - TIP_SIZE; break;
    case 'top':          left = point.x - w / 2; top = point.y + TIP_SIZE;     break;
    case 'left':         left = point.x + TIP_SIZE;     top = point.y - h / 2; break;
    case 'right':        left = point.x - w - TIP_SIZE; top = point.y - h / 2; break;
    case 'bottom-right': left = point.x;     top = point.y - h - TIP_SIZE;     break;
    case 'bottom-left':  left = point.x - w; top = point.y - h - TIP_SIZE;     break;
    case 'top-right':    left = point.x;     top = point.y + TIP_SIZE;         break;
    case 'top-left':     left = point.x - w; top = point.y + TIP_SIZE;         break;
    default:              left = point.x - w / 2; top = point.y - h - TIP_SIZE;
  }
  return { left, top, right: left + w, bottom: top + h };
}

function rectsOverlap(a, b) {
  return !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
}

/** Elige la primera ancla, en orden de preferencia, que no choque con ningún popup ya abierto. */
function pickAnchor(map, lngLat, size) {
  const point = map.project(lngLat);
  const openRects = openPopups
    .map((p) => p.getElement())
    .filter(Boolean)
    .map((el) => el.getBoundingClientRect());

  for (const anchor of ANCHOR_ORDER) {
    const rect = rectFor(anchor, point, size);
    const overlaps = openRects.some((r) => rectsOverlap(rect, r));
    if (!overlaps) return anchor;
  }
  // Si todas se solapan (muchos popups muy juntos), se usa la ancla por
  // defecto; la puntita sigue apuntando correctamente, solo puede haber
  // superposición visual entre las cajas.
  return ANCHOR_ORDER[0];
}

/**
 * Abre un popup flotante sobre el mapa con los atributos del feature.
 * @param {maplibregl.Map} map
 * @param {string} displayName - Nombre legible de la capa a la que pertenece el feature.
 * @param {Object} props - Atributos del feature.
 * @param {maplibregl.LngLat|{lng:number,lat:number}} lngLat - Coordenada donde se hizo click.
 * @returns {maplibregl.Popup}
 */
export function openFeaturePopup(map, displayName, props, lngLat) {
  const html = buildFeaturePopupHtml(displayName, props);
  const size = measurePopupSize(html);
  const anchor = pickAnchor(map, lngLat, size);

  const popup = new maplibregl.Popup({
    closeButton: true,
    closeOnClick: false,
    closeOnMove: false,
    className: 'feature-attr-popup',
    maxWidth: '240px',
    anchor // <- el popup "nace" por el lado libre, pero la puntita
           //    siempre queda pegada al punto seleccionado
  })
    .setLngLat(lngLat)
    .setHTML(html)
    .addTo(map);

  openPopups.push(popup);

  popup.on('close', () => {
    const idx = openPopups.indexOf(popup);
    if (idx !== -1) openPopups.splice(idx, 1);
  });

  return popup;
}