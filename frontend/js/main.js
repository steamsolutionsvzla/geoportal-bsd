document.addEventListener('DOMContentLoaded', () => {

  // =========================================================================
  // VARIABLES GLOBALES DE ESTADO DE SELECCIÓN
  // =========================================================================
  let selectedFeatureId = null;
  let selectedSourceId = null;
  let availableLayers = []; // Almacenará dinámicamente las capas de la BD

  // =========================================================================
  // 1. INICIALIZACIÓN CON ESTILO BASE CLARO
  // =========================================================================
  let activeBasemap = 'clara';
  const map = new maplibregl.Map({
    container: 'map',
    style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
    center: [-67.2, 10.4],
    renderWorldCopies: false,
    zoom: 6.8,
    maxTileCacheSize: 30,
    fadeDuration: 0,
    attributionControl: false
  });

  // =========================================================================
  // 2. REGISTRO DE CAPAS SUPERPUESTAS Y CARGA DINÁMICA
  // =========================================================================
  map.on('load', async () => {

    // --- CAPA: VISTA CLARA (CARTO VOYAGER) ---
    map.addSource('clara-source', {
      type: 'raster',
      tiles: [
        'https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png',
        'https://b.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png',
        'https://c.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png'
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

    // --- CAPA: VISTA SATELITAL BASE (ESRI) ---
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

    // --- CAPA: ETIQUETAS HÍBRIDAS PARA SATÉLITE ---
    map.addSource('satelite-labels-source', {
      type: 'raster',
      tiles: [
        'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'
      ],
      tileSize: 256
    });

    map.addLayer({
      id: 'satelite-labels-layer',
      type: 'raster',
      source: 'satelite-labels-source',
      layout: { visibility: 'none' },
      minzoom: 0,
      maxzoom: 19
    });

    // Calcular escala inicial una vez cargado el mapa
    updateScaleKm();

    // =========================================================================
    // 2.1. CARGA DINÁMICA DE CAPAS DESDE LA BD (VIA FASTAPI)
    // =========================================================================
    const layerListContainer = document.getElementById('layerList');

    try {
      const response = await fetch('http://localhost:8000/api/v1/layers/list');
      const data = await response.json();
      
      // Asignamos las capas devueltas por el servicio (ya vienen ordenadas alfabéticamente)
      availableLayers = data.layers;

      if (layerListContainer) {
        layerListContainer.innerHTML = ''; 
        
        availableLayers.forEach(layerInfo => {
          const row = document.createElement('div');
          row.className = 'layer-row off';
          row.innerHTML = `
            <div class="swatch" style="background: ${layerInfo.color};"></div>
            <div class="lname">${layerInfo.name}</div>
            <div class="toggle" data-table="${layerInfo.id}"></div>
          `;
          layerListContainer.appendChild(row);
        });
      }
    } catch (error) {
      console.error("Error al obtener la lista de capas de la BD:", error);
      if (layerListContainer) {
        layerListContainer.innerHTML = '<div style="color: #ff5722; font-size: 0.8rem; padding: 10px; text-align: center;">Error al conectar con la BD.</div>';
      }
    }

    // Función para actualizar dinámicamente la leyenda flotante con estilo cartográfico
    function updateLegendUI() {
      const legendList = document.getElementById('legendList') || document.querySelector('.legend-content');
      if (!legendList) return;

      legendList.innerHTML = '';
      
      const activeToggles = document.querySelectorAll('.toggle.on[data-table]');
      
      if (activeToggles.length === 0) {
        legendList.innerHTML = '<div style="font-size: 0.8rem; color: #a0a0a0; padding: 8px; text-align: center;">No hay capas activas en el mapa.</div>';
        return;
      }

      const categoryTitle = document.createElement('div');
      categoryTitle.style.cssText = 'font-size: 0.75rem; font-weight: bold; color: #888; text-transform: uppercase; margin-bottom: 8px; letter-spacing: 0.5px;';
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
            symbolHTML = `<div style="width: 20px; height: 14px; background: ${layerConfig.color}; opacity: 0.8; border: 1px solid #000; border-radius: 2px; margin-right: 10px; flex-shrink: 0;"></div>`;
          } else if (layerConfig.type === 'line') {
            symbolHTML = `<div style="width: 24px; height: 4px; background: ${layerConfig.color}; border-radius: 2px; margin-right: 10px; flex-shrink: 0;"></div>`;
          } else {
            symbolHTML = `
              <div style="width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; margin-right: 10px; flex-shrink: 0;">
                <div style="width: 10px; height: 10px; background: ${layerConfig.color}; border: 1.5px solid #ffffff; border-radius: 50%; box-shadow: 0 0 0 1px #000;"></div>
              </div>`;
          }

          item.innerHTML = `
            <span style="font-size: 0.8rem; color: #e0e0e0; font-weight: 500;">${layerConfig.name}</span>
            ${symbolHTML}
          `;
          
          legendList.appendChild(item);
        });
      });
    }

    // Manejador de eventos para activar o desactivar capas geográficas
    if (layerListContainer) {
      layerListContainer.addEventListener('click', async (e) => {
        const toggleBtn = e.target.closest('.toggle[data-table]');
        if (!toggleBtn) return;
        
        e.stopPropagation();
        toggleBtn.classList.toggle('on');
        
        const row = toggleBtn.closest('.layer-row');
        if (row) row.classList.toggle('off', !toggleBtn.classList.contains('on'));

        const tableName = toggleBtn.getAttribute('data-table');
        const sourceId = `source-${tableName}`;
        const layerId = `layer-${tableName}`;
        const isVisible = toggleBtn.classList.contains('on');

        if (isVisible) {
          try {
            const response = await fetch(`/api/v1/layers/${tableName}`);
            const data = await response.json();

            if (!data.features || data.features.length === 0) {
              alert(`La capa "${tableName}" no devolvió registros desde la base de datos.`);
              toggleBtn.classList.remove('on');
              if (row) row.classList.add('off');
              refreshCount();
              updateLegendUI();
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
            if (row) row.classList.add('off');
          }
        } else {
          if (selectedSourceId === sourceId) {
            selectedFeatureId = null;
            selectedSourceId = null;
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
      });
    }

    // Manejador general de clics en el mapa para deseleccionar si se hace clic fuera de una entidad
    map.on('click', (e) => {
      const features = map.queryRenderedFeatures(e.point);
      const clickedOnLayerFeature = features.some(f => f.layer.id.startsWith('layer-'));

      if (!clickedOnLayerFeature) {
        if (selectedFeatureId !== null && selectedSourceId !== null) {
          map.setFeatureState(
            { source: selectedSourceId, id: selectedFeatureId },
            { selected: false }
          );
          selectedFeatureId = null;
          selectedSourceId = null;
        }
      }
    });

  }); // Fin de map.on('load')

  // Función auxiliar para inyectar la capa ordenando por jerarquía
  function addMapLayerDirectly(tableName, sourceId, layerId, availableLayers) {
    const layerConfig = availableLayers.find(l => l.id === tableName);
    const geomType = layerConfig ? layerConfig.type : 'circle';
    const geomColor = layerConfig ? layerConfig.color : '#ff5722';

    if (!map.getLayer(layerId)) {
      
      let beforeLayerId = undefined;
      const existingLayers = map.getStyle().layers;

      if (geomType === 'fill') {
        for (let l of existingLayers) {
          if (l.id.startsWith('layer-')) {
            const t = availableLayers.find(cfg => `layer-${cfg.id}` === l.id);
            if (t && (t.type === 'line' || t.type === 'circle')) {
              beforeLayerId = l.id;
              break;
            }
          }
        }
      } else if (geomType === 'line') {
        for (let l of existingLayers) {
          if (l.id.startsWith('layer-')) {
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
          'Oleoducto', '#ff7043', 
          'Gasducto', '#ffeb3b', 
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

        const infoContent = document.getElementById('infoPanelContent');
        if (infoContent) {
          let html = `<div class="info-card"><div class="ic-label">Capa: ${tableName}</div><hr style="border:0; border-top:1px solid var(--line-700); margin:8px 0;">`;
          for (let key in props) {
            html += `<p style="margin: 4px 0; font-size: 0.75rem;"><b>${key}:</b> ${props[key]}</p>`;
          }
          html += `</div>`;
          infoContent.innerHTML = html;

          const infoPanel = document.getElementById('infoPanel');
          const appContainer = document.querySelector('.app');
          if (infoPanel && infoPanel.classList.contains('collapsed')) {
            infoPanel.classList.remove('collapsed');
            if (appContainer) appContainer.classList.remove('has-collapsed-info');
            setTimeout(() => map.resize(), 300);
          }
        }
      });
    }
  }

  // =========================================================================
  // 3. CAMBIADOR DINÁMICO DE VISIBILIDAD (SOPORTE PARA "NINGUNO")
  // =========================================================================
  function switchBasemap(targetKey) {
    if (targetKey === activeBasemap) return;

    const overlayLayers = ['clara-layer', 'satelite-layer', 'satelite-labels-layer'];
    
    overlayLayers.forEach(layerId => {
      if (map.getLayer(layerId)) {
        map.setLayoutProperty(layerId, 'visibility', 'none');
      }
    });

    if (map.getLayer('background')) {
      if (targetKey === 'ninguno') {
        map.setPaintProperty('background', 'background-color', '#ffffff');
        map.setLayoutProperty('background', 'visibility', 'visible');
      } else {
        map.setPaintProperty('background', 'background-color', '#f4f4f4');
        map.setLayoutProperty('background', 'visibility', 'visible');
      }
    }

    if (targetKey === 'clara' && map.getLayer('clara-layer')) {
      map.setLayoutProperty('clara-layer', 'visibility', 'visible');
    } else if (targetKey === 'satelite' && map.getLayer('satelite-layer')) {
      map.setLayoutProperty('satelite-layer', 'visibility', 'visible');
      if (map.getLayer('satelite-labels-layer')) {
        map.setLayoutProperty('satelite-labels-layer', 'visibility', 'visible');
      }
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
  // 4. CONTROLADOR DE PANELES (SIDEBAR IZQUIERDO Y PANEL DE INFORMACIÓN DERECHO)
  // =========================================================================
  const appContainer = document.querySelector('.app');
  const sidebar = document.getElementById('sidebar');
  const sidebarToggleBtn = document.getElementById('sidebarToggleBtn');
  const topbarCapasBtn = document.querySelector('.icon-btn.active');
  
  const infoPanel = document.getElementById('infoPanel');
  const infoToggleBtn = document.getElementById('infoToggleBtn');

  function triggerMapResize() {
    let resizeFrames = 0;
    const resizeInterval = setInterval(() => {
      if (map && map.resize) map.resize();
      resizeFrames++;
      if (resizeFrames > 15) clearInterval(resizeInterval);
    }, 20);
  }

  function toggleSidebarState() {
    if (!sidebar || !appContainer) return;
    
    sidebar.classList.toggle('collapsed');
    appContainer.classList.toggle('has-collapsed-sidebar');

    const isCollapsed = sidebar.classList.contains('collapsed');

    if (topbarCapasBtn) {
      topbarCapasBtn.classList.toggle('active', !isCollapsed);
    }

    triggerMapResize();
  }

  if (sidebarToggleBtn) {
    sidebarToggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleSidebarState();
    });
  }

  if (topbarCapasBtn) {
    topbarCapasBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleSidebarState();
    });
  }

  function toggleInfoPanelState() {
    if (!infoPanel || !appContainer) return;

    infoPanel.classList.toggle('collapsed');
    appContainer.classList.toggle('has-collapsed-info');

    triggerMapResize();
  }

  if (infoToggleBtn) {
    infoToggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleInfoPanelState();
    });
  }

  // =========================================================================
  // 5. CONTROLADOR DE VENTANA EMERGENTE DE LEYENDA (BOTÓN FLOTANTE)
  // =========================================================================
  const legendSwitch = document.querySelector('.legend-switch');
  const legendToggleBtn = document.getElementById('legendToggleBtn');
  const closeLegendBtn = document.getElementById('closeLegendBtn');

  if (legendToggleBtn && legendSwitch) {
    legendToggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      legendSwitch.classList.toggle('open');
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

  // =========================================================================
  // 6. COORDENADAS EN GRADOS DECIMALES
  // =========================================================================
  const statCoord = document.getElementById('statCoord');

  map.on('mousemove', (e) => {
    const { lng, lat } = e.lngLat;
    const latFormatted = `${Math.abs(lat).toFixed(5)}° ${lat >= 0 ? 'N' : 'S'}`;
    const lngFormatted = `${Math.abs(lng).toFixed(5)}° ${lng >= 0 ? 'E' : 'W'}`;

    if (statCoord) {
      statCoord.textContent = `${latFormatted} ${lngFormatted}`;
    }
  });

  // =========================================================================
  // 7. CÁLCULO DE ESCALA EN KM Y CONTROLES DE ZOOM
  // =========================================================================
  const statZoom = document.getElementById('statZoom');
  const statScale = document.getElementById('statScale');

  function getDistanceFromLatLonInKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  function updateScaleKm() {
    const bounds = map.getBounds();
    const center = map.getCenter();
    const distanceKm = getDistanceFromLatLonInKm(center.lat, bounds.getWest(), center.lat, bounds.getEast());

    if (statScale) {
      if (distanceKm < 1) {
        statScale.textContent = `${Math.round(distanceKm * 1000)} m`;
      } else {
        statScale.textContent = `${distanceKm.toFixed(1)} km`;
      }
    }
  }

  function updateZoomDisplay() {
    const currentZoom = map.getZoom();
    if (statZoom) statZoom.textContent = currentZoom.toFixed(1);
    updateScaleKm();
  }

  map.on('zoom', updateZoomDisplay);
  map.on('move', updateScaleKm);

  const zoomInBtn = document.getElementById('zoomIn');
  const zoomOutBtn = document.getElementById('zoomOut');
  if (zoomInBtn) zoomInBtn.addEventListener('click', () => map.zoomIn());
  if (zoomOutBtn) zoomOutBtn.addEventListener('click', () => map.zoomOut());

  // =========================================================================
  // 8. COMPONENTES DE INTERFAZ (UI)
  // =========================================================================
  const layerCountEl = document.getElementById('layerCount');
  function refreshCount() {
    if (!layerCountEl) return;
    const on = document.querySelectorAll('.toggle.on').length;
    layerCountEl.textContent = on + (on === 1 ? ' activa' : ' activas');
  }

  refreshCount();

  function buildTicks(el, count) {
    if (!el) return;
    el.innerHTML = '';
    for (let i = 0; i < count; i++) {
      const d = document.createElement('div');
      d.className = 'tick';
      el.appendChild(d);
    }
  }
  buildTicks(document.getElementById('gratTop'), 24);
  buildTicks(document.getElementById('gratBottom'), 24);
  buildTicks(document.getElementById('gratLeft'), 18);
  buildTicks(document.getElementById('gratRight'), 18);

});
function cerrarSesion() {
    // Si guardas datos de sesión, límpialos aquí (opcional):
    // localStorage.clear();
    // sessionStorage.clear();

    // Redirige al index (cambia 'index.html' por la ruta de tu página de inicio si es distinta)
    window.location.href = 'index.html';
}