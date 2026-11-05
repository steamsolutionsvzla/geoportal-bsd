// download.js
// Descarga una capa como Shapefile comprimido (.zip).
// El backend consulta el WFS de GeoServer con outputFormat=shape-zip y
// devuelve el binario directamente (el navegador nunca habla con GeoServer).
import { apiFetch } from './utils.js';

export async function downloadLayerShp(tableName) {
  const short = tableName.includes(':') ? tableName.split(':').pop() : tableName;
  try {
    const response = await apiFetch(`/api/v1/layers/${encodeURIComponent(tableName)}/download`);
    if (!response.ok) {
      let msg = `Error ${response.status}`;
      try {
        const text = await response.text();
        if (text) msg = text;
      } catch (_) { /* ignorar */ }
      throw new Error(msg);
    }

    const blob = await response.blob();
    const disp = response.headers.get('Content-Disposition') || '';
    const match = disp.match(/filename="?([^";]+)"?/);
    const filename = match ? match[1] : `${short}.zip`;

    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  } catch (e) {
    console.error('Error al descargar el Shapefile:', e);
    alert(`No se pudo descargar la capa "${short}": ${e?.message || e}`);
  }
}
