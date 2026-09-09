// info-panel.js
import { getMap } from './map-config.js';
import { getAvailableLayers } from './layer-manager.js';
import { obtenerNombreEstado, obtenerNombreBloque } from './utils.js';

// ========================================================================
// ESTADO INTERNO DEL PANEL
// ========================================================================
let currentPointData = null;
let currentFilterData = null;
let currentBloqueFilterData = null;
let currentBloqueLayerData = null;
let isFilterActive = false;
let isBloqueFilterActive = false;
let estadoSeleccionado = '';
let bloqueSeleccionado = '';

// ========================================================================
// CARGA DEL LOGO (cacheado en Base64)
// ========================================================================
let logoBase64Cache = null;

/**
 * Obtiene el logo en formato Base64. La primera vez lo carga desde
 * /img/logo.png y lo cachea para futuras llamadas.
 * @returns {Promise<string|null>} Cadena Base64 del logo o null si falla.
 */
async function getLogoBase64() {
  if (logoBase64Cache) return logoBase64Cache;

  try {
    const response = await fetch('/img/logo.png');
    if (!response.ok) throw new Error('No se pudo cargar el logo');
    const blob = await response.blob();
    logoBase64Cache = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    console.warn('Logo no disponible:', error);
    logoBase64Cache = null;
  }
  return logoBase64Cache;
}

// ========================================================================
// EXPORTACIÓN DE FUNCIONES PARA ACTUALIZAR EL ESTADO DEL PANEL
// ========================================================================
export function setInfoPanelData(data) {
  if (data.currentPointData !== undefined) currentPointData = data.currentPointData;
  if (data.currentFilterData !== undefined) currentFilterData = data.currentFilterData;
  if (data.currentBloqueFilterData !== undefined) currentBloqueFilterData = data.currentBloqueFilterData;
  if (data.currentBloqueLayerData !== undefined) currentBloqueLayerData = data.currentBloqueLayerData;
  if (data.isFilterActive !== undefined) isFilterActive = data.isFilterActive;
  if (data.isBloqueFilterActive !== undefined) isBloqueFilterActive = data.isBloqueFilterActive;
  if (data.estadoSeleccionado !== undefined) estadoSeleccionado = data.estadoSeleccionado;
  if (data.bloqueSeleccionado !== undefined) bloqueSeleccionado = data.bloqueSeleccionado;
}

// ========================================================================
// RENDERIZADO PRINCIPAL DEL PANEL
// ========================================================================
export function renderInfoPanel() {
  const infoContent = document.getElementById('infoPanelContent');
  if (!infoContent) return;

  const pointHtml = buildPointCardHtml();
  const filterHtml = (isFilterActive && currentFilterData) ? buildFilterSummaryHtml() : '';
  const bloqueFilterHtml = (isBloqueFilterActive && currentBloqueFilterData) ? buildBloqueFilterSummaryHtml() : '';
  const bloqueLayerHtml = currentBloqueLayerData ? buildBloqueLayerInfoHtml() : '';
  const metadataHtml = buildActiveLayersMetadataHtml();

  let html = '';
  let bloques = [];
  if (pointHtml) bloques.push(pointHtml);
  if (bloqueLayerHtml) bloques.push(bloqueLayerHtml);
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
  agregarBotonLimpiarFiltroPanel();

  // Asegurar que el panel esté abierto
  const infoPanel = document.getElementById('infoPanel');
  if (infoPanel && infoPanel.classList.contains('collapsed')) {
    infoPanel.classList.remove('collapsed');
    document.querySelector('.app')?.classList.remove('has-collapsed-info');
    setTimeout(() => getMap().resize(), 300);
  }
}

// =========================================================================
// CONSTRUCCIÓN DE TARJETAS DE INFORMACIÓN
// =========================================================================
function buildPointCardHtml() {
  if (!currentPointData) return '';
  const { tableName, props } = currentPointData;
  let html = `<div class="info-card"><div class="ic-label">Capa: ${tableName}</div><hr style="border:0; border-top:1px solid var(--line-700); margin:8px 0;">`;
  for (let key in props) {
    const lowerKey = key.toLowerCase();
    const isExcluded = ['id','geoid','gid','objectid'].includes(lowerKey) || lowerKey.endsWith('_id') || lowerKey.startsWith('id_');
    if (!isExcluded) {
      html += `<p style="margin: 4px 0; font-size: 0.75rem;"><b>${key}:</b> ${props[key]}</p>`;
    }
  }
  html += `</div>`;
  return html;
}

function buildBloqueLayerInfoHtml() {
  if (!currentBloqueLayerData) return '';
  const props = currentBloqueLayerData;
  const nombreBloque = obtenerNombreBloque(props) || 'Bloque';
  let html = `<div class="info-card"><div class="ic-label">Capa: Bloques — ${nombreBloque}</div><hr style="border:0; border-top:1px solid var(--line-700); margin:8px 0;">`;
  for (let key in props) {
    const lowerKey = key.toLowerCase();
    const isExcluded = ['id','geoid','gid','objectid'].includes(lowerKey) || lowerKey.endsWith('_id') || lowerKey.startsWith('id_');
    if (!isExcluded) {
      html += `<p style="margin: 4px 0; font-size: 0.75rem;"><b>${key}:</b> ${props[key]}</p>`;
    }
  }
  html += `</div>`;
  return html;
}

function buildFilterSummaryHtml() {
  if (!currentFilterData) return '';
  const { estadoSeleccionado: estadoNombre, totalPuntosGeneral, capasContadas, rowsHtml } = currentFilterData;
  let html = `<div class="info-card"><div class="ic-label">Estado: ${estadoNombre}</div><hr style="border:0; border-top:1px solid var(--line-700); margin:8px 0;">`;
  html += `<table id="tablaPuntosEstado" style="width:100%; font-size:0.75rem; border-collapse: collapse;">`;
  html += `<tr style="border-bottom: 1px solid var(--line-700);"><th style="text-align:left; padding:4px;">Capa / Elemento</th><th style="text-align:right; padding:4px;">Cantidad</th></tr>`;
  html += rowsHtml;
  if (capasContadas === 0) {
    html += `<tr><td colspan="2" style="padding:6px; text-align:center; color: var(--muted-500);">No hay capas de puntos activas.</td></tr>`;
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
  let html = `<div class="info-card"><div class="ic-label">Bloque: ${bloqueNombre}</div><hr style="border:0; border-top:1px solid var(--line-700); margin:8px 0;">`;
  html += `<table id="tablaPuntosBloque" style="width:100%; font-size:0.75rem; border-collapse: collapse;">`;
  html += `<tr style="border-bottom: 1px solid var(--line-700);"><th style="text-align:left; padding:4px;">Capa / Elemento</th><th style="text-align:right; padding:4px;">Cantidad</th></tr>`;
  html += rowsHtml;
  if (capasContadas === 0) {
    html += `<tr><td colspan="2" style="padding:6px; text-align:center; color: var(--muted-500);">No hay capas de puntos activas.</td></tr>`;
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

function buildActiveLayersMetadataHtml() {
  const activeToggles = document.querySelectorAll('.toggle.on[data-table]');
  if (activeToggles.length === 0) return '';
  let rowsHtml = '';
  const availableLayers = getAvailableLayers();
  activeToggles.forEach(toggle => {
    const tableName = toggle.getAttribute('data-table');
    let displayName = tableName;
    if (tableName === 'dpt_estadal_venezuela') {
      displayName = 'Entidades Federales (Estados)';
    } else if (tableName === 'BLOQUES') {
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

// Columnas técnicas/redundantes que no aportan valor al usuario final
const METADATA_HIDDEN_FIELDS = [
  'id', 'uid', 'table_name', 'schema_name',
  'f_table_catalog', 'f_table_schema', 'f_table_name', 'f_geometry_column',
  'geom', 'extent', 'qmd', 'identifier'
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

// =========================================================================
// ASIGNACIÓN DE EVENTOS DE DESCARGA (PDF / EXCEL)
// =========================================================================
function attachFilterDownloadListeners() {
  if (!currentFilterData) return;
  const { estadoSeleccionado: estadoNombre, totalPuntosGeneral, capasDetalleMap } = currentFilterData;
  const downloadPdfBtn = document.getElementById('downloadPdfBtn');
  if (downloadPdfBtn) {
    downloadPdfBtn.addEventListener('click', async () => {
      await generarReportePDF('Estado', estadoNombre, totalPuntosGeneral, capasDetalleMap, document.getElementById('tablaPuntosEstado'));
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
    downloadPdfBtnBloque.addEventListener('click', async () => {
      await generarReportePDF('Bloque', bloqueNombre, totalPuntosGeneral, capasDetalleMap, document.getElementById('tablaPuntosBloque'));
    });
  }
  const downloadExcelBtnBloque = document.getElementById('downloadExcelBtnBloque');
  if (downloadExcelBtnBloque) {
    downloadExcelBtnBloque.addEventListener('click', () => {
      generarReporteExcel(bloqueNombre, capasDetalleMap, document.getElementById('tablaPuntosBloque'));
    });
  }
}

// =========================================================================
// GENERACIÓN DE REPORTES (PDF y EXCEL)
// =========================================================================
async function generarReportePDF(etiqueta, nombreSeleccionado, totalPuntosGeneral, capasDetalleMap, tablaResumenEl) {
  if (typeof window.jspdf === 'undefined') {
    alert('La librería jsPDF no está cargada correctamente.');
    return;
  }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF('p', 'mm', 'a4');
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 14;
  let y = margin;

  const primaryColor = [26, 54, 93];
  const secondaryColor = [49, 130, 206];
  const lightGray = [240, 240, 240];
  const borderColor = [180, 180, 180];

  // Cargar logo (cacheado)
  const logoData = await getLogoBase64();
  if (logoData) {
    try {
      // Ajusta el ancho y alto según tu logo (35x12 es un ejemplo)
      doc.addImage(logoData, 'PNG', margin, y, 35, 12);
    } catch (e) {
      // Si falla la imagen, continuar sin logo
    }
  }
  y += 12 + 4; // altura del logo + separación

  // Cabecera
  const headerHeight = 32;
  doc.setFillColor(primaryColor[0], primaryColor[1], primaryColor[2]);
  doc.rect(margin, y, pageWidth - 2 * margin, headerHeight, 'F');
  doc.setDrawColor(secondaryColor[0], secondaryColor[1], secondaryColor[2]);
  doc.setLineWidth(1.5);
  doc.line(margin, y + headerHeight, pageWidth - margin, y + headerHeight);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(255, 255, 255);
  doc.text('Reporte Estratégico de Puntos', pageWidth / 2, y + 14, { align: 'center' });
  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  doc.text(`${etiqueta}: ${nombreSeleccionado}`, pageWidth / 2, y + 25, { align: 'center' });
  y += headerHeight + 8;
  doc.setDrawColor(secondaryColor[0], secondaryColor[1], secondaryColor[2]);
  doc.setLineWidth(0.8);
  doc.line(margin, y, pageWidth - margin, y);
  y += 6;

  // Tabla de resumen
  if (tablaResumenEl) {
    const tableData = [];
    const rows = tablaResumenEl.querySelectorAll('tr');
    rows.forEach(row => {
      const cells = row.querySelectorAll('th, td');
      if (cells.length > 0) {
        tableData.push(Array.from(cells).map(cell => cell.textContent.trim()));
      }
    });
    doc.autoTable({
      head: tableData.slice(0, 1),
      body: tableData.slice(1),
      startY: y,
      margin: { left: margin, right: margin },
      styles: { fontSize: 9, cellPadding: 3, lineColor: borderColor, lineWidth: 0.2, halign: 'left' },
      headStyles: { fillColor: secondaryColor, textColor: [255,255,255], fontSize: 9, halign: 'left', lineColor: borderColor, lineWidth: 0.2 },
      bodyStyles: { lineColor: borderColor, lineWidth: 0.1 },
      alternateRowStyles: { fillColor: lightGray },
      columnStyles: { 1: { halign: 'right' } },
      didParseCell: function(data) {
        if (data.column.index === 1) data.cell.styles.halign = 'right';
      }
    });
    y = doc.lastAutoTable.finalY + 6;
  }

  // Total general
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
  doc.text(`Total general de puntos: ${totalPuntosGeneral}`, margin, y);
  y += 8;
  doc.setDrawColor(secondaryColor[0], secondaryColor[1], secondaryColor[2]);
  doc.setLineWidth(0.5);
  doc.line(margin, y, pageWidth - margin, y);
  y += 6;

  // Tablas de detalle por capa
  if (Object.keys(capasDetalleMap).length > 0) {
    const excludedKeys = new Set(['id', 'geoid', 'gid', 'objectid']);
    for (let nombreCapa in capasDetalleMap) {
      const listaProps = capasDetalleMap[nombreCapa];
      const allKeysSet = new Set();
      listaProps.forEach(props => {
        for (let key in props) {
          const lowerKey = key.toLowerCase();
          const isExcluded = excludedKeys.has(lowerKey) || lowerKey.endsWith('_id') || lowerKey.startsWith('id_');
          if (!isExcluded) allKeysSet.add(key);
        }
      });
      const columns = Array.from(allKeysSet);
      if (columns.length === 0) continue;
      const remainingSpace = doc.internal.pageSize.getHeight() - y - 20;
      if (remainingSpace < 25) {
        doc.addPage();
        y = margin;
      }
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
      doc.text(`Detalle de ${nombreCapa}`, margin, y);
      y += 5;
      const head = ['#'].concat(columns);
      const body = [];
      listaProps.forEach((props, index) => {
        const row = [index + 1];
        columns.forEach(col => {
          row.push(props[col] !== undefined ? String(props[col]) : '');
        });
        body.push(row);
      });
      doc.autoTable({
        head: [head],
        body: body,
        startY: y,
        margin: { left: margin, right: margin },
        styles: { fontSize: 8, cellPadding: 2.5, lineColor: borderColor, lineWidth: 0.15, halign: 'left' },
        headStyles: { fillColor: secondaryColor, textColor: [255,255,255], fontSize: 8, halign: 'center', lineColor: borderColor, lineWidth: 0.15 },
        bodyStyles: { lineColor: borderColor, lineWidth: 0.1 },
        alternateRowStyles: { fillColor: lightGray },
        columnStyles: { 0: { halign: 'center', cellWidth: 12 } },
        didParseCell: function(data) {
          if (data.column.index === 0) data.cell.styles.halign = 'center';
        }
      });
      y = doc.lastAutoTable.finalY + 5;
    }
  }

  // Pie de página
  const totalPages = doc.internal.getNumberOfPages();
  const currentDate = new Date().toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setDrawColor(200, 200, 200);
    doc.setLineWidth(0.3);
    doc.line(margin, pageHeight - 12, pageWidth - margin, pageHeight - 12);
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 100, 100);
    doc.text(`Página ${i} de ${totalPages}`, pageWidth - margin, pageHeight - 6, { align: 'right' });
    doc.text(`Generado: ${currentDate}`, margin, pageHeight - 6);
  }
  doc.save(`Reporte_Puntos_${nombreSeleccionado.replace(/\s+/g, '_')}.pdf`);
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
          const isExcluded = excludedKeys.has(lowerKey) || lowerKey.endsWith('_id') || lowerKey.startsWith('id_');
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

// =========================================================================
// BOTÓN PARA QUITAR FILTRO DESDE EL PANEL
// =========================================================================
function agregarBotonLimpiarFiltroPanel() {
  const infoContent = document.getElementById('infoPanelContent');
  if (!infoContent) return;
  const hayFiltroActivo = isFilterActive || isBloqueFilterActive;
  if (!hayFiltroActivo) return;
  const existingBtn = document.getElementById('clearFilterPanelBtn');
  if (existingBtn) return;
  const firstInfoCard = infoContent.querySelector('.info-card');
  if (!firstInfoCard) return;
  const clearBtn = document.createElement('button');
  clearBtn.id = 'clearFilterPanelBtn';
  clearBtn.style.cssText = 'width:100%; margin-top:12px; background:#c1584a; color:white; border:none; padding:8px 12px; border-radius:4px; font-size:0.75rem; cursor:pointer; font-weight:500; display:flex; align-items:center; justify-content:center; gap:8px; transition:background 0.2s;';
  clearBtn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg> Quitar filtro`;
  clearBtn.addEventListener('mouseenter', () => clearBtn.style.background = '#a0443a');
  clearBtn.addEventListener('mouseleave', () => clearBtn.style.background = '#c1584a');
  clearBtn.addEventListener('click', () => {
    if (isFilterActive) limpiarFiltroEstado();
    if (isBloqueFilterActive) limpiarFiltroBloque();
    renderInfoPanel();
    getMap().flyTo({ center: [-65.75816, 7.17672], zoom: 4.8, duration: 1500 });
  });
  firstInfoCard.appendChild(clearBtn);
}

// Funciones auxiliares para limpiar filtros (se llaman desde el botón)
function limpiarFiltroEstado() {
  // Esta función será sobrescrita desde main.js (se expone globalmente)
  if (typeof window.limpiarFiltroEstado === 'function') {
    window.limpiarFiltroEstado();
  }
}

function limpiarFiltroBloque() {
  if (typeof window.limpiarFiltroBloque === 'function') {
    window.limpiarFiltroBloque();
  }
}