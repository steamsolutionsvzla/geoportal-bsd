// feature-popup.js
import * as maplibregl from 'maplibre-gl';

let activePopup = null;
let activeLayerId = null;
let activeCleanup = null;

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

/**
 * Resuelve la clave real en props aunque el caso no coincida
 * (PostGIS/GeoServer puede devolver minúsculas aunque se guardó MAYÚSCULAS).
 */
function resolverClaveProp(props, key) {
  if (!props || typeof key !== 'string') return null;
  if (Object.prototype.hasOwnProperty.call(props, key)) return key;
  const lower = key.toLowerCase();
  for (const k of Object.keys(props)) {
    if (k.toLowerCase() === lower) return k;
  }
  return null;
}

function fmtVal(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') {
    return Number.isInteger(v)
      ? v.toLocaleString('es-VE')
      : v.toLocaleString('es-VE', { maximumFractionDigits: 6 });
  }
  if (typeof v === 'boolean') return v ? 'Sí' : 'No';
  if (typeof v === 'object') {
    try { return JSON.stringify(v); } catch { return String(v); }
  }
  return String(v);
}

function buildFeaturePopupHtml(displayName, props, visibleAttributes, attributeLabels = null) {
  let rowsHtml = '';

  const etiqueta = (key) => {
    const custom =
      attributeLabels?.[key] ??
      attributeLabels?.[key.toLowerCase()] ??
      Object.entries(attributeLabels || {}).find(
        ([k]) => k.toLowerCase() === key.toLowerCase(),
      )?.[1];
    return typeof custom === 'string' && custom.trim() ? custom.trim() : key;
  };

  const hasCustomList =
    Array.isArray(visibleAttributes) && visibleAttributes.length > 0;

  const pushRow = (key, realKey) => {
    const raw = props[realKey];
    const val = fmtVal(raw);
    const shown = val === '' ? '—' : val;
    rowsHtml += `
      <div class="fp-row">
        <span class="fp-key">${escapeHtml(etiqueta(key))}</span>
        <span class="fp-val">${escapeHtml(shown)}</span>
      </div>`;
  };

  if (hasCustomList) {
    // Modo "configurado por el analista": respeta la lista (tolerante a mayúsculas)
    for (const key of visibleAttributes) {
      const realKey = resolverClaveProp(props, key);
      if (realKey) pushRow(key, realKey);
    }
  } else {
    // Modo por defecto: excluir ids
    for (const key of Object.keys(props || {})) {
      const lowerKey = key.toLowerCase();
      const isExcluded =
        ['id', 'geoid', 'gid', 'objectid'].includes(lowerKey) ||
        lowerKey.endsWith('_id') ||
        lowerKey.startsWith('id_');
      if (!isExcluded) pushRow(key, key);
    }
  }

  if (!rowsHtml) {
    rowsHtml = `<p class="fp-empty">Sin atributos disponibles.</p>`;
  }

  return `
    <div class="fp">
      <div class="fp-head">
        <span class="fp-badge">Atributos</span>
        <span class="fp-title">${escapeHtml(displayName)}</span>
      </div>
      <div class="fp-body">${rowsHtml}</div>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Visibilidad del popup dentro del mapa
// ---------------------------------------------------------------------------
function getRects(popup, map) {
  const el = typeof popup.getElement === 'function' ? popup.getElement() : null;
  const cont = map.getContainer();
  if (!el || !cont) return null;
  return { popup: el.getBoundingClientRect(), cont: cont.getBoundingClientRect() };
}

function estaFueraDelMapa(popup, map) {
  const r = getRects(popup, map);
  if (!r) return true;
  const pad = 2;
  const { popup: p, cont: c } = r;
  return (
    p.right < c.left + pad ||
    p.left > c.right - pad ||
    p.bottom < c.top + pad ||
    p.top > c.bottom - pad
  );
}

/**
 * Tras abrir, desplaza el mapa lo justo para que el popup completo
 * (con su punta) quede dentro del contenedor.
 */
function ajustarParaQueQuepa(popup, map) {
  const r = getRects(popup, map);
  if (!r) return;
  const pad = 12;
  const { popup: p, cont: c } = r;
  // panBy([ox, oy]) mueve la cámara; el contenido en pantalla se desplaza
  // en la dirección opuesta. Necesitamos mover el popup → contenido +Δ.
  let ox = 0;
  let oy = 0;
  if (p.left < c.left + pad) ox = -((c.left + pad) - p.left);
  else if (p.right > c.right - pad) ox = p.right - (c.right - pad);
  if (p.top < c.top + pad) oy = -((c.top + pad) - p.top);
  else if (p.bottom > c.bottom - pad) oy = p.bottom - (c.bottom - pad);
  if (ox !== 0 || oy !== 0) {
    map.panBy([ox, oy], { duration: 240, essential: true });
  }
}

function limpiarEscuchaTecla() {
  if (activeCleanup?.onKey) {
    document.removeEventListener('keydown', activeCleanup.onKey);
  }
}

/**
 * Abre un popup flotante sobre el mapa, siempre visible dentro del viewport.
 */
export function openFeaturePopup(
  map,
  displayName,
  props,
  lngLat,
  visibleAttributes = null,
  layerId = null,
  attributeLabels = null,
) {
  if (activePopup) {
    limpiarEscuchaTecla();
    activeCleanup?.onMoveEnd && map.off('moveend', activeCleanup.onMoveEnd);
    activeCleanup?.onResize && window.removeEventListener('resize', activeCleanup.onResize);
    activePopup.remove();
    activePopup = null;
  }

  const html = buildFeaturePopupHtml(displayName, props, visibleAttributes, attributeLabels);

  const popup = new maplibregl.Popup({
    closeButton: true,
    closeOnClick: false,
    closeOnMove: false,
    className: 'feature-attr-popup',
    maxWidth: '300px',
    offset: 14,
    // Sin anchor fijo: MapLibre elige la mejor posición según el borde.
  })
    .setLngLat(lngLat)
    .setHTML(html)
    .addTo(map);

  // Ajuste tras el primer layout (el popup ya mide su alto real).
  requestAnimationFrame(() => ajustarParaQueQuepa(popup, map));

  // Al terminar de mover/redimensionar: si el popup quedó fuera, se cierra
  // para no dejar un fantasma imposible de ver o cerrar.
  const onMoveEnd = () => {
    if (popup.isOpen && !popup.isOpen()) return;
    if (estaFueraDelMapa(popup, map)) {
      popup.remove();
    }
  };
  const onResize = () => {
    if (popup.isOpen && !popup.isOpen()) return;
    if (estaFueraDelMapa(popup, map)) ajustarParaQueQuepa(popup, map);
  };
  map.on('moveend', onMoveEnd);
  window.addEventListener('resize', onResize);

  // Escape cierra el popup.
  const onKey = (e) => {
    if (e.key === 'Escape') popup.remove();
  };
  document.addEventListener('keydown', onKey);

  popup.on('close', () => {
    map.off('moveend', onMoveEnd);
    window.removeEventListener('resize', onResize);
    document.removeEventListener('keydown', onKey);
    if (activeCleanup?.onKey === onKey) activeCleanup = null;
    if (activePopup === popup) activePopup = null;
  });

  activePopup = popup;
  activeLayerId = layerId;
  activeCleanup = { onKey, onMoveEnd, onResize };
  return popup;
}

/**
 * Cierra el popup abierto. Si se indica layerId, solo lo cierra cuando
 * pertenece a esa capa (p. ej. al apagarla).
 */
export function closeFeaturePopup(layerId = null) {
  if (!activePopup) return;
  if (layerId !== null && activeLayerId !== layerId) return;
  activePopup.remove();
  activePopup = null;
  activeLayerId = null;
}
