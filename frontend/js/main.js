document.addEventListener('DOMContentLoaded', () => {

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
  map.on('load', () => {

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
    // 2.1. CARGA DINÁMICA DE CAPAS DESDE FASTAPI (POSTGIS)
    // =========================================================================
    const availableLayers = [
      { id: 'Bloques_Campos_petroleros', name: 'Bloques y Campos Petroleros', type: 'fill', color: '#ff9800' },
      { id: 'Distrito_Anaco', name: 'Distrito Anaco', type: 'fill', color: '#4caf50' },
      { id: 'Distrito_San_Tome', name: 'Distrito San Tomé', type: 'fill', color: '#2196f3' },
      { id: 'Estaciones', name: 'Estaciones', type: 'circle', color: '#f44336' },
      { id: 'Fosas_estaciones', name: 'Fosas Estaciones', type: 'circle', color: '#9c27b0' },
      { id: 'Fosas_plantas', name: 'Fosas Plantas', type: 'circle', color: '#673ab7' },
      { id: 'Plantas', name: 'Plantas', type: 'circle', color: '#3ab7ad' },
      { id: 'Fosas_pozos', name: 'Fosas Pozos', type: 'circle', color: '#3f51b5' },
      { id: 'Limite_FPO_2012', name: 'Límite FPO 2012', type: 'fill', color: '#e91e63' },
      { id: 'Tuberias_oleoductos_gasoductos_FPO', name: 'Oleoductos y Gasoductos FPO', type: 'line', color: '#795548' }
    ];

    const layerListContainer = document.getElementById('layerList');

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

    // Función para actualizar dinámicamente la leyenda flotante según las capas activas
    function updateLegendUI() {
      const legendList = document.getElementById('legendList') || document.querySelector('.legend-content');
      if (!legendList) return;

      legendList.innerHTML = '';
      
      const activeToggles = document.querySelectorAll('.toggle.on[data-table]');
      
      if (activeToggles.length === 0) {
        legendList.innerHTML = '<div style="font-size: 0.8rem; color: #6c757d; padding: 8px;">No hay capas activas en el mapa.</div>';
        return;
      }

      activeToggles.forEach(toggle => {
        const tableName = toggle.getAttribute('data-table');
        const layerConfig = availableLayers.find(l => l.id === tableName);
        if (!layerConfig) return;

        const item = document.createElement('div');
        item.className = 'legend-item';
        item.style.display = 'flex';
        item.style.alignItems = 'center';
        item.style.marginBottom = '6px';
        
        let symbolHTML = '';
        if (layerConfig.type === 'fill') {
          symbolHTML = `<div style="width: 14px; height: 14px; background: ${layerConfig.color}; border: 1px solid #000; border-radius: 2px; margin-right: 8px; flex-shrink: 0;"></div>`;
        } else if (layerConfig.type === 'line') {
          symbolHTML = `<div style="width: 14px; height: 4px; background: ${layerConfig.color}; border: 1px solid #000; margin-right: 8px; flex-shrink: 0; align-self: center;"></div>`;
        } else {
          symbolHTML = `<div style="width: 12px; height: 12px; background: ${layerConfig.color}; border: 1.5px solid #000; border-radius: 50%; margin-right: 8px; flex-shrink: 0;"></div>`;
        }

        item.innerHTML = `
          ${symbolHTML}
          <span style="font-size: 0.8rem; color: var(--text-main, #333);">${layerConfig.name}</span>
        `;
        legendList.appendChild(item);
      });
    }

    // Manejador de eventos para activar o desactivar capas geográficas
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
          const response = await fetch(`http://localhost:8000/api/v1/layers/${tableName}`);
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
              generateId: true // Importante para que MapLibre gestione los estados de hover/click por ID
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

  }); // Fin de map.on('load')

  // Función auxiliar para inyectar la capa con soporte interactivo de Hover
  function addMapLayerDirectly(tableName, sourceId, layerId, availableLayers) {
    const layerConfig = availableLayers.find(l => l.id === tableName);
    const geomType = layerConfig ? layerConfig.type : 'circle';
    const geomColor = layerConfig ? layerConfig.color : '#ff5722';

    if (!map.getLayer(layerId)) {
      if (geomType === 'circle') {
        map.addLayer({
          id: layerId,
          type: 'circle',
          source: sourceId,
          paint: {
            'circle-radius': [
              'case',
              ['boolean', ['feature-state', 'hover'], false], 9, // Crece al hacer hover
              6
            ],
            'circle-color': geomColor,
            'circle-stroke-width': [
              'case',
              ['boolean', ['feature-state', 'hover'], false], 3, // Borde negro grueso al pasar el ratón
              1
            ],
            'circle-stroke-color': '#000000'
          }
        });
      } else if (geomType === 'fill') {
        map.addLayer({
          id: layerId,
          type: 'fill',
          source: sourceId,
          paint: {
            'fill-color': geomColor,
            'fill-opacity': [
              'case',
              ['boolean', ['feature-state', 'hover'], false], 0.8, // Se vuelve más opaco al hacer hover
              0.4
            ],
            'fill-outline-color': '#000000' // Contorno negro visible al hacer hover o normal
          }
        });
      } else if (geomType === 'line') {
        map.addLayer({
          id: layerId,
          type: 'line',
          source: sourceId,
          paint: {
            'line-color': geomColor,
            'line-width': [
              'case',
              ['boolean', ['feature-state', 'hover'], false], 5, // Línea más gruesa al pasar el ratón
              2
            ]
          }
        });
      }
    }

    // Configurar eventos de hover, clic e interactividad una sola vez por capa
    if (!map.listenedClicks) map.listenedClicks = new Set();
    if (!map.listenedClicks.has(layerId)) {
      map.listenedClicks.add(layerId);
      
      let hoveredStateId = null;

      // Evento Mouse Enter (Efecto Hover)
      map.on('mousemove', layerId, (e) => {
        map.getCanvas().style.cursor = 'pointer';
        if (e.features.length > 0) {
          if (hoveredStateId !== null) {
            map.setFeatureState(
              { source: sourceId, id: hoveredStateId },
              { hover: false }
            );
          }
          hoveredStateId = e.features[0].id;
          map.setFeatureState(
            { source: sourceId, id: hoveredStateId },
            { hover: true }
          );
        }
      });

      // Evento Mouse Leave (Quitar Efecto Hover)
      map.on('mouseleave', layerId, () => {
        map.getCanvas().style.cursor = '';
        if (hoveredStateId !== null) {
          map.setFeatureState(
            { source: sourceId, id: hoveredStateId },
            { hover: false }
          );
        }
        hoveredStateId = null;
      });

      // Evento Click (Panel de Información)
      map.on('click', layerId, (ev) => {
        if (!ev.features || ev.features.length === 0) return;
        const props = ev.features[0].properties;
        const infoContent = document.getElementById('infoPanelContent');
        
        if (infoContent) {
          let html = `
            <div class="info-card">
              <div class="ic-label">Capa: ${tableName}</div>
              <hr style="border:0; border-top:1px solid var(--line-700); margin:8px 0;">
          `;
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
  const mapWrap = document.querySelector('.map-wrap');
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