// admin-dashboard.js
// Dashboard de administración con datos reales del catálogo
// (GET /api/v1/admin/stats). Dibuja KPIs y 3 gráficas ECharts.
import * as echarts from 'echarts';
import { apiFetch } from './utils.js';

const fmt = (n) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('es'));

const TIPO_LABEL = {
  fill: 'Polígonos', circle: 'Puntos', point: 'Puntos',
  line: 'Líneas', raster: 'Ráster',
};

const BASE_OPTIONS = {
  textStyle: { fontFamily: "'Plus Jakarta Sans','Inter',sans-serif" },
  tooltip: { confine: true },
};

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function setStatus(text, isError = false) {
  const el = document.getElementById('adm-status');
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('is-error', isError);
}

function crearChart(id, options) {
  const el = document.getElementById(id);
  if (!el) return;
  if (el.dataset.ready === '1') return;
  el.dataset.ready = '1';
  const chart = echarts.init(el, null, { renderer: 'canvas' });
  chart.setOption({ ...BASE_OPTIONS, ...options });
  window.addEventListener('resize', () => chart.resize());
}

function chartTipos(catalog) {
  const acc = {};
  (catalog.by_layer || []).forEach((l) => {
    const key = String(l.type).toLowerCase();
    const label = TIPO_LABEL[key] || 'Otros';
    acc[label] = (acc[label] || 0) + 1;
  });
  const data = Object.entries(acc).map(([name, value]) => ({ name, value }));
  if (!data.length) return;

  crearChart('adm-chart-tipos', {
    tooltip: { trigger: 'item', formatter: '{b}: {c} capas ({d}%)' },
    legend: { bottom: 0, textStyle: { fontSize: 11, color: '#6b7280' } },
    color: ['#2d5296', '#0f766e', '#b45309', '#7c3aed', '#93b4e0'],
    series: [{
      type: 'pie',
      radius: ['52%', '74%'],
      center: ['50%', '44%'],
      avoidLabelOverlap: true,
      itemStyle: { borderColor: '#fff', borderWidth: 2 },
      label: { show: false },
      data,
    }],
  });
}

function chartTopCapas(catalog) {
  const top = (catalog.by_layer || [])
    .filter((l) => Number(l.count) > 0)
    .slice(0, 6)
    .reverse();
  if (!top.length) return;

  crearChart('adm-chart-top', {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    grid: { left: 8, right: 24, top: 10, bottom: 8, containLabel: true },
    xAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: '#f1f5f9' } },
      axisLabel: { color: '#6b7280', fontSize: 11 },
    },
    yAxis: {
      type: 'category',
      data: top.map((l) => (l.name.length > 26 ? `${l.name.slice(0, 26)}…` : l.name)),
      axisLine: { lineStyle: { color: '#e5e7eb' } },
      axisLabel: { color: '#6b7280', fontSize: 11 },
    },
    series: [{
      type: 'bar',
      data: top.map((l) => l.count),
      barWidth: '52%',
      itemStyle: { color: '#2d5296', borderRadius: [0, 6, 6, 0] },
    }],
  });
}

function chartWorkspaces(catalog) {
  const ws = catalog.by_workspace || [];
  if (!ws.length) return;

  crearChart('adm-chart-ws', {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    legend: { bottom: 0, textStyle: { fontSize: 11, color: '#6b7280' } },
    grid: { left: 8, right: 12, top: 16, bottom: 34, containLabel: true },
    xAxis: {
      type: 'category',
      data: ws.map((w) => w.name),
      axisLine: { lineStyle: { color: '#e5e7eb' } },
      axisLabel: { color: '#6b7280', fontSize: 11, interval: 0, rotate: ws.length > 4 ? 18 : 0 },
    },
    yAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: '#f1f5f9' } },
      axisLabel: { color: '#6b7280', fontSize: 11 },
    },
    series: [{
      name: 'Registros',
      type: 'bar',
      data: ws.map((w) => w.features),
      barMaxWidth: 46,
      itemStyle: { color: '#0f766e', borderRadius: [6, 6, 0, 0] },
    }],
  });
}

async function cargar() {
  setStatus('Cargando métricas del catálogo…');
  try {
    const res = await apiFetch('/api/v1/admin/stats');
    if (!res.ok) throw new Error(`Error ${res.status}`);
    const stats = await res.json();
    const cat = stats.catalog || {};

    setText('adm-kpi-layers', fmt(cat.layers_total));
    setText('adm-kpi-layers-hint', `${fmt(cat.vector)} vector · ${fmt(cat.raster)} ráster`);
    setText('adm-kpi-features', fmt(cat.features_total));
    setText('adm-kpi-metadata', fmt(stats.metadata_layers));
    setText('adm-kpi-sessions', fmt(stats.active_sessions));

    chartTipos(cat);
    chartTopCapas(cat);
    chartWorkspaces(cat);

    setStatus('Actualizado');
  } catch (e) {
    setStatus(`No se pudieron cargar las métricas (${e.message})`, true);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', cargar);
} else {
  cargar();
}
