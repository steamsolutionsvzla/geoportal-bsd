document.addEventListener('DOMContentLoaded', () => {
 // =========================================================================
  // INDICADOR VISUAL DE CARGA (CENTRADO EN EL MAPA)
  // =========================================================================
  function mostrarCargando(mostrar) {
    let loader = document.getElementById('map-loader');
    const mapContainer = document.getElementById('map');

    if (!loader && mapContainer) {
      loader = document.createElement('div');
      loader.id = 'map-loader';
      loader.style.cssText = 'position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); background: rgba(15, 23, 42, 0.85); color: white; padding: 12px 18px; border-radius: 8px; font-size: 0.85rem; z-index: 1000; display: flex; align-items: center; gap: 10px; box-shadow: 0 4px 10px rgba(0,0,0,0.2); backdrop-filter: blur(4px); pointer-events: none;';
      loader.innerHTML = '<div style="width: 16px; height: 16px; border: 2px solid #38bdf8; border-top-color: transparent; border-radius: 50%; animation: spin 0.8s linear infinite;"></div> <span>Cargando datos...</span>';

      const style = document.createElement('style');
      style.textContent = '@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }';
      document.head.appendChild(style);

      mapContainer.appendChild(loader);
    }

    if (loader) {
      loader.style.display = mostrar ? 'flex' : 'none';
    }
  }

  // =========================================================================
  // VARIABLES GLOBALES DE ESTADO DE SELECCIÓN
  // =========================================================================
  let selectedFeatureId = null;
  let selectedSourceId = null;
  let availableLayers = [];
  const LOGO_EMPRESA_BASE64 = "data:image/png;base64,PLACEHOLDER";


  let estadosGeoJsonCache = null;
  let selectedStateFeatureId = null;
  let isFilterActive = false;
  // ---------------------------------------------------------------------
  let currentFilterData = null; // { estadoSeleccionado, totalPuntosGeneral, capasContadas, capasDetalleMap, rowsHtml }
  let currentPointData = null;  // { tableName, props } del último punto seleccionado en el mapa

  const ESTADO_SOURCE_ID = 'source-estados-venezuela';
  const ESTADO_LAYER_ID = 'layer-estados-venezuela-fill';
  const ESTADO_LINE_LAYER_ID = 'layer-estados-venezuela-line';

  // =========================================================================
  // FILTRO POR BLOQUES (mismo patrón que el filtro de Estados)
  // =========================================================================
  const BLOQUES_TABLE_ID = 'BLOQUES';
  const BLOQUE_SOURCE_ID = 'source-bloques-venezuela';
  const BLOQUE_LAYER_ID = 'layer-bloques-venezuela-fill';
  const BLOQUE_LINE_LAYER_ID = 'layer-bloques-venezuela-line';

  let bloquesGeoJsonCache = null;
  let selectedBloqueFeatureId = null;
  let isBloqueFilterActive = false;
  let currentBloqueFilterData = null; // { bloqueSeleccionado, totalPuntosGeneral, capasContadas, capasDetalleMap, rowsHtml }


  // =========================================================================
  // CONTROL DE APERTURA Y CIERRE DE LA LEYENDA FLOTANTE
  // =========================================================================
  const legendToggleBtn = document.getElementById('legendToggleBtn');
  const legendPopover = document.getElementById('legendPopover');
  const closeLegendBtn = document.getElementById('closeLegendBtn');

  const legendSwitch = document.querySelector('.legend-switch');

if (legendToggleBtn && legendSwitch) {
  legendToggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    legendSwitch.classList.toggle('open');
    updateLegendUI();
  });

  if (closeLegendBtn) {
    closeLegendBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      legendSwitch.classList.remove('open');
    });
  }

  document.addEventListener('click', (e) => {
    if (!legendSwitch.contains(e.target)) {
      legendSwitch.classList.remove('open');
    }
  });
}
  function updateLegendUI() {
    const legendList = document.getElementById('legendList') || document.querySelector('.legend-content');
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

  // =========================================================================
  // 1. INICIALIZACIÓN CON ESTILO BASE CLARO (SIN ETIQUETAS)
  // =========================================================================
  let activeBasemap = 'clara';
  const INITIAL_CENTER = [-65.75816, 7.17672];
  const INITIAL_ZOOM = 4.8;
  const map = new maplibregl.Map({
    container: 'map',
    style: 'https://basemaps.cartocdn.com/gl/positron-nolabels-gl-style/style.json',
    center: INITIAL_CENTER,
    zoom: INITIAL_ZOOM,
    renderWorldCopies: false,
    maxTileCacheSize: 30,
    fadeDuration: 0,
    attributionControl: false
  });

  try {
    map.setGlyphs('https://tiles.basemaps.cartocdn.com/fonts/{fontstack}/{range}.pbf');
  } catch (e) {}


  const compassEl = document.querySelector('.compass');
  if (compassEl) {
    compassEl.style.cursor = 'pointer';
    compassEl.addEventListener('click', () => {
      map.flyTo({
        center: INITIAL_CENTER,
        zoom: INITIAL_ZOOM,
        bearing: 0,
        pitch: 0,
        duration: 1500
      });
    });

    function actualizarRotacionBrujula() {
      const bearing = map.getBearing();
      compassEl.style.transform = `rotate(${-bearing}deg)`;
    }

    map.on('rotate', actualizarRotacionBrujula);
    map.on('move', actualizarRotacionBrujula);
    actualizarRotacionBrujula();
  }

  // =========================================================================
  // STATUS BAR: LAT/LON, ESCALA Y ZOOM DINÁMICOS
  // =========================================================================
  const statCoordEl = document.getElementById('statCoord');
  const statScaleEl = document.getElementById('statScale');
  const statZoomEl = document.getElementById('statZoom');

  function formatearCoordenada(lng, lat) {
    const latDir = lat >= 0 ? 'N' : 'S';
    const lonDir = lng >= 0 ? 'E' : 'W';
    return `${Math.abs(lat).toFixed(5)}° ${latDir} ${Math.abs(lng).toFixed(5)}° ${lonDir}`;
  }

  map.on('mousemove', (e) => {
    if (statCoordEl) {
      statCoordEl.textContent = formatearCoordenada(e.lngLat.lng, e.lngLat.lat);
    }
  });

  function actualizarZoomYEscala() {
    const zoom = map.getZoom();
    if (statZoomEl) {
      statZoomEl.textContent = zoom.toFixed(1);
    }

    if (statScaleEl) {
      const centerLat = map.getCenter().lat;
      const metersPerPixel = 156543.03392 * Math.cos(centerLat * Math.PI / 180) / Math.pow(2, zoom);
      const referenciaPx = 100;
      const distanciaMetros = metersPerPixel * referenciaPx;

      let texto;
      if (distanciaMetros >= 1000) {
        texto = (distanciaMetros / 1000).toFixed(1) + ' km';
      } else {
        texto = Math.round(distanciaMetros) + ' m';
      }
      statScaleEl.textContent = texto;
    }
  }

  map.on('move', actualizarZoomYEscala);
  map.on('zoom', actualizarZoomYEscala);
  actualizarZoomYEscala();

  const zoomInBtn = document.getElementById('zoomIn');
  const zoomOutBtn = document.getElementById('zoomOut');

  if (zoomInBtn) {
    zoomInBtn.addEventListener('click', () => {
      map.zoomIn({ duration: 300 });
    });
  }

  if (zoomOutBtn) {
    zoomOutBtn.addEventListener('click', () => {
      map.zoomOut({ duration: 300 });
    });
  }

  const sidebar = document.getElementById('sidebar');
  const infoPanel = document.getElementById('infoPanel');
  const appContainer = document.querySelector('.app');

  function toggleSidebarState() {
    if (!sidebar) return;
    const willCollapse = !sidebar.classList.contains('collapsed');
    sidebar.classList.toggle('collapsed', willCollapse);
    if (appContainer) appContainer.classList.toggle('has-collapsed-sidebar', willCollapse);
    setTimeout(() => map.resize(), 300);
  }

  function toggleInfoPanelState() {
    if (!infoPanel) return;
    const willCollapse = !infoPanel.classList.contains('collapsed');
    infoPanel.classList.toggle('collapsed', willCollapse);
    if (appContainer) appContainer.classList.toggle('has-collapsed-info', willCollapse);
    setTimeout(() => map.resize(), 300);
  }

  const sidebarToggleBtn = document.getElementById('sidebarToggleBtn');
  if (sidebarToggleBtn) {
    sidebarToggleBtn.addEventListener('click', () => toggleSidebarState());
  }

  const infoToggleBtn = document.getElementById('infoToggleBtn');
  if (infoToggleBtn) {
    infoToggleBtn.addEventListener('click', () => toggleInfoPanelState());
  }

  ['layerListBase', 'layerListPetroleras'].forEach(containerId => {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.style.flex = '0 0 auto';
    container.style.overflow = 'hidden';
    container.style.transition = 'max-height 0.25s ease-in-out, opacity 0.2s ease-in-out';

    const header = container.previousElementSibling;
    if (header) {
      header.style.cursor = 'pointer';
      header.style.display = 'flex';
      header.style.alignItems = 'center';
      header.style.justifyContent = 'space-between';
      header.style.userSelect = 'none';

      if (!header.querySelector('.collapse-arrow')) {
        const arrow = document.createElement('span');
        arrow.className = 'collapse-arrow';
        arrow.textContent = '▼';
        arrow.style.fontSize = '0.7rem';
        arrow.style.transition = 'transform 0.2s ease';
        header.appendChild(arrow);
      }

      let isOpen = true;
      container.style.maxHeight = '1000px';
      container.style.opacity = '1';

      header.addEventListener('click', () => {
        isOpen = !isOpen;
        const arrow = header.querySelector('.collapse-arrow');

        if (isOpen) {
          container.style.maxHeight = container.scrollHeight + 'px';
          container.style.opacity = '1';
          if (arrow) arrow.style.transform = 'rotate(0deg)';
        } else {
          container.style.maxHeight = '0px';
          container.style.opacity = '0';
          if (arrow) arrow.style.transform = 'rotate(-90deg)';
        }
      });
    }
  });

  const layerCountEl = document.getElementById('layerCount');

  function refreshCount() {
    if (!layerCountEl) return;
    const activeToggles = document.querySelectorAll('.layer-row .toggle.on');
    const on = activeToggles.length;
    layerCountEl.textContent = on + (on === 1 ? ' activa' : ' activas');
  }

  // =========================================================================
  // 2. REGISTRO DE CAPAS SUPERPUESTAS Y CARGA DINÁMICA
  // =========================================================================
  map.on('load', async () => {

    map.addSource('clara-source', {
      type: 'raster',
      tiles: [
        'https://a.basemaps.cartocdn.com/rastertiles/light_nolabels/{z}/{x}/{y}@2x.png',
        'https://b.basemaps.cartocdn.com/rastertiles/light_nolabels/{z}/{x}/{y}@2x.png',
        'https://c.basemaps.cartocdn.com/rastertiles/light_nolabels/{z}/{x}/{y}@2x.png'
      ],
      tileSize: 256,
      attribution: '&copy; OpenStreetMap &copy; CARTO'
    });

    map.addLayer({
      id: 'clara-layer',
      type: 'raster',
      source: 'clara-source',
      layout: { visibility: 'visible' },
      minzoom: 0,
      maxzoom: 19
    });

    map.addSource('satelite-source', {
      type: 'raster',
      tiles: [
        'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
      ],
      tileSize: 256,
      attribution: 'Tiles &copy; Esri'
    });

    map.addLayer({
      id: 'satelite-layer',
      type: 'raster',
      source: 'satelite-source',
      layout: { visibility: 'none' },
      minzoom: 0,
      maxzoom: 19
    });

    map.addSource('relieve-color-source', {
      type: 'raster',
      tiles: [
        'https://services.arcgisonline.com/ArcGIS/rest/services/World_Terrain_Base/MapServer/tile/{z}/{y}/{x}'
      ],
      tileSize: 256,
      maxzoom: 13,
      attribution: 'Tiles &copy; Esri &mdash; Source: USGS, Esri, TANA, DeLorme, and NPS'
    });

    map.addLayer({
      id: 'relieve-color-layer',
      type: 'raster',
      source: 'relieve-color-source',
      layout: { visibility: 'none' },
      minzoom: 0,
      maxzoom: 19
    });

    map.addSource('relieve-hillshade-source', {
      type: 'raster',
      tiles: [
        'https://services.arcgisonline.com/arcgis/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}'
      ],
      tileSize: 256,
      maxzoom: 16,
      attribution: 'Tiles &copy; Esri &mdash; Source: Esri'
    });

    map.addLayer({
      id: 'relieve-hillshade-layer',
      type: 'raster',
      source: 'relieve-hillshade-source',
      layout: { visibility: 'none' },
      paint: { 'raster-opacity': 0.55 },
      minzoom: 0,
      maxzoom: 19
    });

    map.addSource('custom-labels-source', {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: [
          { type: 'Feature', properties: { name: 'COLOMBIA', size: 12, color: '#3a3a3a' }, geometry: { type: 'Point', coordinates: [-72.9, 4.6] } },
          { type: 'Feature', properties: { name: 'BRASIL', size: 12, color: '#3a3a3a' }, geometry: { type: 'Point', coordinates: [-64.2, 1.0] } },
          { type: 'Feature', properties: { name: 'TRINIDAD Y TOBAGO', size: 9, color: '#3a3a3a' }, geometry: { type: 'Point', coordinates: [-61.3, 10.65] } },
          { type: 'Feature', properties: { name: 'GUAYANA ESEQUIBA\n(Zona en Reclamación)', size: 9.5, color: '#7a2e2e' }, geometry: { type: 'Point', coordinates: [-59.8, 6.8] } },
          { type: 'Feature', properties: { name: 'MAR CARIBE', size: 10, color: '#3a3a3a' }, geometry: { type: 'Point', coordinates: [-66.5, 13.4] } },
          { type: 'Feature', properties: { name: 'OCÉANO ATLÁNTICO', size: 10, color: '#3a3a3a' }, geometry: { type: 'Point', coordinates: [-57.3, 9.6] } },
          { type: 'Feature', properties: { name: 'AMAZONAS', size: 11, color: '#2f4a33', kind: 'estado' }, geometry: { type: 'Point', coordinates: [-67.583, 5.665] } },
          { type: 'Feature', properties: { name: 'ANZOÁTEGUI', size: 11, color: '#2f4a33', kind: 'estado' }, geometry: { type: 'Point', coordinates: [-64.684, 10.136] } },
          { type: 'Feature', properties: { name: 'APURE', size: 11, color: '#2f4a33', kind: 'estado' }, geometry: { type: 'Point', coordinates: [-67.447, 7.885] } },
          { type: 'Feature', properties: { name: 'ARAGUA', size: 11, color: '#2f4a33', kind: 'estado' }, geometry: { type: 'Point', coordinates: [-67.592, 10.246] } },
          { type: 'Feature', properties: { name: 'BARINAS', size: 11, color: '#2f4a33', kind: 'estado' }, geometry: { type: 'Point', coordinates: [-70.216, 8.622] } },
          { type: 'Feature', properties: { name: 'BOLÍVAR', size: 11, color: '#2f4a33', kind: 'estado' }, geometry: { type: 'Point', coordinates: [-63.544, 8.124] } },
          { type: 'Feature', properties: { name: 'CARABOBO', size: 11, color: '#2f4a33', kind: 'estado' }, geometry: { type: 'Point', coordinates: [-68.007, 10.162] } },
          { type: 'Feature', properties: { name: 'COJEDES', size: 11, color: '#2f4a33', kind: 'estado' }, geometry: { type: 'Point', coordinates: [-68.586, 9.661] } },
          { type: 'Feature', properties: { name: 'DELTA AMACURO', size: 11, color: '#2f4a33', kind: 'estado' }, geometry: { type: 'Point', coordinates: [-62.047, 9.062] } },
          { type: 'Feature', properties: { name: 'FALCÓN', size: 11, color: '#2f4a33', kind: 'estado' }, geometry: { type: 'Point', coordinates: [-69.673, 11.404] } },
          { type: 'Feature', properties: { name: 'GUÁRICO', size: 11, color: '#2f4a33', kind: 'estado' }, geometry: { type: 'Point', coordinates: [-67.351, 9.917] } },
          { type: 'Feature', properties: { name: 'LARA', size: 11, color: '#2f4a33', kind: 'estado' }, geometry: { type: 'Point', coordinates: [-69.320, 10.068] } },
          { type: 'Feature', properties: { name: 'MÉRIDA', size: 11, color: '#2f4a33', kind: 'estado' }, geometry: { type: 'Point', coordinates: [-71.144, 8.586] } },
          { type: 'Feature', properties: { name: 'MIRANDA', size: 11, color: '#2f4a33', kind: 'estado' }, geometry: { type: 'Point', coordinates: [-67.041, 10.343] } },
          { type: 'Feature', properties: { name: 'MONAGAS', size: 11, color: '#2f4a33', kind: 'estado' }, geometry: { type: 'Point', coordinates: [-63.183, 9.749] } },
          { type: 'Feature', properties: { name: 'NUEVA ESPARTA', size: 11, color: '#2f4a33', kind: 'estado' }, geometry: { type: 'Point', coordinates: [-63.860, 11.033] } },
          { type: 'Feature', properties: { name: 'PORTUGUESA', size: 11, color: '#2f4a33', kind: 'estado' }, geometry: { type: 'Point', coordinates: [-69.744, 9.041] } },
          { type: 'Feature', properties: { name: 'SUCRE', size: 11, color: '#2f4a33', kind: 'estado' }, geometry: { type: 'Point', coordinates: [-64.171, 10.463] } },
          { type: 'Feature', properties: { name: 'TÁCHIRA', size: 11, color: '#2f4a33', kind: 'estado' }, geometry: { type: 'Point', coordinates: [-72.224, 7.767] } },
          { type: 'Feature', properties: { name: 'TRUJILLO', size: 11, color: '#2f4a33', kind: 'estado' }, geometry: { type: 'Point', coordinates: [-70.435, 9.367] } },
          { type: 'Feature', properties: { name: 'YARACUY', size: 11, color: '#2f4a33', kind: 'estado' }, geometry: { type: 'Point', coordinates: [-68.744, 10.339] } },
          { type: 'Feature', properties: { name: 'ZULIA', size: 11, color: '#2f4a33', kind: 'estado' }, geometry: { type: 'Point', coordinates: [-71.612, 10.653] } },
          { type: 'Feature', properties: { name: 'LA GUAIRA', size: 11, color: '#2f4a33', kind: 'estado' }, geometry: { type: 'Point', coordinates: [-66.931, 10.601] } },
          { type: 'Feature', properties: { name: 'DISTRITO CAPITAL', size: 11, color: '#2f4a33', kind: 'estado' }, geometry: { type: 'Point', coordinates: [-66.903, 10.480] } }
        ]
      }
    });

    map.addLayer({
      id: 'custom-labels-layer',
      type: 'symbol',
      source: 'custom-labels-source',
      layout: {
        'text-field': ['get', 'name'],
        'text-font': ['Open Sans Bold'],
        'text-size': ['get', 'size'],
        'text-letter-spacing': 0.04,
        'text-justify': 'center',
        'text-max-width': 8,
        visibility: 'none'
      },
      paint: {
        'text-color': ['get', 'color'],
        'text-halo-color': '#ffffff',
        'text-halo-width': 1.4
      },
      minzoom: 0,
      maxzoom: 19
    });

    map.addSource('terrain-dem', {
      type: 'raster-dem',
      tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
      tileSize: 256,
      encoding: 'terrarium',
      maxzoom: 14
    });

    try {
      map.setSky({
        'sky-color': '#b4d0e8',
        'horizon-color': '#e8ddc8',
        'fog-color': '#e8ddc8',
        'fog-ground-blend': 0.5,
        'horizon-fog-blend': 0.6,
        'sky-horizon-blend': 0.6,
        'atmosphere-blend': 0.6
      });
    } catch (e) {}

    const layerListBaseContainer = document.getElementById('layerListBase');
    const layerListPetrolerasContainer = document.getElementById('layerListPetroleras');

    try {
      mostrarCargando(true);
      const response = await fetch('/api/v1/layers/list');
      const data = await response.json();
availableLayers = data.layers.filter(layer => {
      const id = (layer.id || '').toLowerCase();
      return !id.includes('layer_metadata');
    });

      const typePriority = {
        'circle': 1,
        'point': 1,
        'line': 2,
        'fill': 3
      };

      availableLayers.sort((a, b) => {
        const priorityA = typePriority[a.type] || 4;
        const priorityB = typePriority[b.type] || 4;

        if (priorityA === priorityB) {
          return a.name.localeCompare(b.name);
        }
        return priorityA - priorityB;
      });

      if (layerListBaseContainer && layerListPetrolerasContainer) {
        layerListBaseContainer.innerHTML = '';
        layerListPetrolerasContainer.innerHTML = '';

        availableLayers.forEach(layerInfo => {
          const row = document.createElement('div');
          row.className = 'layer-row off';

          let geomIconHTML = '';
          if (layerInfo.type === 'circle' || layerInfo.type === 'point') {
            geomIconHTML = `<div style="width: 10px; height: 10px; background: ${layerInfo.color || '#6fa3e0'}; border: 1.5px solid #ffffff; border-radius: 50%; margin-right: 8px; flex-shrink: 0; box-shadow: 0 0 0 1px #000;"></div>`;
          } else if (layerInfo.type === 'line') {
            geomIconHTML = `<div style="width: 14px; height: 3px; background: ${layerInfo.color || '#6fa3e0'}; border-radius: 1px; margin-right: 8px; flex-shrink: 0;"></div>`;
          } else if (layerInfo.type === 'fill') {
            geomIconHTML = `<div style="width: 12px; height: 10px; background: ${layerInfo.color || '#6fa3e0'}; border: 1px solid #ffffff; border-radius: 2px; margin-right: 8px; flex-shrink: 0; box-shadow: 0 0 0 1px #000;"></div>`;
          }

          row.innerHTML = `
            <div style="display: flex; align-items: center; width: 100%; cursor: pointer;" class="layer-title-container">
              ${geomIconHTML}
              <div class="lname" style="transition: all 0.2s ease;">${layerInfo.name}</div>
            </div>
            <div class="toggle" data-table="${layerInfo.id}"></div>
          `;

          const lowerName = layerInfo.id.toLowerCase();
          const isEntidadFederal = lowerName.includes('estadal') || lowerName.includes('estado') || lowerName.includes('entidad');

          if (isEntidadFederal) {
            layerListBaseContainer.appendChild(row);
          } else {
            layerListPetrolerasContainer.appendChild(row);
          }
        });

        [layerListBaseContainer, layerListPetrolerasContainer].forEach(cont => {
          if (cont.style.opacity !== '0') {
            cont.style.maxHeight = cont.scrollHeight + 'px';
          }
        });
      }
    } catch (error) {
      console.error("Error al obtener la lista de capas de la BD:", error);
      if (layerListPetrolerasContainer) {
        layerListPetrolerasContainer.innerHTML = '<div style="color: #c1584a; font-size: 0.8rem; padding: 10px; text-align: center;">Error al conectar con la BD.</div>';
      }
    } finally {
      mostrarCargando(false);
    }

    await cargarCapaEstadosVenezuela();
    await cargarCapaBloques();

   const sidebarElement = document.getElementById('sidebar');
if (sidebarElement) {
  sidebarElement.addEventListener('click', async (e) => {
    const rowTarget = e.target.closest('.layer-row');
    if (!rowTarget) return;

    const toggleBtn = rowTarget.querySelector('.toggle[data-table]');
    if (!toggleBtn) return;

    toggleBtn.classList.toggle('on');
    rowTarget.classList.toggle('off', !toggleBtn.classList.contains('on'));

    const tableName = toggleBtn.getAttribute('data-table');
    const isVisible = toggleBtn.classList.contains('on');

    refreshCount();

    if (tableName === 'dpt_estadal_venezuela') {
      const visValue = isVisible ? 'visible' : 'none';
      if (map.getLayer(ESTADO_LINE_LAYER_ID)) {
        map.setLayoutProperty(ESTADO_LINE_LAYER_ID, 'visibility', visValue);
      }
      updateLegendUI();
      renderInfoPanel();
      if (window.innerWidth <= 768 && sidebar && appContainer && !sidebar.classList.contains('collapsed')) {
        toggleSidebarState();
      }
      return;
    }

    if (tableName === BLOQUES_TABLE_ID) {
      const visValue = isVisible ? 'visible' : 'none';
      if (map.getLayer(BLOQUE_LINE_LAYER_ID)) {
        map.setLayoutProperty(BLOQUE_LINE_LAYER_ID, 'visibility', visValue);
      }
      updateLegendUI();
      renderInfoPanel();
      if (window.innerWidth <= 768 && sidebar && appContainer && !sidebar.classList.contains('collapsed')) {
        toggleSidebarState();
      }
      return;
    }

    const sourceId = `source-${tableName}`;
    const layerId = `layer-${tableName}`;

    if (isVisible) {
      try {
        mostrarCargando(true);
        const response = await fetch(`/api/v1/layers/${tableName}`);
        const data = await response.json();

        if (!data.features || data.features.length === 0) {
          alert(`La capa "${tableName}" no devolvió registros desde la base de datos.`);
          toggleBtn.classList.remove('on');
          rowTarget.classList.add('off');
          refreshCount();
          updateLegendUI();
          renderInfoPanel();
          return;
        }

        if (map.getSource(sourceId)) {
          map.getSource(sourceId).setData(data);
        } else {
          map.addSource(sourceId, {
            type: 'geojson',
            data: data,
            generateId: true
          });
        }

        addMapLayerDirectly(tableName, sourceId, layerId, availableLayers);

      } catch (error) {
        console.error("Error al cargar la capa geográfica:", error);
        alert("No se pudo conectar con el backend de FastAPI en http://localhost:8000");
        toggleBtn.classList.remove('on');
        rowTarget.classList.add('off');
      } finally {
        mostrarCargando(false);
      }
    } else {
      if (selectedSourceId === sourceId) {
        selectedFeatureId = null;
        selectedSourceId = null;
      }
      if (currentPointData && currentPointData.tableName === tableName) {
        currentPointData = null;
        renderInfoPanel();
      }
      if (map.getLayer(layerId)) {
        map.removeLayer(layerId);
      }
      if (map.getSource(sourceId)) {
        map.removeSource(sourceId);
      }
    }

    refreshCount();
    updateLegendUI();
    renderInfoPanel();

    if (window.innerWidth <= 768 && sidebar && appContainer && !sidebar.classList.contains('collapsed')) {
      toggleSidebarState();
    }
  });
}

  });

  async function cargarCapaEstadosVenezuela() {
    const dropdownEstado = document.getElementById('dropdownEstado');
    try {
      mostrarCargando(true);
      const response = await fetch('/api/v1/layers/dpt_estadal_venezuela');
      const data = await response.json();
      estadosGeoJsonCache = data;

      if (map.getSource(ESTADO_SOURCE_ID)) {
        map.getSource(ESTADO_SOURCE_ID).setData(data);
      } else {
        map.addSource(ESTADO_SOURCE_ID, {
          type: 'geojson',
          data: data,
          generateId: true
        });
      }

      if (!map.getLayer(ESTADO_LINE_LAYER_ID)) {
        map.addLayer({
          id: ESTADO_LINE_LAYER_ID,
          type: 'line',
          source: ESTADO_SOURCE_ID,
          layout: {
            'visibility': 'none'
          },
          paint: {
            'line-color': '#1a365d',
            'line-width': [
              'case',
              ['boolean', ['feature-state', 'selected'], false], 3,
              ['==', ['literal', isFilterActive], true], 0,
              1
            ]
          }
        });
      }

      if (dropdownEstado && data.features) {
        const estadosSet = new Set();
        data.features.forEach(f => {
          const nombreEstado = obtenerNombreEstado(f.properties);
          if (nombreEstado) estadosSet.add(nombreEstado);
        });

        Array.from(estadosSet).sort().forEach(estado => {
          const opt = document.createElement('div');
          opt.className = 'loc-option';
          opt.setAttribute('data-value', estado);
          opt.textContent = estado;
          dropdownEstado.appendChild(opt);
        });
      }
    } catch (error) {
      console.error("Error al cargar la capa de estados desde el backend:", error);
    } finally {
      mostrarCargando(false);
    }
  }

  async function cargarCapaBloques() {
    const dropdownBloque = document.getElementById('dropdownBloque');
    try {
      mostrarCargando(true);
      const response = await fetch(`/api/v1/layers/${BLOQUES_TABLE_ID}`);
      const data = await response.json();
      bloquesGeoJsonCache = data;

      if (map.getSource(BLOQUE_SOURCE_ID)) {
        map.getSource(BLOQUE_SOURCE_ID).setData(data);
      } else {
        map.addSource(BLOQUE_SOURCE_ID, {
          type: 'geojson',
          data: data,
          generateId: true
        });
      }

      if (!map.getLayer(BLOQUE_LINE_LAYER_ID)) {
        map.addLayer({
          id: BLOQUE_LINE_LAYER_ID,
          type: 'line',
          source: BLOQUE_SOURCE_ID,
          layout: {
            'visibility': 'none'
          },
          paint: {
            'line-color': '#8a4baf',
            'line-width': [
              'case',
              ['boolean', ['feature-state', 'selected'], false], 3,
              ['==', ['literal', isBloqueFilterActive], true], 0,
              1
            ]
          }
        });
      }

      if (dropdownBloque && data.features) {
        const bloquesSet = new Set();
        data.features.forEach(f => {
          const nombreBloque = obtenerNombreBloque(f.properties);
          if (nombreBloque) bloquesSet.add(nombreBloque);
        });

        Array.from(bloquesSet).sort().forEach(bloque => {
          const opt = document.createElement('div');
          opt.className = 'loc-option';
          opt.setAttribute('data-value', bloque);
          opt.textContent = bloque;
          dropdownBloque.appendChild(opt);
        });
      }
    } catch (error) {
      console.error("Error al cargar la capa de bloques desde el backend:", error);
    } finally {
      mostrarCargando(false);
    }
  }

  function addMapLayerDirectly(tableName, sourceId, layerId, availableLayers) {
    const layerConfig = availableLayers.find(l => l.id === tableName);
    const geomType = layerConfig ? layerConfig.type : 'circle';
    const geomColor = layerConfig ? layerConfig.color : '#6fa3e0';

    if (!map.getLayer(layerId)) {
      let beforeLayerId = undefined;
      const existingLayers = map.getStyle().layers;

      if (geomType === 'fill') {
        for (let l of existingLayers) {
          if (l.id.startsWith('layer-') && l.id !== ESTADO_LAYER_ID && l.id !== ESTADO_LINE_LAYER_ID && l.id !== BLOQUE_LAYER_ID && l.id !== BLOQUE_LINE_LAYER_ID) {
            const t = availableLayers.find(cfg => `layer-${cfg.id}` === l.id);
            if (t && (t.type === 'line' || t.type === 'circle')) {
              beforeLayerId = l.id;
              break;
            }
          }
        }
      } else if (geomType === 'line') {
        for (let l of existingLayers) {
          if (l.id.startsWith('layer-') && l.id !== ESTADO_LAYER_ID && l.id !== ESTADO_LINE_LAYER_ID && l.id !== BLOQUE_LAYER_ID && l.id !== BLOQUE_LINE_LAYER_ID) {
            const t = availableLayers.find(cfg => `layer-${cfg.id}` === l.id);
            if (t && t.type === 'circle') {
              beforeLayerId = l.id;
              break;
            }
          }
        }
      }

      if (geomType === 'circle') {
        map.addLayer({
          id: layerId,
          type: 'circle',
          source: sourceId,
          paint: {
            'circle-radius': [
              'case',
              ['boolean', ['feature-state', 'selected'], false], 10,
              ['boolean', ['feature-state', 'hover'], false], 9,
              6
            ],
            'circle-color': geomColor,
            'circle-stroke-width': [
              'case',
              ['boolean', ['feature-state', 'selected'], false], 4,
              ['boolean', ['feature-state', 'hover'], false], 3,
              1
            ],
            'circle-stroke-color': '#000000'
          }
        }, beforeLayerId);

      } else if (geomType === 'fill') {
        map.addLayer({
          id: layerId,
          type: 'fill',
          source: sourceId,
          paint: {
            'fill-color': geomColor,
            'fill-opacity': [
              'case',
              ['boolean', ['feature-state', 'selected'], false], 0.9,
              ['boolean', ['feature-state', 'hover'], false], 0.8,
              0.4
            ],
            'fill-outline-color': '#000000'
          }
        }, beforeLayerId);

      } else if (geomType === 'line') {
        const lineColorExpression = [
          'match',
          ['get', 'tipo'],
          'Oleoducto', '#e0824a',
          'Gasducto', '#cda54c',
          geomColor
        ];

        map.addLayer({
          id: layerId,
          type: 'line',
          source: sourceId,
          paint: {
            'line-color': lineColorExpression,
            'line-width': [
              'case',
              ['boolean', ['feature-state', 'selected'], false], 6,
              ['boolean', ['feature-state', 'hover'], false], 5,
              2
            ]
          }
        }, beforeLayerId);
      }
    }

    if (!map.listenedClicks) map.listenedClicks = new Set();
    if (!map.listenedClicks.has(layerId)) {
      map.listenedClicks.add(layerId);
      let hoveredStateId = null;

      map.on('mousemove', layerId, (e) => {
        map.getCanvas().style.cursor = 'pointer';
        if (e.features.length > 0) {
          if (hoveredStateId !== null) {
            map.setFeatureState({ source: sourceId, id: hoveredStateId }, { hover: false });
          }
          hoveredStateId = e.features[0].id;
          map.setFeatureState({ source: sourceId, id: hoveredStateId }, { hover: true });
        }
      });

      map.on('mouseleave', layerId, () => {
        map.getCanvas().style.cursor = '';
        if (hoveredStateId !== null) {
          map.setFeatureState({ source: sourceId, id: hoveredStateId }, { hover: false });
        }
        hoveredStateId = null;
      });

      map.on('click', layerId, (ev) => {
        if (!ev.features || ev.features.length === 0) return;
        const clickedFeature = ev.features[0];
        const props = clickedFeature.properties;
        const clickedId = clickedFeature.id;

        if (selectedFeatureId !== null && selectedSourceId !== null) {
          map.setFeatureState({ source: selectedSourceId, id: selectedFeatureId }, { selected: false });
        }

        selectedFeatureId = clickedId;
        selectedSourceId = sourceId;

        map.setFeatureState({ source: selectedSourceId, id: selectedFeatureId }, { selected: true });

        currentPointData = { tableName, props };
        renderInfoPanel();
      });
    }
  }

  function switchBasemap(targetKey) {
    if (targetKey === activeBasemap) return;

    const overlayLayers = ['clara-layer', 'satelite-layer', 'relieve-color-layer', 'relieve-hillshade-layer'];

    overlayLayers.forEach(layerId => {
      if (map.getLayer(layerId)) {
        map.setLayoutProperty(layerId, 'visibility', 'none');
      }
    });

    if (map.getLayer('custom-labels-layer')) {
      map.setLayoutProperty('custom-labels-layer', 'visibility', 'none');
    }

    if (targetKey !== 'relieve3d' && activeBasemap === 'relieve3d') {
      map.setTerrain(null);
      map.easeTo({ pitch: 0, bearing: 0, duration: 800 });
    }

    if (targetKey === 'clara' && map.getLayer('clara-layer')) {
      map.setLayoutProperty('clara-layer', 'visibility', 'visible');
    } else if (targetKey === 'satelite' && map.getLayer('satelite-layer')) {
      map.setLayoutProperty('satelite-layer', 'visibility', 'visible');
      if (map.getLayer('custom-labels-layer')) {
        map.setLayoutProperty('custom-labels-layer', 'visibility', 'visible');
      }
    } else if (targetKey === 'relieve3d') {
      if (map.getLayer('relieve-color-layer')) {
        map.setLayoutProperty('relieve-color-layer', 'visibility', 'visible');
      }
      if (map.getLayer('relieve-hillshade-layer')) {
        map.setLayoutProperty('relieve-hillshade-layer', 'visibility', 'visible');
      }
      if (map.getLayer('custom-labels-layer')) {
        map.setLayoutProperty('custom-labels-layer', 'visibility', 'visible');
      }
      if (map.getSource('terrain-dem')) {
        map.setTerrain({ source: 'terrain-dem', exaggeration: 1.6 });
      }
      map.easeTo({
        center: [-71.55, 8.35],
        zoom: 8.3,
        pitch: 65,
        bearing: -20,
        duration: 1800
      });
    }

    activeBasemap = targetKey;
  }

  const basemapSwitch = document.querySelector('.basemap-switch');
  const basemapBtn = document.getElementById('basemapToggleBtn');

  if (basemapBtn && basemapSwitch) {
    basemapBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      basemapSwitch.classList.toggle('open');
    });

    document.addEventListener('click', (e) => {
      if (!basemapSwitch.contains(e.target)) {
        basemapSwitch.classList.remove('open');
      }
    });
  }

  document.querySelectorAll('[data-basemap]').forEach(option => {
    option.addEventListener('click', () => {
      document.querySelectorAll('[data-basemap]').forEach(x => x.classList.remove('active'));
      option.classList.add('active');

      const styleKey = option.getAttribute('data-basemap');
      switchBasemap(styleKey);

      if (basemapSwitch) {
        basemapSwitch.classList.remove('open');
      }
    });
  });

// =========================================================================
// FILTRO POR ESTADO
// =========================================================================
const filterEstado = document.getElementById('filterEstado');
const dropdownEstado = document.getElementById('dropdownEstado');
const applyFilterBtn = document.getElementById('applyFilterBtn');

if (applyFilterBtn) {
  applyFilterBtn.textContent = "Aplicar filtro";
}

let estadoSeleccionado = "";

document.querySelectorAll('.loc-filter').forEach(filter => {
  const btn = filter.querySelector('.loc-filter-btn');
  if (!btn) return;

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    document.querySelectorAll('.loc-filter.open').forEach(openFilter => {
      if (openFilter !== filter) openFilter.classList.remove('open');
    });
    filter.classList.toggle('open');
  });
});

if (dropdownEstado) {
  dropdownEstado.addEventListener('click', (e) => {
    const option = e.target.closest('.loc-option');
    if (!option) return;
    e.stopPropagation();

    dropdownEstado.querySelectorAll('.loc-option').forEach(o => o.classList.remove('selected'));
    option.classList.add('selected');

    estadoSeleccionado = (option.getAttribute('data-value') || option.textContent).trim();
    const label = filterEstado.querySelector('.lf-label');
    label.textContent = estadoSeleccionado ? option.textContent : "Estado";
    label.classList.toggle('has-value', Boolean(estadoSeleccionado));
    filterEstado.classList.remove('open');
  });
}

if (applyFilterBtn) {
  applyFilterBtn.addEventListener('click', () => {
    const infoContent = document.getElementById('infoPanelContent');
    const infoPanel = document.getElementById('infoPanel');
    const appContainer = document.querySelector('.app');

    if (isFilterActive) {
      isFilterActive = false;
      estadoSeleccionado = "";
      currentFilterData = null;

      applyFilterBtn.textContent = "Aplicar filtro";
      applyFilterBtn.style.backgroundColor = "";
      applyFilterBtn.style.background = "";

      if (map.getLayer(ESTADO_LINE_LAYER_ID)) {
        map.setLayoutProperty(ESTADO_LINE_LAYER_ID, 'visibility', 'none');
      }

      if (selectedStateFeatureId !== null) {
        map.setFeatureState({ source: ESTADO_SOURCE_ID, id: selectedStateFeatureId }, { selected: false });
        selectedStateFeatureId = null;
      }

      const label = filterEstado.querySelector('.lf-label');
      if (label) {
        label.textContent = "Estado";
        label.classList.remove('has-value');
      }

      if (dropdownEstado) {
        dropdownEstado.querySelectorAll('.loc-option').forEach(o => o.classList.remove('selected'));
      }

      renderInfoPanel();
      map.flyTo({ center: INITIAL_CENTER, zoom: INITIAL_ZOOM, duration: 1500 });
      return;
    }

    if (!estadoSeleccionado) {
      if (infoContent) {
        infoContent.innerHTML = `
          <div class="info-card" style="border-left: 3px solid #c1584a; background: rgba(193, 88, 74, 0.08);">
            <div class="ic-label" style="color: #c1584a; display: flex; align-items: center; gap: 6px;">
              <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              Atención
            </div>
            <p style="margin: 8px 0 0 0; font-size: 0.75rem; color: var(--paper-100);">Debe seleccionar un estado o un bloque para el filtrado.</p>
          </div>
        `;
        if (infoPanel && infoPanel.classList.contains('collapsed')) {
          infoPanel.classList.remove('collapsed');
          if (appContainer) appContainer.classList.remove('has-collapsed-info');
          setTimeout(() => map.resize(), 300);
        }
      }
      return;
    }

    if (typeof isBloqueFilterActive !== 'undefined' && isBloqueFilterActive) {
      isBloqueFilterActive = false;
      bloqueSeleccionado = "";
      currentBloqueFilterData = null;

      if (applyFilterBtn) {
        applyFilterBtn.textContent = "Aplicar filtro";
        applyFilterBtn.style.backgroundColor = "";
        applyFilterBtn.style.background = "";
      }

      if (map.getLayer(BLOQUE_LINE_LAYER_ID)) {
        map.setLayoutProperty(BLOQUE_LINE_LAYER_ID, 'visibility', 'none');
      }

      if (selectedBloqueFeatureId !== null) {
        map.setFeatureState({ source: BLOQUE_SOURCE_ID, id: selectedBloqueFeatureId }, { selected: false });
        selectedBloqueFeatureId = null;
      }

      const labelBloque = filterBloque ? filterBloque.querySelector('.lf-label') : null;
      if (labelBloque) {
        labelBloque.textContent = "Bloque";
        labelBloque.classList.remove('has-value');
      }

      if (dropdownBloque) {
        dropdownBloque.querySelectorAll('.loc-option').forEach(o => o.classList.remove('selected'));
      }
    }

    if (!estadosGeoJsonCache || !estadosGeoJsonCache.features) {
      if (infoContent) {
        infoContent.innerHTML = `
          <div class="info-card" style="border-left: 3px solid #c1584a; background: rgba(193, 88, 74, 0.08);">
            <div class="ic-label" style="color: #c1584a;">Aviso</div>
            <p style="margin: 8px 0 0 0; font-size: 0.75rem; color: var(--paper-100);">La capa de estados aún no se ha cargado completamente.</p>
          </div>
        `;
        if (infoPanel && infoPanel.classList.contains('collapsed')) {
          infoPanel.classList.remove('collapsed');
          if (appContainer) appContainer.classList.remove('has-collapsed-info');
          setTimeout(() => map.resize(), 300);
        }
      }
      return;
    }

    const estadoFeature = estadosGeoJsonCache.features.find(f => {
      const nombre = obtenerNombreEstado(f.properties);
      return nombre && estadoSeleccionado && nombre.toLowerCase() === estadoSeleccionado.toLowerCase();
    });

    if (!estadoFeature) {
      if (infoContent) {
        infoContent.innerHTML = `
          <div class="info-card" style="border-left: 3px solid #c1584a; background: rgba(193, 88, 74, 0.08);">
            <div class="ic-label" style="color: #c1584a;">Sin resultados</div>
            <p style="margin: 8px 0 0 0; font-size: 0.75rem; color: var(--paper-100);">No se encontró la geometría para el estado seleccionado.</p>
          </div>
        `;
        if (infoPanel && infoPanel.classList.contains('collapsed')) {
          infoPanel.classList.remove('collapsed');
          if (appContainer) appContainer.classList.remove('has-collapsed-info');
          setTimeout(() => map.resize(), 300);
        }
      }
      return;
    }

    isFilterActive = true;
    applyFilterBtn.textContent = "Eliminar filtro";
    applyFilterBtn.style.backgroundColor = "#c1584a";
    applyFilterBtn.style.background = "#c1584a";

    if (map.getLayer(ESTADO_LINE_LAYER_ID)) {
      map.setLayoutProperty(ESTADO_LINE_LAYER_ID, 'visibility', 'visible');
    }

    if (selectedStateFeatureId !== null) {
      map.setFeatureState({ source: ESTADO_SOURCE_ID, id: selectedStateFeatureId }, { selected: false });
    }

    const featureIndex = estadosGeoJsonCache.features.findIndex(f => {
      const nombre = obtenerNombreEstado(f.properties);
      return nombre && estadoSeleccionado && nombre.toLowerCase() === estadoSeleccionado.toLowerCase();
    });

    if (featureIndex !== -1) {
      selectedStateFeatureId = featureIndex;
      map.setFeatureState({ source: ESTADO_SOURCE_ID, id: selectedStateFeatureId }, { selected: true });
    }

    try {
      const bbox = turf.bbox(estadoFeature);
      map.fitBounds(bbox, { padding: 60, duration: 2000 });
    } catch (err) {
      console.warn("Error en bbox de turf:", err);
    }

    calcularPuntosEnEstado(estadoFeature);
  });
}

// =========================================================================
// FILTRO POR BLOQUE
// =========================================================================
const filterBloque = document.getElementById('filterBloque');
const dropdownBloque = document.getElementById('dropdownBloque');
const applyBloqueFilterBtn = document.getElementById('applyFilterBtn');

if (applyBloqueFilterBtn) {
  applyBloqueFilterBtn.textContent = "Aplicar filtro";
}

let bloqueSeleccionado = "";

if (dropdownBloque) {
  dropdownBloque.addEventListener('click', (e) => {
    const option = e.target.closest('.loc-option');
    if (!option) return;
    e.stopPropagation();

    dropdownBloque.querySelectorAll('.loc-option').forEach(o => o.classList.remove('selected'));
    option.classList.add('selected');

    bloqueSeleccionado = (option.getAttribute('data-val') || option.getAttribute('data-value') || option.textContent).trim();
    const label = filterBloque.querySelector('.lf-label');
    if (label) {
      label.textContent = bloqueSeleccionado ? option.textContent : "Bloque";
      label.classList.toggle('has-value', Boolean(bloqueSeleccionado));
    }
    filterBloque.classList.remove('open');
  });
}

if (applyBloqueFilterBtn) {
  applyBloqueFilterBtn.addEventListener('click', () => {
    const infoContent = document.getElementById('infoPanelContent');
    const infoPanel = document.getElementById('infoPanel');
    const appContainer = document.querySelector('.app');

    if (isBloqueFilterActive) {
      isBloqueFilterActive = false;
      bloqueSeleccionado = "";
      currentBloqueFilterData = null;

      applyBloqueFilterBtn.textContent = "Aplicar filtro";
      applyBloqueFilterBtn.style.backgroundColor = "";
      applyBloqueFilterBtn.style.background = "";

      if (map.getLayer(BLOQUE_LINE_LAYER_ID)) {
        map.setLayoutProperty(BLOQUE_LINE_LAYER_ID, 'visibility', 'none');
      }

      if (selectedBloqueFeatureId !== null) {
        map.setFeatureState({ source: BLOQUE_SOURCE_ID, id: selectedBloqueFeatureId }, { selected: false });
        selectedBloqueFeatureId = null;
      }

      const label = filterBloque.querySelector('.lf-label');
      if (label) {
        label.textContent = "Bloque";
        label.classList.remove('has-value');
      }

      if (dropdownBloque) {
        dropdownBloque.querySelectorAll('.loc-option').forEach(o => o.classList.remove('selected'));
      }

      renderInfoPanel();
      map.flyTo({ center: INITIAL_CENTER, zoom: INITIAL_ZOOM, duration: 1500 });
      return;
    }

    if (!bloqueSeleccionado) {
      if (infoContent) {
        infoContent.innerHTML = `
          <div class="info-card" style="border-left: 3px solid #c1584a; background: rgba(193, 88, 74, 0.08);">
            <div class="ic-label" style="color: #c1584a; display: flex; align-items: center; gap: 6px;">
              <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              Atención
            </div>
            <p style="margin: 8px 0 0 0; font-size: 0.75rem; color: var(--paper-100);">Debe seleccionar un estado o un bloque para el filtrado.</p>
          </div>
        `;
        if (infoPanel && infoPanel.classList.contains('collapsed')) {
          infoPanel.classList.remove('collapsed');
          if (appContainer) appContainer.classList.remove('has-collapsed-info');
          setTimeout(() => map.resize(), 300);
        }
      }
      return;
    }

    if (typeof isFilterActive !== 'undefined' && isFilterActive) {
      isFilterActive = false;
      estadoSeleccionado = "";
      currentFilterData = null;

      if (applyFilterBtn) {
        applyFilterBtn.textContent = "Aplicar filtro";
        applyFilterBtn.style.backgroundColor = "";
        applyFilterBtn.style.background = "";
      }

      if (map.getLayer(ESTADO_LINE_LAYER_ID)) {
        map.setLayoutProperty(ESTADO_LINE_LAYER_ID, 'visibility', 'none');
      }

      if (selectedStateFeatureId !== null) {
        map.setFeatureState({ source: ESTADO_SOURCE_ID, id: selectedStateFeatureId }, { selected: false });
        selectedStateFeatureId = null;
      }

      const labelEstado = filterEstado ? filterEstado.querySelector('.lf-label') : null;
      if (labelEstado) {
        labelEstado.textContent = "Estado";
        labelEstado.classList.remove('has-value');
      }

      if (dropdownEstado) {
        dropdownEstado.querySelectorAll('.loc-option').forEach(o => o.classList.remove('selected'));
      }
    }

    if (!bloquesGeoJsonCache || !bloquesGeoJsonCache.features) {
      if (infoContent) {
        infoContent.innerHTML = `
          <div class="info-card" style="border-left: 3px solid #c1584a; background: rgba(193, 88, 74, 0.08);">
            <div class="ic-label" style="color: #c1584a;">Aviso</div>
            <p style="margin: 8px 0 0 0; font-size: 0.75rem; color: var(--paper-100);">La capa de bloques aún no se ha cargado completamente.</p>
          </div>
        `;
        if (infoPanel && infoPanel.classList.contains('collapsed')) {
          infoPanel.classList.remove('collapsed');
          if (appContainer) appContainer.classList.remove('has-collapsed-info');
          setTimeout(() => map.resize(), 300);
        }
      }
      return;
    }

    const bloqueFeature = bloquesGeoJsonCache.features.find(f => {
      const nombre = obtenerNombreBloque(f.properties);
      return nombre && bloqueSeleccionado && nombre.toLowerCase() === bloqueSeleccionado.toLowerCase();
    });

    if (!bloqueFeature) {
      if (infoContent) {
        infoContent.innerHTML = `
          <div class="info-card" style="border-left: 3px solid #c1584a; background: rgba(193, 88, 74, 0.08);">
            <div class="ic-label" style="color: #c1584a;">Sin resultados</div>
            <p style="margin: 8px 0 0 0; font-size: 0.75rem; color: var(--paper-100);">No se encontró la geometría para el bloque seleccionado.</p>
          </div>
        `;
        if (infoPanel && infoPanel.classList.contains('collapsed')) {
          infoPanel.classList.remove('collapsed');
          if (appContainer) appContainer.classList.remove('has-collapsed-info');
          setTimeout(() => map.resize(), 300);
        }
      }
      return;
    }

    isBloqueFilterActive = true;
    applyBloqueFilterBtn.textContent = "Eliminar filtro";
    applyBloqueFilterBtn.style.backgroundColor = "#8a4baf";
    applyBloqueFilterBtn.style.background = "#8a4baf";

    if (map.getLayer(BLOQUE_LINE_LAYER_ID)) {
      map.setLayoutProperty(BLOQUE_LINE_LAYER_ID, 'visibility', 'visible');
    }

    if (selectedBloqueFeatureId !== null) {
      map.setFeatureState({ source: BLOQUE_SOURCE_ID, id: selectedBloqueFeatureId }, { selected: false });
    }

    const featureIndex = bloquesGeoJsonCache.features.findIndex(f => {
      const nombre = obtenerNombreBloque(f.properties);
      return nombre && bloqueSeleccionado && nombre.toLowerCase() === bloqueSeleccionado.toLowerCase();
    });

    if (featureIndex !== -1) {
      selectedBloqueFeatureId = featureIndex;
      map.setFeatureState({ source: BLOQUE_SOURCE_ID, id: selectedBloqueFeatureId }, { selected: true });
    }

    try {
      const bbox = turf.bbox(bloqueFeature);
      map.fitBounds(bbox, { padding: 60, duration: 2000 });
    } catch (err) {
      console.warn("Error en bbox de turf:", err);
    }

    if (typeof calcularPuntosEnBloque === 'function') {
      calcularPuntosEnBloque(bloqueFeature);
    }
  });
}

  function calcularPuntosEnEstado(estadoPolygonFeature) {
    const infoContent = document.getElementById('infoPanelContent');
    if (!infoContent) return;

    let totalPuntosGeneral = 0;
    let capasContadas = 0;
    let capasDetalleMap = {};
    let rowsHtml = '';

    availableLayers.forEach(layerConfig => {
      const sourceId = `source-${layerConfig.id}`;
      const source = map.getSource(sourceId);

      if (source && (layerConfig.type === 'circle' || layerConfig.type === 'point')) {
        const sourceData = source._data;
        if (sourceData && sourceData.features) {
          let countInPolygon = 0;
          let featuresInLayer = [];

          sourceData.features.forEach(ptFeature => {
            if (typeof turf !== 'undefined' && turf.booleanPointInPolygon(ptFeature, estadoPolygonFeature)) {
              countInPolygon++;
              featuresInLayer.push(ptFeature.properties);
            }
          });

          if (countInPolygon > 0) {
            capasContadas++;
            totalPuntosGeneral += countInPolygon;
            capasDetalleMap[layerConfig.name] = featuresInLayer;
            rowsHtml += `<tr><td style="padding:4px;">${layerConfig.name}</td><td style="text-align:right; padding:4px; font-weight:bold;">${countInPolygon}</td></tr>`;
          }
        }
      }
    });

    currentFilterData = {
      estadoSeleccionado,
      totalPuntosGeneral,
      capasContadas,
      capasDetalleMap,
      rowsHtml
    };

    renderInfoPanel();
  }

  function calcularPuntosEnBloque(bloquePolygonFeature) {
    const infoContent = document.getElementById('infoPanelContent');
    if (!infoContent) return;

    let totalPuntosGeneral = 0;
    let capasContadas = 0;
    let capasDetalleMap = {};
    let rowsHtml = '';

    availableLayers.forEach(layerConfig => {
      const sourceId = `source-${layerConfig.id}`;
      const source = map.getSource(sourceId);

      if (source && (layerConfig.type === 'circle' || layerConfig.type === 'point')) {
        const sourceData = source._data;
        if (sourceData && sourceData.features) {
          let countInPolygon = 0;
          let featuresInLayer = [];

          sourceData.features.forEach(ptFeature => {
            if (typeof turf !== 'undefined' && turf.booleanPointInPolygon(ptFeature, bloquePolygonFeature)) {
              countInPolygon++;
              featuresInLayer.push(ptFeature.properties);
            }
          });

          if (countInPolygon > 0) {
            capasContadas++;
            totalPuntosGeneral += countInPolygon;
            capasDetalleMap[layerConfig.name] = featuresInLayer;
            rowsHtml += `<tr><td style="padding:4px;">${layerConfig.name}</td><td style="text-align:right; padding:4px; font-weight:bold;">${countInPolygon}</td></tr>`;
          }
        }
      }
    });

    currentBloqueFilterData = {
      bloqueSeleccionado,
      totalPuntosGeneral,
      capasContadas,
      capasDetalleMap,
      rowsHtml
    };

    renderInfoPanel();
  }

  function buildPointCardHtml() {
    if (!currentPointData) return '';
    const { tableName, props } = currentPointData;

    let html = `<div class="info-card"><div class="ic-label">Capa: ${tableName}</div><hr style="border:0; border-top:1px solid var(--line-700); margin:8px 0;">`;

    for (let key in props) {
      const lowerKey = key.toLowerCase();
      const isExcluded =
        lowerKey === 'id' ||
        lowerKey === 'geoid' ||
        lowerKey === 'gid' ||
        lowerKey === 'objectid' ||
        lowerKey.endsWith('_id') ||
        lowerKey.startsWith('id_');

      if (!isExcluded) {
        html += `<p style="margin: 4px 0; font-size: 0.75rem;"><b>${key}:</b> ${props[key]}</p>`;
      }
    }

    html += `</div>`;
    return html;
  }

  function buildActiveLayersMetadataHtml() {
    const activeToggles = document.querySelectorAll('.toggle.on[data-table]');
    if (activeToggles.length === 0) return '';

    let rowsHtml = '';
    activeToggles.forEach(toggle => {
      const tableName = toggle.getAttribute('data-table');
      let displayName = tableName;

      if (tableName === 'dpt_estadal_venezuela') {
        displayName = 'Entidades Federales (Estados)';
      } else if (tableName === BLOQUES_TABLE_ID) {
        displayName = 'Bloques';
      } else {
        const layerConfig = availableLayers.find(l => l.id === tableName);
        if (layerConfig) displayName = layerConfig.name;
      }

      rowsHtml += `
        <div class="metadata-row" style="display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 7px 0; border-bottom: 1px dashed rgba(255,255,255,0.08);">
          <span style="font-size: 0.75rem; color: var(--paper-100); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${displayName}</span>
          <button type="button" class="metadata-btn" data-table="${tableName}" data-display-name="${displayName}" style="flex-shrink: 0; background: var(--panel-750); color: var(--muted-300); border: 1px solid var(--line-700); border-radius: var(--radius-s); padding: 4px 10px; font-size: 0.65rem; cursor: pointer;">Metadatos</button>
        </div>
      `;
    });

    return `
      <div class="info-card" style="margin-top: 14px;">
        <div class="ic-label">Metadatos de Capas Activas</div>
        <hr style="border:0; border-top:1px solid var(--line-700); margin:8px 0;">
        ${rowsHtml}
      </div>
    `;
  }

  // =========================================================================
  // MODAL DE METADATOS DE CAPA (tabla qgis_layer_metadata)
  // =========================================================================
  const metadataModalOverlay = document.getElementById('metadataModalOverlay');
  const metadataModalBody = document.getElementById('metadataModalBody');
  const metadataModalTitle = document.getElementById('metadataModalTitle');
  const metadataModalClose = document.getElementById('metadataModalClose');

  // Orden y etiquetas legibles para los campos conocidos de qgis_layer_metadata.
  // Se incluyen nombres de columna de distintas variantes de esquema que puede
  // tener esta tabla según cómo fue creada en QGIS. Los campos no listados aquí
  // (y no ocultos) se muestran igual al final, con la etiqueta autogenerada.
  const METADATA_FIELD_CONFIG = [
    
    { key: 'title', label: 'Título' },
    { key: 'abstract', label: 'Resumen' },
    { key: 'categories', label: 'Categorías' },
    { key: 'keywords', label: 'Palabras clave' },
    { key: 'themes', label: 'Temas' },
    { key: 'spatial_level', label: 'Nivel espacial' },
    { key: 'layer_type', label: 'Tipo de capa' },
    { key: 'geometry_type', label: 'Tipo de geometría' },
    { key: 'feature_count', label: 'Cantidad de elementos' },
    { key: 'crs', label: 'Sistema de referencia (CRS)' },
    { key: 'projection_name', label: 'Proyección' },
    { key: 'projection_authid', label: 'Código EPSG' },
    { key: 'spatial_extent', label: 'Extensión espacial (minX, maxX, minY, maxY)' },
    { key: 'minimum_optimal_scale', label: 'Escala óptima mínima' },
    { key: 'maximum_optimal_scale', label: 'Escala óptima máxima' },
    { key: 'owner', label: 'Propietario' },
    { key: 'publication_date', label: 'Fecha de publicación' },
    { key: 'publication_frequency', label: 'Frecuencia de publicación' },
    { key: 'license', label: 'Licencia' },
    { key: 'license_attribution', label: 'Atribución de licencia' },
    { key: 'confidentiality', label: 'Confidencialidad' },
    { key: 'creation_date', label: 'Fecha de creación (metadatos)' },
    { key: 'update_date', label: 'Última actualización (metadatos)' },
    { key: 'update_time', label: 'Última actualización (metadatos)' },
    { key: 'data_last_update', label: 'Última actualización de los datos' },
  ];

  // Columnas técnicas/redundantes que no aportan valor al usuario final en el
  // modal (identificadores internos, referencias a la tabla/esquema ya
  // mostradas en el título, o volcados crudos como "qmd"/"extent").
  const METADATA_HIDDEN_FIELDS = [
    'id', 'uid', 'table_name', 'schema_name',
    'f_table_catalog', 'f_table_schema', 'f_table_name', 'f_geometry_column',
    'geom', 'extent', 'qmd','identifier'
  ];

  function formatMetadataFieldLabel(key) {
    return key
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  function formatMetadataFieldValue(value) {
    if (value === null || value === undefined || value === '') return '—';
    if (Array.isArray(value) || typeof value === 'object') {
      return JSON.stringify(value, null, 2);
    }
    return String(value);
  }

  function buildMetadataFieldsHtml(metadata) {
    let fieldsHtml = '';
    const renderedKeys = new Set();

    METADATA_FIELD_CONFIG.forEach(({ key, label }) => {
      if (!(key in metadata)) return;
      const value = metadata[key];
      renderedKeys.add(key);
      if (value === null || value === undefined || value === '') return;
      fieldsHtml += `
        <div class="metadata-field">
          <span class="metadata-field-label">${label}</span>
          <span class="metadata-field-value">${formatMetadataFieldValue(value)}</span>
        </div>
      `;
    });

    // Campos no contemplados en la config (ni ocultos): se muestran igual, al final.
    Object.keys(metadata).forEach((key) => {
      if (renderedKeys.has(key)) return;
      if (METADATA_HIDDEN_FIELDS.includes(key.toLowerCase())) return;
      const value = metadata[key];
      if (value === null || value === undefined || value === '') return;
      fieldsHtml += `
        <div class="metadata-field">
          <span class="metadata-field-label">${formatMetadataFieldLabel(key)}</span>
          <span class="metadata-field-value">${formatMetadataFieldValue(value)}</span>
        </div>
      `;
    });

    return fieldsHtml;
  }

  function openMetadataModal() {
    if (!metadataModalOverlay) return;
    metadataModalOverlay.style.display = 'flex';
  }

  function closeMetadataModal() {
    if (!metadataModalOverlay) return;
    metadataModalOverlay.style.display = 'none';
  }

  if (metadataModalClose) {
    metadataModalClose.addEventListener('click', closeMetadataModal);
  }
  if (metadataModalOverlay) {
    metadataModalOverlay.addEventListener('click', (e) => {
      if (e.target === metadataModalOverlay) closeMetadataModal();
    });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMetadataModal();
  });

  async function showLayerMetadata(tableName, displayName) {
    if (!metadataModalOverlay || !metadataModalBody) return;

    if (metadataModalTitle) {
      metadataModalTitle.textContent = `Metadatos: ${displayName || tableName}`;
    }
    metadataModalBody.innerHTML = '<div class="metadata-modal-empty">Cargando metadatos...</div>';
    openMetadataModal();

    try {
      const response = await fetch(`/api/v1/layers/${tableName}/metadata`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();

      if (!data.has_metadata || !data.metadata) {
        metadataModalBody.innerHTML = '<div class="metadata-modal-empty">Esta capa no tiene metadatos registrados.</div>';
        return;
      }

      const metadata = data.metadata;

      // Si el metadato trae un título propio, se usa como encabezado del modal.
      if (metadataModalTitle && metadata.title) {
        metadataModalTitle.textContent = `Metadatos: ${metadata.title}`;
      }

      const fieldsHtml = buildMetadataFieldsHtml(metadata);

      metadataModalBody.innerHTML = fieldsHtml
        || '<div class="metadata-modal-empty">Esta capa no tiene metadatos registrados.</div>';
    } catch (error) {
      console.error('Error al obtener los metadatos de la capa:', error);
      metadataModalBody.innerHTML = '<div class="metadata-modal-empty">No se pudieron cargar los metadatos. Verifique la conexión con el backend.</div>';
    }
  }

  document.addEventListener('click', (e) => {
    const metadataBtn = e.target.closest('.metadata-btn[data-table]');
    if (!metadataBtn) return;
    const tableName = metadataBtn.getAttribute('data-table');
    const displayName = metadataBtn.getAttribute('data-display-name');
    showLayerMetadata(tableName, displayName);
  });

  function renderInfoPanel() {
    const infoContent = document.getElementById('infoPanelContent');
    if (!infoContent) return;

    const pointHtml = buildPointCardHtml();
    const filterHtml = (isFilterActive && currentFilterData) ? buildFilterSummaryHtml() : '';
    const bloqueFilterHtml = (isBloqueFilterActive && currentBloqueFilterData) ? buildBloqueFilterSummaryHtml() : '';
    const metadataHtml = buildActiveLayersMetadataHtml();

    let html = '';
    let bloques = [];
    if (pointHtml) bloques.push(pointHtml);
    if (filterHtml) bloques.push(filterHtml);
    if (bloqueFilterHtml) bloques.push(bloqueFilterHtml);

    if (bloques.length > 0) {
      html = bloques.map((b, i) => (i === 0 ? b : `<div style="margin-top: 12px;">${b}</div>`)).join('');
    } else {
      html = `<div class="info-card"><div class="ic-label">Información</div><p style="margin: 4px 0; font-size: 0.75rem; color: var(--muted-500);">Seleccione un estado o un bloque y aplique el filtro, o haga clic en un punto del mapa, para ver los detalles.</p></div>`;
    }

    if (metadataHtml) html += metadataHtml;

    infoContent.innerHTML = html;

    if (filterHtml) attachFilterDownloadListeners();
    if (bloqueFilterHtml) attachBloqueFilterDownloadListeners();

    const infoPanel = document.getElementById('infoPanel');
    const appContainer = document.querySelector('.app');
    if (infoPanel && infoPanel.classList.contains('collapsed')) {
      infoPanel.classList.remove('collapsed');
      if (appContainer) appContainer.classList.remove('has-collapsed-info');
      setTimeout(() => map.resize(), 300);
    }
  }

  function buildFilterSummaryHtml() {
    if (!currentFilterData) return '';
    const { estadoSeleccionado: estadoNombre, totalPuntosGeneral, capasContadas, rowsHtml } = currentFilterData;

    let html = `<div class="info-card">`;
    html += `<div class="ic-label">Estado: ${estadoNombre}</div>`;
    html += `<hr style="border:0; border-top:1px solid var(--line-700); margin:8px 0;">`;
    html += `<table id="tablaPuntosEstado" style="width:100%; font-size:0.75rem; border-collapse: collapse;">`;
    html += `<tr style="border-bottom: 1px solid var(--line-700);"><th style="text-align:left; padding:4px;">Capa / Elemento</th><th style="text-align:right; padding:4px;">Cantidad</th></tr>`;
    html += rowsHtml;

    if (capasContadas === 0) {
      html += `<tr><td colspan="2" style="padding:6px; text-align:center; color: var(--muted-500);">No hay capas de puntos activas en este momento. Active alguna capa en el panel izquierdo.</td></tr>`;
    }

    html += `</table>`;
    if (capasContadas > 0) {
      html += `<p style="margin-top: 8px; font-size: 0.75rem;"><b>Total de puntos en el estado:</b> ${totalPuntosGeneral}</p>`;
      html += `<button type="button" id="downloadPdfBtn" style="width: 100%; margin-top: 10px; background: var(--accent-color, #3182ce); color: white; border: none; padding: 6px; border-radius: 4px; font-size: 0.75rem; cursor: pointer; font-weight: 500;">Descargar Tabla en PDF</button>`;
      html += `<button type="button" id="downloadExcelBtn" style="width: 100%; margin-top: 6px; background: #2f855a; color: white; border: none; padding: 6px; border-radius: 4px; font-size: 0.75rem; cursor: pointer; font-weight: 500;">Descargar Tablas en Excel</button>`;
    }
    html += `</div>`;
    return html;
  }

  function buildBloqueFilterSummaryHtml() {
    if (!currentBloqueFilterData) return '';
    const { bloqueSeleccionado: bloqueNombre, totalPuntosGeneral, capasContadas, rowsHtml } = currentBloqueFilterData;

    let html = `<div class="info-card">`;
    html += `<div class="ic-label">Bloque: ${bloqueNombre}</div>`;
    html += `<hr style="border:0; border-top:1px solid var(--line-700); margin:8px 0;">`;
    html += `<table id="tablaPuntosBloque" style="width:100%; font-size:0.75rem; border-collapse: collapse;">`;
    html += `<tr style="border-bottom: 1px solid var(--line-700);"><th style="text-align:left; padding:4px;">Capa / Elemento</th><th style="text-align:right; padding:4px;">Cantidad</th></tr>`;
    html += rowsHtml;

    if (capasContadas === 0) {
      html += `<tr><td colspan="2" style="padding:6px; text-align:center; color: var(--muted-500);">No hay capas de puntos activas en este momento. Active alguna capa en el panel izquierdo.</td></tr>`;
    }

    html += `</table>`;
    if (capasContadas > 0) {
      html += `<p style="margin-top: 8px; font-size: 0.75rem;"><b>Total de puntos en el bloque:</b> ${totalPuntosGeneral}</p>`;
      html += `<button type="button" id="downloadPdfBtnBloque" style="width: 100%; margin-top: 10px; background: #8a4baf; color: white; border: none; padding: 6px; border-radius: 4px; font-size: 0.75rem; cursor: pointer; font-weight: 500;">Descargar Tabla en PDF</button>`;
      html += `<button type="button" id="downloadExcelBtnBloque" style="width: 100%; margin-top: 6px; background: #2f855a; color: white; border: none; padding: 6px; border-radius: 4px; font-size: 0.75rem; cursor: pointer; font-weight: 500;">Descargar Tablas en Excel</button>`;
    }
    html += `</div>`;
    return html;
  }

  function attachFilterDownloadListeners() {
    if (!currentFilterData) return;
    const { estadoSeleccionado: estadoNombre, totalPuntosGeneral, capasDetalleMap } = currentFilterData;

    const downloadPdfBtn = document.getElementById('downloadPdfBtn');
    if (downloadPdfBtn) {
      downloadPdfBtn.addEventListener('click', () => {
        generarReportePDF('Estado', estadoNombre, totalPuntosGeneral, capasDetalleMap, document.getElementById('tablaPuntosEstado'));
      });
    }

    const downloadExcelBtn = document.getElementById('downloadExcelBtn');
    if (downloadExcelBtn) {
      downloadExcelBtn.addEventListener('click', () => {
        generarReporteExcel(estadoNombre, capasDetalleMap, document.getElementById('tablaPuntosEstado'));
      });
    }
  }

  function attachBloqueFilterDownloadListeners() {
    if (!currentBloqueFilterData) return;
    const { bloqueSeleccionado: bloqueNombre, totalPuntosGeneral, capasDetalleMap } = currentBloqueFilterData;

    const downloadPdfBtnBloque = document.getElementById('downloadPdfBtnBloque');
    if (downloadPdfBtnBloque) {
      downloadPdfBtnBloque.addEventListener('click', () => {
        generarReportePDF('Bloque', bloqueNombre, totalPuntosGeneral, capasDetalleMap, document.getElementById('tablaPuntosBloque'));
      });
    }

    const downloadExcelBtnBloque = document.getElementById('downloadExcelBtnBloque');
    if (downloadExcelBtnBloque) {
      downloadExcelBtnBloque.addEventListener('click', () => {
        generarReporteExcel(bloqueNombre, capasDetalleMap, document.getElementById('tablaPuntosBloque'));
      });
    }
  }

  function generarReportePDF(etiqueta, nombreSeleccionado, totalPuntosGeneral, capasDetalleMap, tablaResumenEl) {
    let detalleHtml = '';

    if (Object.keys(capasDetalleMap).length > 0) {
      const excludedKeys = new Set(['id', 'geoid', 'gid', 'objectid']);

      for (let nombreCapa in capasDetalleMap) {
        const listaProps = capasDetalleMap[nombreCapa];
        const allKeysSet = new Set();

        listaProps.forEach(props => {
          for (let key in props) {
            const lowerKey = key.toLowerCase();
            const isExcluded =
              excludedKeys.has(lowerKey) ||
              lowerKey.endsWith('_id') ||
              lowerKey.startsWith('id_');
            if (!isExcluded) {
              allKeysSet.add(key);
            }
          }
        });

        const columns = Array.from(allKeysSet);

        detalleHtml += `
          <div style="margin-top: 25px; page-break-inside: avoid;">
            <h3 style="color: #1a365d; font-size: 14px; border-bottom: 2px solid #3182ce; padding-bottom: 4px; margin-bottom: 8px; text-transform: capitalize;">Detalle de ${nombreCapa}</h3>
            <table>
              <thead>
                <tr>
                  <th style="background-color: #f4f4f4; border: 1px solid #ddd; padding: 5px; font-size: 11px; width: 35px; text-align: center;">#</th>
                  ${columns.map(col => `<th style="background-color: #f4f4f4; border: 1px solid #ddd; padding: 5px; font-size: 11px;">${col}</th>`).join('')}
                </tr>
              </thead>
              <tbody>
        `;

        listaProps.forEach((props, index) => {
          detalleHtml += `
            <tr>
              <td style="border: 1px solid #ddd; padding: 5px; font-size: 11px; text-align: center;">${index + 1}</td>
          `;
          columns.forEach(col => {
            const val = props[col] !== undefined ? props[col] : '';
            detalleHtml += `<td style="border: 1px solid #ddd; padding: 5px; font-size: 11px;">${val}</td>`;
          });
          detalleHtml += `</tr>`;
        });

        detalleHtml += `
              </tbody>
            </table>
          </div>
        `;
      }
    }

    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
      <html>
        <head>
          <title>Reporte de Puntos - ${nombreSeleccionado}</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 20px; color: #333; }
            .header-container { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #1a365d; padding-bottom: 10px; margin-bottom: 15px; }
            .logo-container img {
              max-height: 45px;
              width: auto;
              object-fit: contain;
              display: block;
            }
            h2 { color: #1a365d; margin: 0; font-size: 18px; text-align: right; }
            table { width: 100%; border-collapse: collapse; margin-top: 5px; }
            th, td { border: 1px solid #ddd; padding: 5px 7px; text-align: left; font-size: 11px; }
            th { background-color: #f4f4f4; }
            .total { margin-top: 15px; font-weight: bold; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="header-container">
            <div class="logo-container">
            <img src="${LOGO_EMPRESA_BASE64}" alt="" width="445" height="169" />
            </div>
            <div>
              <h2>Reporte Estratégico de Puntos</h2>
              <p style="margin: 4px 0 0 0; font-size: 12px; text-align: right; color: #555;"><b>${etiqueta}:</b> ${nombreSeleccionado}</p>
            </div>
          </div>
          <table>
            <tr><th style="font-size: 11px;">Capa / Elemento</th><th style="text-align:right; font-size: 11px;">Cantidad</th></tr>
            ${tablaResumenEl ? tablaResumenEl.innerHTML : ''}
          </table>
          <div class="total">Total general de puntos: ${totalPuntosGeneral}</div>
          ${detalleHtml}
          <script>
            window.onload = function() { window.print(); window.close(); }
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  }

  function generarReporteExcel(nombreSeleccionado, capasDetalleMap, tablaResumenEl) {
    if (typeof XLSX === 'undefined') {
      alert('La librería SheetJS (XLSX) no está cargada.');
      return;
    }

    const wb = XLSX.utils.book_new();

    if (tablaResumenEl) {
      const wsResumen = XLSX.utils.table_to_sheet(tablaResumenEl);
      XLSX.utils.book_append_sheet(wb, wsResumen, "Resumen General");
    }

    if (Object.keys(capasDetalleMap).length > 0) {
      const excludedKeys = new Set(['id', 'geoid', 'gid', 'objectid']);

      for (let nombreCapa in capasDetalleMap) {
        const listaProps = capasDetalleMap[nombreCapa];
        const rowsForSheet = [];

        listaProps.forEach((props, index) => {
          let cleanRow = { "#": index + 1 };
          for (let key in props) {
            const lowerKey = key.toLowerCase();
            const isExcluded =
              excludedKeys.has(lowerKey) ||
              lowerKey.endsWith('_id') ||
              lowerKey.startsWith('id_');
            if (!isExcluded) {
              cleanRow[key] = props[key] !== undefined ? props[key] : '';
            }
          }
          rowsForSheet.push(cleanRow);
        });

        if (rowsForSheet.length > 0) {
          const wsDetalle = XLSX.utils.json_to_sheet(rowsForSheet);
          let sheetName = nombreCapa.substring(0, 31);
          XLSX.utils.book_append_sheet(wb, wsDetalle, sheetName);
        }
      }
    }

    XLSX.writeFile(wb, `Reporte_Puntos_${nombreSeleccionado.replace(/\s+/g, '_')}.xlsx`);
  }

});

function cerrarSesion() {
  localStorage.removeItem('auth_session');
  sessionStorage.clear();
  window.location.href = 'login.html';
}

function obtenerNombreEstado(properties) {
  const posiblesClaves = ['entidad', 'estado', 'nombre', 'name'];
  const keysReales = Object.keys(properties);

  for (const clave of posiblesClaves) {
    const encontrada = keysReales.find(k => k.toLowerCase() === clave);
    if (encontrada && properties[encontrada] !== undefined && properties[encontrada] !== null) {
      return String(properties[encontrada]).trim();
    }
  }
  return null;
}

function obtenerNombreBloque(properties) {
  const posiblesClaves = ['bloque', 'nombre', 'name'];
  const keysReales = Object.keys(properties);

  for (const clave of posiblesClaves) {
    const encontrada = keysReales.find(k => k.toLowerCase() === clave);
    if (encontrada && properties[encontrada] !== undefined && properties[encontrada] !== null) {
      return String(properties[encontrada]).trim();
    }
  }
  return null;
}