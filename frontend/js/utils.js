// utils.js
export function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}

export function getPaletteForType(type) {
  const PALETTE_POINT = ['#e41a1c','#377eb8','#4daf4a','#984ea3','#ff7f00','#ffff33','#a65628','#f781bf','#999999'];
  const PALETTE_LINE = ['#1b9e77','#d95f02','#7570b3','#e7298a','#66a61e','#e6ab02','#a6761d','#666666'];
  const PALETTE_POLYGON = ['#a6cee3','#1f78b4','#b2df8a','#33a02c','#fb9a99','#e31a1c','#fdbf6f','#ff7f00','#cab2d6','#6a3d9a','#ffff99','#b15928'];
  if (type === 'circle' || type === 'point') return PALETTE_POINT;
  if (type === 'line') return PALETTE_LINE;
  if (type === 'fill') return PALETTE_POLYGON;
  return PALETTE_POINT;
}

export function formatearCoordenada(lng, lat) {
  const latDir = lat >= 0 ? 'N' : 'S';
  const lonDir = lng >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(5)}° ${latDir} ${Math.abs(lng).toFixed(5)}° ${lonDir}`;
}

export function obtenerNombreEstado(properties) {
  const posiblesClaves = ['entidad', 'estado', 'nombre', 'name'];
  const keysReales = Object.keys(properties || {});
  for (const clave of posiblesClaves) {
    const encontrada = keysReales.find(k => k.toLowerCase() === clave);
    if (encontrada && properties[encontrada] !== undefined && properties[encontrada] !== null) {
      return String(properties[encontrada]).trim();
    }
  }
  return null;
}

export function obtenerNombreBloque(properties) {
  const posiblesClaves = ['bloque', 'nombre', 'name'];
  const keysReales = Object.keys(properties || {});
  for (const clave of posiblesClaves) {
    const encontrada = keysReales.find(k => k.toLowerCase() === clave);
    if (encontrada && properties[encontrada] !== undefined && properties[encontrada] !== null) {
      return String(properties[encontrada]).trim();
    }
  }
  return null;
}

export function refreshCount(elementId = 'layerCount') {
  const el = document.getElementById(elementId);
  if (!el) return;
  const active = document.querySelectorAll('.layer-row .toggle.on').length;
  el.textContent = active + (active === 1 ? ' activa' : ' activas');
}

export function updateLegendUI(availableLayers, legendListId = 'legendList') {
  const legendList = document.getElementById(legendListId) || document.querySelector('.legend-content');
  if (!legendList) return;

  legendList.innerHTML = '';

  const activeToggles = document.querySelectorAll('.toggle.on[data-table]');
  if (activeToggles.length === 0) {
    legendList.innerHTML = '<div style="font-size: 0.8rem; color: var(--muted-500); padding: 8px; text-align: center;">No hay capas activas en el mapa.</div>';
    return;
  }

  const categoryTitle = document.createElement('div');
  categoryTitle.style.cssText = 'font-size: 0.75rem; font-weight: bold; color: var(--muted-500); text-transform: uppercase; margin-bottom: 8px; letter-spacing: 0.5px;';
  categoryTitle.textContent = 'Capas Activas';
  legendList.appendChild(categoryTitle);

  activeToggles.forEach(toggle => {
    const tableName = toggle.getAttribute('data-table');
    const matchingLayers = availableLayers.filter(l => l.id === tableName);

    matchingLayers.forEach(layerConfig => {
      const item = document.createElement('div');
      item.className = 'legend-item';
      item.style.cssText = 'display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; padding-bottom: 4px; border-bottom: 1px dashed rgba(255,255,255,0.05);';

      let symbolHTML = '';
      if (layerConfig.type === 'fill') {
        symbolHTML = `<div style="width: 20px; height: 14px; background: ${layerConfig.color || '#3182ce'}; opacity: 0.8; border: 1px solid #000; border-radius: 2px; margin-right: 10px; flex-shrink: 0;"></div>`;
      } else if (layerConfig.type === 'line') {
        symbolHTML = `<div style="width: 24px; height: 4px; background: ${layerConfig.color || '#3182ce'}; border-radius: 2px; margin-right: 10px; flex-shrink: 0;"></div>`;
      } else {
        symbolHTML = `
          <div style="width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; margin-right: 10px; flex-shrink: 0;">
            <div style="width: 10px; height: 10px; background: ${layerConfig.color || '#6fa3e0'}; border: 1.5px solid #ffffff; border-radius: 50%; box-shadow: 0 0 0 1px #000;"></div>
          </div>`;
      }

      item.innerHTML = `
        <span style="font-size: 0.8rem; color: var(--paper-100); font-weight: 500;">${layerConfig.name}</span>
        ${symbolHTML}
      `;

      legendList.appendChild(item);
    });
  });
}