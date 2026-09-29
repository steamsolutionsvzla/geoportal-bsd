// Datos mock con semilla fija para el dashboard de admin.
// Semilla simple basada en índice para que los valores no cambien entre renders.

const seed = (i: number, min: number, max: number) => {
  const x = Math.sin(i * 9301 + 49297) * 233280;
  const r = x - Math.floor(x);
  return Math.floor(min + r * (max - min + 1));
};

// ============ KPIs ============
export const kpis = {
  bloquesVendidos: {
    value: 247,
    delta: +12,
    deltaLabel: 'vs año anterior',
  },
  bloquesConstruccion: {
    value: 38,
    delta: +5,
    deltaLabel: 'este trimestre',
  },
  paquetesPorEntregar: {
    value: 19,
    delta: -3,
    deltaLabel: 'esta semana',
  },
};

// ============ Bloques vendidos + en construcción por año ============
export const bloquesPorAnio = {
  years: ['2019', '2020', '2021', '2022', '2023', '2024', '2025', '2026'],
  vendidos:    [18, 24, 31, 42, 38, 51, 43, 27],
  construccion:[4,  6,  8, 10,  9, 12, 11,  7],
};

// ============ Ventas vs entregas mensuales (año actual vs anterior) ============
export const ventasMensuales = {
  months: ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'],
  ventasActual:  [12, 18, 15, 22, 19, 27, 24, 31, 28, 35, 30, 41],
  ventasAnterior:[10, 14, 13, 18, 16, 21, 19, 24, 22, 27, 25, 33],
};

// ============ Estados de paquetes (donut) ============
export const estadosPaquetes = [
  { name: 'Entregados',      value: 142 },
  { name: 'En construcción', value: 38  },
  { name: 'Por entregar',    value: 19  },
  { name: 'En revisión',     value: 11  },
];

// ============ Top organismos (barras horizontales) ============
export const topOrganismos = [
  { name: 'PDVSA',                        value: 62 },
  { name: 'Min. Petróleo',                value: 48 },
  { name: 'INTEVEP',                      value: 35 },
  { name: 'Filial Mixta Orinoco',         value: 28 },
  { name: 'Filial Mixta Maracaibo',       value: 22 },
  { name: 'Corp. Venezolana Petróleo',    value: 17 },
];

// ============ Desempeño por región (radar) ============
export const regiones = {
  indicadores: ['Ventas', 'Exploración', 'Producción', 'Entregas', 'Cobertura'],
  data: [
    { name: 'Faja del Orinoco', value: [95, 88, 82, 78, 90] },
    { name: 'Lago de Maracaibo', value: [78, 82, 90, 85, 72] },
    { name: 'Cuenca Oriental',   value: [65, 70, 60, 72, 68] },
    { name: 'Centro',            value: [50, 55, 48, 60, 52] },
    { name: 'Sur',               value: [42, 48, 40, 45, 38] },
  ],
};

// ============ Tablas de bloques ============
export const bloquesTabla = Array.from({ length: 24 }).map((_, i) => {
  const organismos = ['PDVSA','INTEVEP','Min. Petróleo','Filial Mixta Orinoco','Filial Mixta Maracaibo','Corp. Venezolana Petróleo'];
  const estados = ['Vendido','En construcción','Por entregar','En revisión'];
  const anios = ['2019','2020','2021','2022','2023','2024','2025','2026'];
  return {
    id: `BLQ-${(1000 + i).toString()}`,
    nombre: `Bloque ${String.fromCharCode(65 + (i % 26))}-${i + 1}`,
    anio: anios[seed(i, 0, anios.length - 1)],
    organismo: organismos[seed(i + 100, 0, organismos.length - 1)],
    estado: estados[seed(i + 200, 0, estados.length - 1)],
    hectareas: seed(i + 300, 500, 12000),
  };
});

// ============ Tabla de paquetes ============
export const paquetesTabla = Array.from({ length: 20 }).map((_, i) => {
  const estados = ['Entregado','En construcción','Por entregar','En revisión'];
  const fechas = ['2025-11-20','2025-12-05','2026-01-15','2026-02-28','2026-03-10','2026-04-22','2026-05-30','2026-06-18'];
  return {
    id: `PKG-${(2000 + i).toString()}`,
    bloque: `Bloque ${String.fromCharCode(65 + (i % 26))}-${i + 1}`,
    estado: estados[seed(i + 400, 0, estados.length - 1)],
    fechaEntrega: fechas[seed(i + 500, 0, fechas.length - 1)],
    capas: seed(i + 600, 3, 25),
  };
});

// ============ Lista de usuarios para config ============
export const usuariosTabla = Array.from({ length: 10 }).map((_, i) => {
  const roles = ['Admin','Operador','Consulta'];
  const organismos = ['PDVSA','INTEVEP','Min. Petróleo','Filial Mixta Orinoco'];
  const nombres = ['Juan Fernández','Lilly Rondón','Carlos Pérez','María Gómez','Pedro Rivas','Ana Torres','Luis Blanco','Sofía Núñez','Diego Salas','Elena Castro'];
  return {
    id: `USR-${(3000 + i).toString()}`,
    nombre: nombres[i],
    rol: roles[seed(i + 700, 0, roles.length - 1)],
    organismo: organismos[seed(i + 800, 0, organismos.length - 1)],
    activo: seed(i + 900, 0, 1) === 1,
  };
});