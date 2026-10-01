// feature-popup.js
import * as maplibregl from 'maplibre-gl';

let activePopup = null;
let activeLayerId = null;

function buildFeaturePopupHtml(displayName, props, visibleAttributes) {
  let rowsHtml = '';

  const hasCustomList =
    Array.isArray(visibleAttributes) && visibleAttributes.length > 0;

  if (hasCustomList) {
    // Modo "configurado por el analista": respeta exactamente la lista
    for (const key of visibleAttributes) {
      if (key in props) {
        rowsHtml += `
          <div class="fp-row">
            <span class="fp-key">${key}</span>
            <span class="fp-val">${props[key]}</span>
          </div>
        `;
      }
    }
  } else {
    // Modo por defecto: excluir ids
    for (let key in props) {
      const lowerKey = key.toLowerCase();
      const isExcluded =
        ['id', 'geoid', 'gid', 'objectid'].includes(lowerKey) ||
        lowerKey.endsWith('_id') ||
        lowerKey.startsWith('id_');
      if (!isExcluded) {
        rowsHtml += `
          <div class="fp-row">
            <span class="fp-key">${key}</span>
            <span class="fp-val">${props[key]}</span>
          </div>
        `;
      }
    }
  }

  if (!rowsHtml) {
    rowsHtml = `<p class="fp-empty">Sin atributos disponibles.</p>`;
  }

  return `
    <div class="fp">
      <div class="fp-head">
        <span class="fp-title">${displayName}</span>
      </div>
      <div class="fp-body">${rowsHtml}</div>
    </div>
  `;
}


/**
 * Abre un popup flotante sobre el mapa.
 * @param {maplibregl.Map} map
 * @param {string} displayName Nombre legible de la capa.
 * @param {Object} props Atributos del feature.
 * @param {maplibregl.LngLatLike} lngLat Punto donde debe anclarse el popup.
 */
export function openFeaturePopup(
  map,
  displayName,
  props,
  lngLat,
  visibleAttributes = null,
  layerId = null,
) {
  if (activePopup) {
    activePopup.remove();
    activePopup = null;
  }

  const html = buildFeaturePopupHtml(displayName, props, visibleAttributes);

  const popup = new maplibregl.Popup({
    closeButton: true,
    closeOnClick: false,
    closeOnMove: false,
    className: 'feature-attr-popup',
    maxWidth: '280px',
    offset: 16,
    anchor: 'bottom',
  })
    .setLngLat(lngLat)
    .setHTML(html)
    .addTo(map);

  popup.on('close', () => {
    if (activePopup === popup) activePopup = null;
  });

  activePopup = popup;
  activeLayerId = layerId;
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