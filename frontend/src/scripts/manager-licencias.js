import * as echarts from 'echarts';
import * as maplibregl from 'maplibre-gl';
import { initMap, addBaseLayers } from './map-config.js';
import { apiFetch } from './utils.js';

const LICENSES_ENDPOINT = '/api/v1/manager/licenses';
const STATES_ENDPOINT = '/api/v1/layers/' + encodeURIComponent('División Político Territorial');

const STATUS = {
  // `color`/`line` son la simbología del mapa (verde vigente / rojo culminada).
  // `chart` conserva la paleta azul que tenían los gráficos antes de ese cambio.
  VIGENTE: { label: 'Vigente', color: '#15803d', line: '#166534', chart: '#2d5296' },
  CULMINADA: { label: 'Culminada', color: '#dc2626', line: '#991b1b', chart: '#93b4e0' },
};
const STATUS_KEYS = ['VIGENTE', 'CULMINADA'];
// Límites que cubren todo el territorio nacional (incluye islas y la
// plataforma al norte); la vista inicial y el botón «Vista Venezuela»
// encuadran exactamente estos límites.
const VENEZUELA_BOUNDS = [[-73.95, 0.5], [-58.85, 13.15]];
// El mapa gerencial necesita alejarse más que el geoportal para que
// quepa Venezuela completa en un panel pequeño.
const MANAGER_MAP_BOUNDS = [[-79.5, -2.5], [-52.5, 18.5]];
const MANAGER_MIN_ZOOM = 3.4;
const VENEZUELA_PADDING = { top: 54, bottom: 48, left: 30, right: 30 };
const LABEL_TEXT_SIZE = [
  'interpolate',
  ['linear'],
  ['zoom'],
  3.4, 14,
  5, 18,
  6, 22,
  7, 26,
  9, 32,
  11, 38,
];

const state = {
  all: [],
  filtered: [],
  charts: {},
  map: null,
  mapReady: false,
  popup: null,
  selectedCode: null,
  sortKey: 'codigo',
  sortDir: 'asc',
  initialized: false,
};

const $ = (id) => document.getElementById(id);
const esc = (value) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function formatInt(value) {
  const n = num(value);
  return n === null ? '—' : n.toLocaleString('es-VE', { maximumFractionDigits: 0 });
}

function formatArea(value) {
  const n = num(value);
  if (n === null) return '—';
  return n.toLocaleString('es-VE', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function normalizeStatus(value) {
  return String(value ?? '').trim().toUpperCase();
}

function statusColor(value) {
  return STATUS[normalizeStatus(value)]?.color || '#94a3b8';
}

function setStatus(text, isError = false) {
  const el = $('licencias-status');
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('is-error', isError);
}

function setMapLoading(visible) {
  const el = $('manager-map-loading');
  if (el) el.hidden = !visible;
}

function showMapError(text) {
  const el = $('manager-map-error');
  if (!el) return;
  el.textContent = text;
  el.hidden = false;
  setMapLoading(false);
}

/* ------------------------------------------------------------------ */
/* Filtros                                                             */
/* ------------------------------------------------------------------ */

function fillSelect(id, values, allLabel) {
  const select = $(id);
  if (!select) return;
  const unique = [...new Set(values.filter((v) => v !== null && v !== undefined && v !== ''))];
  unique.sort((a, b) => {
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    return String(a).localeCompare(String(b), 'es');
  });
  select.innerHTML = `<option value="">${esc(allLabel)}</option>`;
  for (const value of unique) {
    const option = document.createElement('option');
    option.value = String(value);
    option.textContent = String(value);
    select.appendChild(option);
  }
}

function populateFilters(features) {
  const props = features.map((f) => f.properties || {});
  fillSelect('lic-filter-empresa', props.map((p) => p.empresa), 'Todas');
  fillSelect('lic-filter-tipo', props.map((p) => p.tipo), 'Todos');
  fillSelect('lic-filter-estatus', props.map((p) => p.estatus), 'Todos');
  fillSelect('lic-filter-anio', props.map((p) => p.anio), 'Todos');
}

function readFilters() {
  return {
    empresa: $('lic-filter-empresa')?.value || '',
    tipo: $('lic-filter-tipo')?.value || '',
    estatus: $('lic-filter-estatus')?.value || '',
    anio: $('lic-filter-anio')?.value || '',
  };
}

function applyFilters() {
  const { empresa, tipo, estatus, anio } = readFilters();
  state.filtered = state.all.filter((feature) => {
    const p = feature.properties || {};
    if (empresa && String(p.empresa ?? '') !== empresa) return false;
    if (tipo && String(p.tipo ?? '') !== tipo) return false;
    if (estatus && String(p.estatus ?? '') !== estatus) return false;
    if (anio && String(p.anio ?? '') !== anio) return false;
    return true;
  });
  state.selectedCode = null;
  state.popup?.remove();
  state.popup = null;
  if (state.map?.getSource('licencias-highlight')) {
    state.map.getSource('licencias-highlight').setData(EMPTY_FC);
  }
  updateMapData();
  renderKpis();
  renderCharts();
  renderTable();
}

/* ------------------------------------------------------------------ */
/* KPIs, gráficos                                                      */
/* ------------------------------------------------------------------ */

function countBy(features, key) {
  const counts = new Map();
  for (const feature of features) {
    const value = feature.properties?.[key];
    if (value === null || value === undefined || value === '') continue;
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return counts;
}

function renderKpis() {
  const total = state.filtered.length;
  const byEstatus = countBy(state.filtered, 'estatus');
  const area = state.filtered.reduce((sum, f) => sum + (num(f.properties?.area_km2) || 0), 0);
  if ($('lic-kpi-total')) $('lic-kpi-total').textContent = formatInt(total);
  if ($('lic-kpi-vigentes')) $('lic-kpi-vigentes').textContent = formatInt(byEstatus.get('VIGENTE') || 0);
  if ($('lic-kpi-culminadas')) $('lic-kpi-culminadas').textContent = formatInt(byEstatus.get('CULMINADA') || 0);
  if ($('lic-kpi-area')) $('lic-kpi-area').textContent = formatArea(area);
}

function chart(id) {
  const el = $(id);
  if (!el) return null;
  if (!state.charts[id]) {
    state.charts[id] = echarts.init(el, null, { renderer: 'canvas' });
  }
  return state.charts[id];
}

function emptyOption(text = 'Sin datos') {
  return {
    animation: false,
    title: {
      text,
      left: 'center',
      top: 'middle',
      textStyle: { color: '#94a3b8', fontSize: 12, fontWeight: 400 },
    },
  };
}

function statusDonutOption() {
  const counts = countBy(state.filtered, 'estatus');
  const entries = STATUS_KEYS
    .map((key) => ({
      name: STATUS[key].label,
      value: counts.get(key) || 0,
      color: STATUS[key].chart,
    }))
    .filter((entry) => entry.value > 0);

  if (!entries.length) return emptyOption();

  return {
    animationDuration: 350,
    tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
    legend: {
      bottom: 0,
      left: 'center',
      icon: 'circle',
      itemWidth: 7,
      itemHeight: 7,
      textStyle: { fontSize: 10, color: '#4b5563' },
    },
    series: [
      {
        type: 'pie',
        radius: ['46%', '70%'],
        center: ['50%', '43%'],
        avoidLabelOverlap: true,
        itemStyle: { borderColor: '#fff', borderWidth: 2 },
        label: { show: false },
        labelLine: { show: false },
        data: entries.map((entry) => ({
          name: entry.name,
          value: entry.value,
          itemStyle: { color: entry.color },
        })),
      },
    ],
  };
}

function groupedStatusCounts(features, key, sortMode = 'total') {
  const groups = new Map();
  for (const feature of features) {
    const raw = feature.properties?.[key];
    if (raw === null || raw === undefined || raw === '') continue;
    const name = String(raw);
    if (!groups.has(name)) {
      groups.set(name, { name, VIGENTE: 0, CULMINADA: 0, total: 0 });
    }
    const group = groups.get(name);
    const status = normalizeStatus(feature.properties?.estatus);
    if (STATUS_KEYS.includes(status)) group[status] += 1;
    group.total += 1;
  }

  const entries = [...groups.values()];
  if (sortMode === 'year') {
    entries.sort((a, b) => Number(a.name) - Number(b.name) || a.name.localeCompare(b.name, 'es'));
  } else {
    entries.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'es'));
  }
  return entries;
}

function stackedBarOption(entries, horizontal = false) {
  if (!entries.length) return emptyOption();
  const names = entries.map((entry) => entry.name);
  const axisLabel = { color: '#6b7280', fontSize: 10 };
  const splitLine = { lineStyle: { color: '#eef2f7' } };

  return {
    animationDuration: 350,
    grid: horizontal
      ? { left: 88, right: 16, top: 8, bottom: 30 }
      : { left: 34, right: 12, top: 12, bottom: 42 },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    legend: {
      bottom: 0,
      left: 'center',
      icon: 'circle',
      itemWidth: 7,
      itemHeight: 7,
      textStyle: { fontSize: 9, color: '#4b5563' },
    },
    xAxis: horizontal
      ? { type: 'value', axisLabel, splitLine, minInterval: 1 }
      : {
          type: 'category',
          data: names,
          axisLabel: { ...axisLabel, interval: 0 },
          axisTick: { show: false },
          axisLine: { lineStyle: { color: '#e5e7eb' } },
        },
    yAxis: horizontal
      ? { type: 'category', data: names, inverse: true, axisLabel, axisTick: { show: false }, axisLine: { show: false } }
      : { type: 'value', axisLabel, splitLine, minInterval: 1 },
    series: STATUS_KEYS.map((key) => ({
      name: STATUS[key].label,
      type: 'bar',
      stack: 'estatus',
      barMaxWidth: horizontal ? 16 : 26,
      itemStyle: { color: STATUS[key].chart },
      emphasis: { focus: 'series' },
      label: {
        show: true,
        position: 'inside',
        // Texto blanco sobre el azul; oscuro sobre el azul claro.
        color: key === 'VIGENTE' ? '#fff' : '#1e3a6e',
        fontSize: 9,
        fontWeight: 600,
        formatter: (params) => (Number(params.value) > 0 ? params.value : ''),
      },
      data: entries.map((entry) => entry[key] || 0),
    })),
  };
}

function renderCharts() {
  chart('lic-chart-tipo')?.setOption(
    stackedBarOption(groupedStatusCounts(state.filtered, 'tipo')),
    true,
  );
  chart('lic-chart-estatus')?.setOption(statusDonutOption(), true);
  chart('lic-chart-empresa')?.setOption(
    stackedBarOption(groupedStatusCounts(state.filtered, 'empresa'), true),
    true,
  );
  chart('lic-chart-anio')?.setOption(
    stackedBarOption(groupedStatusCounts(state.filtered, 'anio', 'year')),
    true,
  );
}

/* ------------------------------------------------------------------ */
/* Mapa                                                                */
/* ------------------------------------------------------------------ */

const EMPTY_FC = { type: 'FeatureCollection', features: [] };

function initDashboardMap() {
  if (state.map) return state.map;
  try {
    const map = initMap('manager-map');
    // Ajustes propios del dashboard: se aplican aquí para no modificar la
    // configuración del mapa del geoportal (incluido su modo sin internet).
    map.setMinZoom(MANAGER_MIN_ZOOM);
    map.setMaxBounds(MANAGER_MAP_BOUNDS);
    state.map = map;
    map.once('load', () => {
      try {
        addBaseLayers(map);
        addLicenseLayers(map);
        loadStateBorders(map);
        state.mapReady = true;
        updateMapData();
        map.resize();
        fitVenezuela(0);
        setMapLoading(false);
      } catch (error) {
        console.error('No se pudo preparar el mapa gerencial:', error);
        showMapError('No se pudo preparar el mapa base. La tabla y los gráficos siguen disponibles.');
      }
    });
    map.on('error', (event) => {
      console.warn('MapLibre:', event?.error?.message || event);
    });
    return map;
  } catch (error) {
    console.error('No se pudo crear el mapa gerencial:', error);
    showMapError('No se pudo inicializar el mapa. La tabla y los gráficos siguen disponibles.');
    return null;
  }
}

function addLicenseLayers(map) {
  if (!map.getSource('licencias-gerencia')) {
    map.addSource('licencias-gerencia', {
      type: 'geojson',
      data: EMPTY_FC,
      promoteId: 'codigo',
    });
  }

  if (!map.getLayer('licencias-fill')) {
    map.addLayer({
      id: 'licencias-fill',
      type: 'fill',
      source: 'licencias-gerencia',
      paint: {
        'fill-color': [
          'match',
          ['get', 'estatus'],
          'VIGENTE', STATUS.VIGENTE.color,
          'CULMINADA', STATUS.CULMINADA.color,
          '#94a3b8',
        ],
        'fill-opacity': 0.48,
      },
    });
  }

  if (!map.getLayer('licencias-line')) {
    map.addLayer({
      id: 'licencias-line',
      type: 'line',
      source: 'licencias-gerencia',
      paint: {
        'line-color': [
          'match',
          ['get', 'estatus'],
          'VIGENTE', STATUS.VIGENTE.line,
          'CULMINADA', STATUS.CULMINADA.line,
          '#475569',
        ],
        'line-width': 1.3,
      },
    });
  }

  if (!map.getSource('licencias-highlight')) {
    map.addSource('licencias-highlight', { type: 'geojson', data: EMPTY_FC });
  }
  if (!map.getLayer('licencias-highlight-line')) {
    map.addLayer({
      id: 'licencias-highlight-line',
      type: 'line',
      source: 'licencias-highlight',
      paint: { 'line-color': '#0b1b3a', 'line-width': 3.2 },
    });
  }

  if (!map.getLayer('licencias-label')) {
    map.addLayer({
      id: 'licencias-label',
      type: 'symbol',
      source: 'licencias-gerencia',
      minzoom: 3.4,
      layout: {
        'text-field': ['to-string', ['get', 'bloque']],
        'text-font': ['Open Sans Regular'],
        'text-size': LABEL_TEXT_SIZE,
        'text-allow-overlap': true,
        'text-ignore-placement': true,
        'text-padding': 1,
      },
      paint: {
        'text-color': '#0b1b3a',
        'text-halo-color': '#ffffff',
        'text-halo-width': 3,
        'text-halo-blur': 0.4,
      },
    });
  }

  map.on('mouseenter', 'licencias-fill', () => {
    map.getCanvas().style.cursor = 'pointer';
  });
  map.on('mouseleave', 'licencias-fill', () => {
    map.getCanvas().style.cursor = '';
  });
  map.on('click', 'licencias-fill', (event) => {
    const feature = event.features?.[0];
    if (!feature) return;
    const codigo = feature.properties?.codigo;
    selectFeature(codigo, event.lngLat);
  });
}

async function loadStateBorders(map) {
  try {
    const response = await apiFetch(STATES_ENDPOINT);
    if (!response.ok) return;
    const data = await response.json();
    if (!data?.features?.length) return;
    if (map.getSource('licencias-estados')) {
      map.getSource('licencias-estados').setData(data);
    } else {
      map.addSource('licencias-estados', { type: 'geojson', data });
    }
    if (!map.getLayer('licencias-estados-line')) {
      const before = map.getLayer('licencias-fill') ? 'licencias-fill' : undefined;
      map.addLayer(
        {
          id: 'licencias-estados-line',
          type: 'line',
          source: 'licencias-estados',
          paint: {
            'line-color': '#1a365d',
            'line-width': 1.1,
            'line-opacity': 0.62,
          },
        },
        before,
      );
    }
  } catch (error) {
    console.warn('No se pudieron cargar los límites estadales:', error);
  }
}

function updateMapData() {
  const map = state.map;
  if (!map || !map.getSource('licencias-gerencia')) return;
  map.getSource('licencias-gerencia').setData({
    type: 'FeatureCollection',
    features: state.filtered,
  });
}

function coordBounds(features) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const visit = (node) => {
    if (!Array.isArray(node)) return;
    if (typeof node[0] === 'number' && typeof node[1] === 'number') {
      minX = Math.min(minX, node[0]);
      minY = Math.min(minY, node[1]);
      maxX = Math.max(maxX, node[0]);
      maxY = Math.max(maxY, node[1]);
      return;
    }
    for (const child of node) visit(child);
  };
  for (const feature of features) visit(feature.geometry?.coordinates);
  if (!Number.isFinite(minX)) return null;
  return [[minX, minY], [maxX, maxY]];
}

function fitVenezuela(duration = 0) {
  const map = state.map;
  if (!map) return;
  // La vista nacional necesita poder alejarse por debajo del zoom mínimo
  // del geoportal; si el mapa ya existía, lo ajustamos aquí.
  if (map.getMinZoom() > MANAGER_MIN_ZOOM) map.setMinZoom(MANAGER_MIN_ZOOM);
  map.stop();
  map.fitBounds(VENEZUELA_BOUNDS, {
    padding: VENEZUELA_PADDING,
    maxZoom: 6.4,
    bearing: 0,
    pitch: 0,
    duration,
  });
}

function resetMapView() {
  const map = state.map;
  if (!map) return;
  state.selectedCode = null;
  state.popup?.remove();
  state.popup = null;
  if (map.getSource('licencias-highlight')) {
    map.getSource('licencias-highlight').setData(EMPTY_FC);
  }
  document.querySelectorAll('.manager-table tbody tr[data-codigo]').forEach((row) => {
    row.classList.remove('is-selected');
  });
  map.resize();
  fitVenezuela(650);
}

function popupHtml(feature) {
  const p = feature.properties || {};
  return `
    <div style="font-family:Inter,sans-serif;color:#0f1e3d;min-width:210px">
      <div style="font-family:Fraunces,serif;font-size:15px;font-weight:600;margin-bottom:2px">
        Licencia ${esc(p.bloque ?? '—')}
      </div>
      <div style="font-size:11px;color:#6b7280;margin-bottom:8px">${esc(p.codigo ?? '')}</div>
      <div style="display:grid;grid-template-columns:auto 1fr;gap:4px 10px;font-size:11.5px">
        <span style="color:#6b7280">Empresa</span><strong>${esc(p.empresa ?? '—')}</strong>
        <span style="color:#6b7280">Tipo</span><strong>${esc(p.tipo ?? '—')}</strong>
        <span style="color:#6b7280">Estatus</span><strong style="color:${statusColor(p.estatus)}">${esc(p.estatus ?? '—')}</strong>
        <span style="color:#6b7280">Año</span><strong>${esc(p.anio ?? '—')}</strong>
        <span style="color:#6b7280">Duración</span><strong>${esc(p.duracion ?? '—')}</strong>
        <span style="color:#6b7280">Área</span><strong>${esc(formatArea(p.area_km2))} km²</strong>
      </div>
    </div>
  `;
}

function selectFeature(codigo, lngLat = null) {
  if (!codigo) return;
  const feature = state.all.find((f) => String(f.properties?.codigo) === String(codigo));
  if (!feature) return;

  state.selectedCode = String(codigo);
  const map = state.map;
  if (!map) return;

  if (map.getSource('licencias-highlight')) {
    map.getSource('licencias-highlight').setData({
      type: 'FeatureCollection',
      features: [feature],
    });
  }

  const bounds = coordBounds([feature]);
  if (bounds) {
    map.fitBounds(bounds, { padding: 44, maxZoom: 8.2, duration: 650 });
  }

  const center = bounds
    ? [(bounds[0][0] + bounds[1][0]) / 2, (bounds[0][1] + bounds[1][1]) / 2]
    : lngLat
      ? [lngLat.lng, lngLat.lat]
      : null;

  if (center) {
    state.popup?.remove();
    state.popup = new maplibregl.Popup({ closeButton: true, maxWidth: '300px' })
      .setLngLat(center)
      .setHTML(popupHtml(feature))
      .addTo(map);
  }

  document.querySelectorAll('.manager-table tbody tr[data-codigo]').forEach((row) => {
    row.classList.toggle('is-selected', row.getAttribute('data-codigo') === String(codigo));
  });
}

/* ------------------------------------------------------------------ */
/* Tabla                                                               */
/* ------------------------------------------------------------------ */

function sortValue(feature, key) {
  const value = feature.properties?.[key];
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  return String(value).toLocaleLowerCase('es');
}

function tableRows() {
  const query = ($('lic-search')?.value || '').trim().toLocaleLowerCase('es');
  let rows = [...state.filtered];
  if (query) {
    rows = rows.filter((feature) => {
      const p = feature.properties || {};
      return [p.codigo, p.empresa, p.bloque, p.tipo, p.estatus]
        .some((value) => String(value ?? '').toLocaleLowerCase('es').includes(query));
    });
  }

  rows.sort((a, b) => {
    const av = sortValue(a, state.sortKey);
    const bv = sortValue(b, state.sortKey);
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    let comparison;
    if (typeof av === 'number' && typeof bv === 'number') comparison = av - bv;
    else comparison = String(av).localeCompare(String(bv), 'es', { numeric: true });
    return state.sortDir === 'asc' ? comparison : -comparison;
  });
  return rows;
}

function badgeFor(value, kind) {
  const text = String(value ?? '—');
  let cls = 'gray';
  if (kind === 'tipo') cls = text === 'GAS' ? 'green' : text === 'CRUDO' ? 'blue' : 'gray';
  if (kind === 'estatus') cls = text === 'VIGENTE' ? 'green' : text === 'CULMINADA' ? 'red' : 'amber';
  return `<span class="badge ${cls}">${esc(text)}</span>`;
}

function renderTable() {
  const body = $('lic-table-body');
  if (!body) return;
  const rows = tableRows();
  const count = $('lic-table-count');
  if (count) {
    count.textContent = `${rows.length} de ${state.all.length} licencias · ${state.filtered.length} visibles en el mapa`;
  }

  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="9" class="manager-empty">No hay licencias con los filtros seleccionados.</td></tr>';
    return;
  }

  body.innerHTML = rows
    .map((feature) => {
      const p = feature.properties || {};
      const selected = state.selectedCode === String(p.codigo) ? ' is-selected' : '';
      return `
        <tr data-codigo="${esc(p.codigo)}" class="${selected}">
          <td><strong>${esc(p.codigo ?? '—')}</strong></td>
          <td>${esc(p.bloque ?? '—')}</td>
          <td>${esc(p.empresa ?? '—')}</td>
          <td>${badgeFor(p.tipo, 'tipo')}</td>
          <td>${badgeFor(p.estatus, 'estatus')}</td>
          <td class="year-cell">${esc(p.anio ?? '—')}</td>
          <td>${esc(p.duracion ?? '—')}</td>
          <td class="area-cell">${esc(formatArea(p.area_km2))}</td>
          <td><button type="button" class="btn-map" data-map-codigo="${esc(p.codigo)}">Ver en mapa</button></td>
        </tr>
      `;
    })
    .join('');

  document.querySelectorAll('.manager-table th[data-sort]').forEach((th) => {
    const active = th.getAttribute('data-sort') === state.sortKey;
    th.setAttribute('data-dir', active ? state.sortDir : '');
  });
}

function setupTableEvents() {
  document.querySelectorAll('.manager-table th[data-sort]').forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.getAttribute('data-sort');
      if (!key) return;
      if (state.sortKey === key) {
        state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        state.sortKey = key;
        state.sortDir = 'asc';
      }
      renderTable();
    });
  });

  $('lic-search')?.addEventListener('input', renderTable);

  $('lic-table-body')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-map-codigo]');
    const row = event.target.closest('tr[data-codigo]');
    const codigo = button?.getAttribute('data-map-codigo') || row?.getAttribute('data-codigo');
    if (codigo) selectFeature(codigo);
  });
}

/* ------------------------------------------------------------------ */
/* Carga e inicialización                                              */
/* ------------------------------------------------------------------ */

function setupFilterEvents() {
  ['lic-filter-empresa', 'lic-filter-tipo', 'lic-filter-estatus', 'lic-filter-anio'].forEach((id) => {
    $(id)?.addEventListener('change', applyFilters);
  });

  $('lic-clear')?.addEventListener('click', () => {
    ['lic-filter-empresa', 'lic-filter-tipo', 'lic-filter-estatus', 'lic-filter-anio'].forEach((id) => {
      const el = $(id);
      if (el) el.value = '';
    });
    const search = $('lic-search');
    if (search) search.value = '';
    applyFilters();
  });

  $('manager-map-reset')?.addEventListener('click', resetMapView);
}

async function loadLicenses() {
  setStatus('Cargando datos…');
  const response = await apiFetch(LICENSES_ENDPOINT);
  if (response.status === 403) {
    throw new Error('Tu rol no tiene acceso al dashboard gerencial.');
  }
  if (!response.ok) {
    throw new Error(`No se pudieron cargar las licencias (HTTP ${response.status}).`);
  }
  const data = await response.json();
  const features = Array.isArray(data.features) ? data.features : [];
  state.all = features.map((feature) => ({
    ...feature,
    properties: {
      ...(feature.properties || {}),
      estatus: normalizeStatus(feature.properties?.estatus),
    },
  }));
  state.filtered = [...state.all];
}

async function init() {
  if (state.initialized) return;
  const section = $('licencias');
  if (!section) return;
  state.initialized = true;
  section.hidden = false;

  setupFilterEvents();
  setupTableEvents();

  try {
    await loadLicenses();
    // Deja que el navegador calcule el layout antes de inicializar ECharts.
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    populateFilters(state.all);
    renderKpis();
    renderCharts();
    renderTable();
    initDashboardMap();
    setStatus(`${state.all.length} licencias cargadas`);
  } catch (error) {
    console.error(error);
    setStatus(error.message || 'No se pudieron cargar las licencias.', true);
    if ($('lic-table-body')) {
      $('lic-table-body').innerHTML = `<tr><td colspan="9" class="manager-empty">${esc(error.message || 'Error al cargar las licencias.')}</td></tr>`;
    }
    showMapError(error.message || 'Error al cargar el dashboard gerencial.');
  }
}

function boot() {
  if (document.documentElement.dataset.role === 'Rol_gerente') {
    init();
    return;
  }
  document.addEventListener('session:ready', (event) => {
    if (event.detail?.rol === 'Rol_gerente') init();
  });
}

window.addEventListener('resize', () => {
  Object.values(state.charts).forEach((instance) => instance?.resize());
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
