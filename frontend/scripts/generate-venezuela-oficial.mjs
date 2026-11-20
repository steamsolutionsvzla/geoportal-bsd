// Regenera src/assets/venezuela-oficial.json a partir de la capa de estados.
//
// - Usa la unión de los 25 estados para que el contorno nacional coincida
//   exactamente con la capa de estados (incluida Guayana Esequiba).
// - Conserva las islas/cayos del contorno oficial que no estén en la capa
//   de estados.
// - La unión elimina las fronteras internas: solo queda el borde del país.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as turf from '@turf/turf';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const statesPath = path.join(root, 'public', 'data', 'estados-venezuela.geojson');
const officialPath = path.join(root, 'src', 'assets', 'venezuela-oficial.json');

const states = JSON.parse(fs.readFileSync(statesPath, 'utf8'));
const official = JSON.parse(fs.readFileSync(officialPath, 'utf8'));

if (!Array.isArray(states.features) || !states.features.length) {
  throw new Error('El GeoJSON de estados no contiene features.');
}

const officialPolys = official.geometry.type === 'MultiPolygon'
  ? official.geometry.coordinates
  : [official.geometry.coordinates];

if (!officialPolys.length) {
  throw new Error('El contorno oficial no tiene geometrías.');
}

// El primer polígono del oficial es el territorio continental (con su propia
// versión de Guayana). Se descarta: el continental sale de la unión de estados.
const islands = officialPolys.slice(1).map((coordinates) => ({
  type: 'Feature',
  properties: {},
  geometry: { type: 'Polygon', coordinates },
}));

const inputs = [
  ...states.features.filter((f) => f?.geometry),
  ...islands,
];

console.log(`Estados: ${states.features.length}, islas oficiales: ${islands.length}`);

const merged = turf.union(turf.featureCollection(inputs));
if (!merged?.geometry) {
  throw new Error('La unión no devolvió una geometría.');
}

const output = {
  type: 'Feature',
  properties: { name: 'Venezuela oficial' },
  geometry: merged.geometry,
};

fs.writeFileSync(officialPath, JSON.stringify(output));
const size = fs.statSync(officialPath).size;
console.log(`OK -> ${officialPath} (${(size / 1024).toFixed(0)} KB)`);
